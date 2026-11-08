package api

import (
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"navideck/backend/internal/access"
	"navideck/backend/internal/auth"
	dbpkg "navideck/backend/internal/db"
	"navideck/backend/internal/model"
)

const (
	sessionCookie   = "navideck_session"
	userContextKey  = "navideck.auth.user"
	authLimitWindow = time.Minute
)

var localUser = &auth.User{
	ID:            "local",
	Username:      "local",
	DisplayName:   "本机用户",
	Role:          auth.RoleAdmin,
	Enabled:       true,
	EmailVerified: true,
}

func isAPIPath(path string) bool {
	return path == "/api" || strings.HasPrefix(path, "/api/")
}

func isPublicAPIPath(path string) bool {
	switch path {
	case "/api/health",
		"/api/auth/status",
		"/api/auth/captcha",
		"/api/auth/email-code",
		"/api/auth/register",
		"/api/auth/login",
		"/api/auth/reset-password":
		return true
	default:
		return false
	}
}

func (s *Server) authMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		path := c.Request.URL.Path
		if !isAPIPath(path) {
			c.Next()
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 25<<20)
		if c.Request.Method == http.MethodOptions {
			c.Next()
			return
		}
		if s.Auth == nil {
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "认证服务未初始化"})
			return
		}
		if !s.Auth.Enabled {
			// 本机单用户模式不依赖会话 Cookie，桌面壳的自定义协议也没有可校验的 Origin。
			c.Set(userContextKey, localUser)
			c.Request = c.Request.WithContext(access.WithAllowPrivate(c.Request.Context(), true))
			c.Next()
			return
		}
		if !isSafeMethod(c.Request.Method) && !s.originAllowed(c) {
			log.Printf("[auth] 拒绝请求来源 method=%s path=%s origin=%q host=%q", c.Request.Method, path, c.GetHeader("Origin"), c.Request.Host)
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "请求来源不被允许"})
			return
		}
		if isPublicAPIPath(path) {
			c.Next()
			return
		}
		token := s.sessionToken(c)
		user, err := s.Auth.Authenticate(token)
		if err != nil {
			s.clearSessionCookie(c)
			status := auth.StatusOf(err)
			if status == 0 {
				status = http.StatusUnauthorized
			}
			c.AbortWithStatusJSON(status, gin.H{"error": err.Error()})
			return
		}
		c.Set(userContextKey, user)
		c.Request = c.Request.WithContext(access.WithAllowPrivate(c.Request.Context(), user.IsAdmin()))
		c.Next()
	}
}

func isSafeMethod(method string) bool {
	switch method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return true
	default:
		return false
	}
}

func (s *Server) originAllowed(c *gin.Context) bool {
	origin := strings.TrimSpace(c.GetHeader("Origin"))
	if origin == "" {
		return true
	}
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Host == "" {
		return false
	}
	requestHost := strings.ToLower(c.Request.Host)
	if strings.EqualFold(parsed.Host, requestHost) {
		return true
	}
	requestName := requestHost
	if host, _, splitErr := net.SplitHostPort(requestHost); splitErr == nil {
		requestName = host
	}
	requestName = strings.Trim(requestName, "[]")
	if isLoopbackName(parsed.Hostname()) && isLoopbackName(requestName) {
		return true
	}
	if s.PublicOrigin != "" {
		publicParsed, err := url.Parse(strings.TrimSpace(s.PublicOrigin))
		if err == nil && strings.EqualFold(parsed.Scheme, publicParsed.Scheme) && strings.EqualFold(parsed.Host, publicParsed.Host) {
			return true
		}
	}
	return false
}

func isLoopbackName(host string) bool {
	host = strings.ToLower(strings.Trim(host, "[]"))
	return host == "localhost" || host == "127.0.0.1" || host == "::1" || host == "0:0:0:0:0:0:0:1"
}

func (s *Server) sessionToken(c *gin.Context) string {
	if cookie, err := c.Cookie(sessionCookie); err == nil && strings.TrimSpace(cookie) != "" {
		return strings.TrimSpace(cookie)
	}
	if header := c.GetHeader("Authorization"); strings.HasPrefix(header, "Bearer ") {
		return strings.TrimSpace(header[7:])
	}
	return ""
}

func (s *Server) setSessionCookie(c *gin.Context, token string) {
	if token == "" || s.Auth == nil {
		return
	}
	maxAge := int(s.Auth.TokenTTL().Seconds())
	secure := s.CookieSecure || c.Request.TLS != nil
	sameSite := http.SameSiteLaxMode
	if secure {
		// 前后端分离部署（Pages → api 子域）时，跨站请求必须使用 SameSite=None。
		sameSite = http.SameSiteNoneMode
	}
	c.SetSameSite(sameSite)
	c.SetCookie(sessionCookie, token, maxAge, "/", "", secure, true)
}

func (s *Server) clearSessionCookie(c *gin.Context) {
	secure := s.CookieSecure || c.Request.TLS != nil
	sameSite := http.SameSiteLaxMode
	if secure {
		sameSite = http.SameSiteNoneMode
	}
	c.SetSameSite(sameSite)
	c.SetCookie(sessionCookie, "", -1, "/", "", secure, true)
}

func currentUser(c *gin.Context) *auth.User {
	if value, ok := c.Get(userContextKey); ok {
		if user, ok := value.(*auth.User); ok {
			return user
		}
	}
	return nil
}

func (s *Server) requireUser(c *gin.Context) (*auth.User, bool) {
	user := currentUser(c)
	if user == nil {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "请先登录"})
		return nil, false
	}
	return user, true
}

func (s *Server) requireAdmin(c *gin.Context) (*auth.User, bool) {
	user, ok := s.requireUser(c)
	if !ok {
		return nil, false
	}
	if !user.IsAdmin() {
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "需要管理员权限"})
		return nil, false
	}
	return user, true
}

func (s *Server) scope(c *gin.Context) (string, bool) {
	if s.Auth == nil || !s.Auth.Enabled {
		return "", true
	}
	user := currentUser(c)
	if user == nil {
		return "", false
	}
	return user.ID, false
}

func (s *Server) accessUser(c *gin.Context) access.UserContext {
	user := currentUser(c)
	if user == nil {
		return access.UserContext{}
	}
	return access.UserContext{UserID: user.ID, Role: user.Role, IsAdmin: user.IsAdmin()}
}

func abortAuthErr(c *gin.Context, err error) {
	status := auth.StatusOf(err)
	if status == 0 {
		log.Printf("[auth] 内部错误: %v", err)
		c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "服务内部错误"})
		return
	}
	c.AbortWithStatusJSON(status, gin.H{"error": err.Error()})
}

func (s *Server) rateLimit(c *gin.Context, key string, limit int, window time.Duration) bool {
	if s.Auth == nil || s.Auth.Allow(key, limit, window) {
		return true
	}
	c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{"error": "请求过于频繁，请稍后再试"})
	return false
}

func (s *Server) authStatus(c *gin.Context) {
	if s.Auth == nil {
		c.JSON(http.StatusOK, auth.Status{})
		return
	}
	c.JSON(http.StatusOK, s.Auth.Status())
}

func (s *Server) authCaptcha(c *gin.Context) {
	if !s.rateLimit(c, "captcha:"+c.ClientIP(), 60, authLimitWindow) {
		return
	}
	if s.Auth == nil {
		c.JSON(http.StatusOK, auth.CaptchaChallenge{})
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, s.Auth.Captcha())
}

func (s *Server) authEmailCode(c *gin.Context) {
	if !s.rateLimit(c, "email:"+c.ClientIP(), 10, 10*time.Minute) {
		return
	}
	var req auth.EmailCodeRequest
	if !bindJSON(c, &req) {
		return
	}
	devCode, err := s.Auth.SendEmailCode(req.Email, req.Scene)
	if err != nil {
		abortAuthErr(c, err)
		return
	}
	c.JSON(http.StatusOK, auth.EmailCodeResponse{
		OK:      true,
		Message: "如果该邮箱可用，验证码已发送",
		DevCode: devCode,
	})
}

func (s *Server) authRegister(c *gin.Context) {
	if !s.rateLimit(c, "register:"+c.ClientIP(), 10, 10*time.Minute) {
		return
	}
	var req auth.RegisterRequest
	if !bindJSON(c, &req) {
		return
	}
	user, err := s.Auth.Register(req, c.ClientIP())
	if err != nil {
		abortAuthErr(c, err)
		return
	}
	s.ensureUserDemo(user)
	token, _, err := s.Auth.IssueToken(user)
	if err != nil {
		abortAuthErr(c, auth.NewError(500, "签发会话失败"))
		return
	}
	s.setSessionCookie(c, token)
	c.JSON(http.StatusCreated, auth.AuthResponse{User: user.Profile()})
}

func (s *Server) authLogin(c *gin.Context) {
	if !s.rateLimit(c, "login:"+c.ClientIP(), 20, authLimitWindow) {
		return
	}
	var req auth.LoginRequest
	if !bindJSON(c, &req) {
		return
	}
	user, err := s.Auth.Login(req, c.ClientIP())
	if err != nil {
		abortAuthErr(c, err)
		return
	}
	token, _, err := s.Auth.IssueToken(user)
	if err != nil {
		abortAuthErr(c, auth.NewError(500, "签发会话失败"))
		return
	}
	s.setSessionCookie(c, token)
	c.JSON(http.StatusOK, auth.AuthResponse{User: user.Profile()})
}

func (s *Server) authMe(c *gin.Context) {
	user, ok := s.requireUser(c)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, auth.AuthResponse{User: user.Profile()})
}

func (s *Server) authLogout(c *gin.Context) {
	token := s.sessionToken(c)
	if s.Auth != nil {
		s.Auth.RevokeToken(token)
	}
	if user := currentUser(c); user != nil && s.Auth != nil && s.Auth.Enabled {
		s.disconnectUserConnections(user.ID)
	}
	s.clearSessionCookie(c)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (s *Server) authChangePassword(c *gin.Context) {
	user, ok := s.requireUser(c)
	if !ok {
		return
	}
	var req auth.ChangePasswordRequest
	if !bindJSON(c, &req) {
		return
	}
	updated, err := s.Auth.ChangePassword(user.ID, req.OldPassword, req.NewPassword)
	if err != nil {
		abortAuthErr(c, err)
		return
	}
	token, _, err := s.Auth.IssueToken(updated)
	if err != nil {
		abortAuthErr(c, auth.NewError(500, "签发会话失败"))
		return
	}
	s.setSessionCookie(c, token)
	c.JSON(http.StatusOK, auth.AuthResponse{User: updated.Profile()})
}

func (s *Server) authResetPassword(c *gin.Context) {
	if !s.rateLimit(c, "reset:"+c.ClientIP(), 10, 10*time.Minute) {
		return
	}
	var req auth.ResetPasswordRequest
	if !bindJSON(c, &req) {
		return
	}
	if err := s.Auth.ResetPassword(req, c.ClientIP()); err != nil {
		abortAuthErr(c, err)
		return
	}
	s.clearSessionCookie(c)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (s *Server) adminListUsers(c *gin.Context) {
	if _, ok := s.requireAdmin(c); !ok {
		return
	}
	c.JSON(http.StatusOK, gin.H{"users": s.Auth.ListUsers()})
}

func (s *Server) adminUpdateUser(c *gin.Context) {
	admin, ok := s.requireAdmin(c)
	if !ok {
		return
	}
	target, err := s.Auth.UserByID(c.Param("id"))
	if err != nil {
		abortErr(c, http.StatusNotFound, fmt.Errorf("用户不存在"))
		return
	}
	var req auth.AdminUpdateUserRequest
	if !bindJSON(c, &req) {
		return
	}
	if req.Enabled == nil {
		abortErr(c, http.StatusBadRequest, fmt.Errorf("缺少 enabled 参数"))
		return
	}
	if target.ID == admin.ID && !*req.Enabled {
		abortErr(c, http.StatusBadRequest, fmt.Errorf("不能禁用当前登录账号"))
		return
	}
	if target.IsAdmin() && !*req.Enabled {
		enabledAdmins := 0
		for _, item := range s.Auth.ListUsers() {
			if item.Role == auth.RoleAdmin && item.Enabled && item.ID != target.ID {
				enabledAdmins++
			}
		}
		if enabledAdmins == 0 {
			abortErr(c, http.StatusBadRequest, fmt.Errorf("至少需要保留一个可用的管理员账号"))
			return
		}
	}
	if err := s.Auth.SetUserEnabled(target.ID, *req.Enabled); err != nil {
		abortAuthErr(c, err)
		return
	}
	if !*req.Enabled {
		s.disconnectUserConnections(target.ID)
	}
	updated, _ := s.Auth.UserByID(target.ID)
	if updated == nil {
		c.JSON(http.StatusOK, gin.H{"ok": true})
		return
	}
	c.JSON(http.StatusOK, auth.AuthResponse{User: updated.Profile()})
}

func (s *Server) adminTestMail(c *gin.Context) {
	admin, ok := s.requireAdmin(c)
	if !ok {
		return
	}
	if !s.rateLimit(c, "mailtest:"+admin.ID, 5, 10*time.Minute) {
		return
	}
	var req struct {
		To string `json:"to"`
	}
	if !bindJSON(c, &req) {
		return
	}
	if err := s.Auth.SendTestEmail(req.To); err != nil {
		abortAuthErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "message": "测试邮件已发送"})
}

func (s *Server) adminDeleteUser(c *gin.Context) {
	admin, ok := s.requireAdmin(c)
	if !ok {
		return
	}
	if c.Param("id") == admin.ID {
		abortErr(c, http.StatusBadRequest, fmt.Errorf("不能删除当前登录账号"))
		return
	}
	target, err := s.Auth.UserByID(c.Param("id"))
	if err != nil {
		abortErr(c, http.StatusNotFound, fmt.Errorf("用户不存在"))
		return
	}
	if target.IsAdmin() {
		enabledAdmins := 0
		for _, item := range s.Auth.ListUsers() {
			if item.Role == auth.RoleAdmin && item.Enabled && item.ID != target.ID {
				enabledAdmins++
			}
		}
		if enabledAdmins == 0 {
			abortErr(c, http.StatusBadRequest, fmt.Errorf("至少需要保留一个可用的管理员账号"))
			return
		}
	}
	ids, err := s.Store.DeleteByOwner(target.ID)
	if err != nil {
		abortErr(c, http.StatusInternalServerError, fmt.Errorf("清理用户数据失败: %w", err))
		return
	}
	for _, id := range ids {
		s.DB.Disconnect(id)
	}
	if _, err := s.Auth.DeleteUser(target.ID); err != nil {
		abortAuthErr(c, err)
		return
	}
	userDir := filepath.Join(s.Store.DataDir(), "users", target.ID)
	if err := os.RemoveAll(userDir); err != nil {
		log.Printf("[auth] 清理用户目录失败 %s: %v", userDir, err)
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (s *Server) rateKey(c *gin.Context, prefix string) string {
	if user := currentUser(c); user != nil {
		return prefix + ":user:" + user.ID
	}
	return prefix + ":ip:" + c.ClientIP()
}

func (s *Server) validateTarget(c *gin.Context, conn model.Connection) bool {
	if s.Access == nil {
		return true
	}
	user := s.accessUser(c)
	if err := s.Access.ValidateConnection(c.Request.Context(), conn, user); err != nil {
		log.Printf("[access] 拒绝连接目标 user=%s admin=%v driver=%s host=%s port=%d tenant=%q err=%v",
			user.UserID, user.IsAdmin, conn.Driver, conn.Host, conn.Port, conn.Tenant, err)
		abortErr(c, http.StatusForbidden, err)
		return false
	}
	return true
}

func sameTarget(left, right model.Connection) bool {
	if left.Driver != right.Driver {
		return false
	}
	if left.Driver == model.DriverSQLite {
		return strings.TrimSpace(left.SQLitePath) == strings.TrimSpace(right.SQLitePath)
	}
	return strings.EqualFold(strings.TrimSpace(left.Host), strings.TrimSpace(right.Host)) &&
		left.Port == right.Port &&
		strings.EqualFold(strings.TrimSpace(left.SSLMode), strings.TrimSpace(right.SSLMode)) &&
		strings.TrimSpace(left.Account) == strings.TrimSpace(right.Account)
}

func (s *Server) disconnectUserConnections(ownerID string) {
	for _, conn := range s.Store.ListFor(ownerID, false) {
		s.DB.Disconnect(conn.ID)
	}
}

func (s *Server) ensureUserDemo(user *auth.User) {
	if user == nil || user.IsAdmin() || s.Auth == nil || !s.Auth.Enabled {
		return
	}
	userDir := filepath.Join(s.Store.DataDir(), "users", user.ID)
	if err := os.MkdirAll(userDir, 0o700); err != nil {
		log.Printf("[auth] 创建用户沙箱失败: %v", err)
		return
	}
	dbPath := filepath.Join(userDir, "demo.db")
	if _, err := os.Stat(dbPath); errors.Is(err, os.ErrNotExist) {
		if err := dbpkg.SeedDemo(dbPath); err != nil {
			log.Printf("[auth] 初始化用户示例库失败: %v", err)
			return
		}
	}
	relPath := filepath.ToSlash(filepath.Join("users", user.ID, "demo.db"))
	if _, _, err := s.Store.EnsureUserDemoConnection(user.ID, relPath, "示例数据库 · 电商"); err != nil {
		log.Printf("[auth] 创建用户示例连接失败: %v", err)
	}
}
