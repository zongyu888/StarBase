package api

import (
	"errors"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"navideck/backend/internal/access"
	"navideck/backend/internal/auth"
	"navideck/backend/internal/db"
	"navideck/backend/internal/model"
	"navideck/backend/internal/store"
)

type Server struct {
	Store          *store.Store
	DB             *db.Manager
	Auth           *auth.Service
	Access         *access.Policy
	Static         fs.FS
	Started        time.Time
	AllowedHosts   map[string]bool
	CookieSecure   bool
	PublicOrigin   string
	TrustedProxies []string
	Desktop        bool
}

func (s *Server) Router() *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	if len(s.TrustedProxies) > 0 {
		_ = r.SetTrustedProxies(s.TrustedProxies)
	} else {
		_ = r.SetTrustedProxies(nil)
	}
	r.Use(s.hostGuard(), gin.Logger(), gin.Recovery(), securityHeaders(), s.corsMiddleware(), s.authMiddleware())

	r.GET("/api/health", s.health)
	r.GET("/api/auth/status", s.authStatus)
	r.GET("/api/auth/captcha", s.authCaptcha)
	r.POST("/api/auth/email-code", s.authEmailCode)
	r.POST("/api/auth/register", s.authRegister)
	r.POST("/api/auth/login", s.authLogin)
	r.POST("/api/auth/reset-password", s.authResetPassword)
	r.GET("/api/auth/me", s.authMe)
	r.POST("/api/auth/logout", s.authLogout)
	r.POST("/api/auth/change-password", s.authChangePassword)

	r.GET("/api/admin/users", s.adminListUsers)
	r.PATCH("/api/admin/users/:id", s.adminUpdateUser)
	r.DELETE("/api/admin/users/:id", s.adminDeleteUser)
	r.POST("/api/admin/mail/test", s.adminTestMail)

	r.GET("/api/connections", s.listConnections)
	r.POST("/api/connections", s.createConnection)
	r.POST("/api/connections/test", s.testConnection)
	r.PUT("/api/connections/:id", s.updateConnection)
	r.DELETE("/api/connections/:id", s.deleteConnection)
	r.POST("/api/connections/:id/connect", s.connectConnection)
	r.POST("/api/connections/:id/disconnect", s.disconnectConnection)

	r.GET("/api/connections/:id/databases", s.listDatabases)
	r.POST("/api/connections/:id/databases", s.createDatabase)
	r.DELETE("/api/connections/:id/databases/:database", s.dropDatabase)
	r.GET("/api/connections/:id/schemas", s.listSchemas)
	r.GET("/api/connections/:id/objects", s.listObjects)

	r.GET("/api/connections/:id/table", s.tableMeta)
	r.GET("/api/connections/:id/table/rows", s.tableRows)
	r.POST("/api/connections/:id/table/rows", s.insertRow)
	r.PATCH("/api/connections/:id/table/rows", s.updateRow)
	r.DELETE("/api/connections/:id/table/rows", s.deleteRow)
	r.POST("/api/connections/:id/table/rows/batch", s.batchRows)
	r.GET("/api/connections/:id/table/export", s.exportTable)
	r.POST("/api/connections/:id/table/import", s.importCSV)

	r.GET("/api/connections/:id/redis/key", s.redisKey)
	r.PUT("/api/connections/:id/redis/key", s.redisSetKey)
	r.DELETE("/api/connections/:id/redis/key", s.redisDeleteKey)
	r.GET("/api/connections/:id/redis/info", s.redisInfo)
	r.GET("/api/connections/:id/redis/keys", s.redisKeys)
	r.POST("/api/connections/:id/redis/keys/delete", s.redisDeleteKeys)
	r.POST("/api/connections/:id/redis/key/rename", s.redisRenameKey)
	r.POST("/api/connections/:id/redis/key/expire", s.redisExpireKey)
	r.POST("/api/connections/:id/redis/key/entry", s.redisEntry)
	r.POST("/api/connections/:id/redis/command", s.redisCommand)

	r.GET("/api/connections/:id/chroma/info", s.chromaInfo)
	r.GET("/api/connections/:id/chroma/collections", s.chromaCollections)
	r.POST("/api/connections/:id/chroma/collections", s.chromaCreateCollection)
	r.GET("/api/connections/:id/chroma/collections/:collection", s.chromaCollection)
	r.DELETE("/api/connections/:id/chroma/collections/:collection", s.chromaDeleteCollection)
	r.GET("/api/connections/:id/chroma/collections/:collection/documents", s.chromaDocuments)
	r.POST("/api/connections/:id/chroma/collections/:collection/documents", s.chromaAddDocument)
	r.PUT("/api/connections/:id/chroma/collections/:collection/documents/:doc", s.chromaUpdateDocument)
	r.DELETE("/api/connections/:id/chroma/collections/:collection/documents/:doc", s.chromaDeleteDocument)
	r.POST("/api/connections/:id/chroma/collections/:collection/query", s.chromaQuery)
	r.POST("/api/connections/:id/chroma/collections/:collection/filter", s.chromaFilter)

	r.POST("/api/connections/:id/query", s.executeQuery)
	r.POST("/api/connections/:id/tables", s.createTable)
	r.POST("/api/connections/:id/table/drop", s.dropTable)
	r.POST("/api/connections/:id/table/truncate", s.truncateTable)
	r.POST("/api/connections/:id/table/alter", s.alterTable)

	r.GET("/api/queries", s.listSavedQueries)
	r.POST("/api/queries", s.createSavedQuery)
	r.PUT("/api/queries/:id", s.updateSavedQuery)
	r.DELETE("/api/queries/:id", s.deleteSavedQuery)

	r.NoRoute(s.serveWeb)
	return r
}

func (s *Server) health(c *gin.Context) {
	c.JSON(http.StatusOK, model.HealthInfo{
		OK:      true,
		Version: model.Version,
		Drivers: []string{
			model.DriverMySQL, model.DriverMariaDB, model.DriverPostgres, model.DriverSQLite,
			model.DriverSQLServer, model.DriverOracle, model.DriverSnowflake, model.DriverMongo, model.DriverRedis,
			model.DriverChroma,
		},
		UptimeMs: time.Since(s.Started).Milliseconds(),
		Desktop:  s.Desktop,
	})
}

func (s *Server) loadConnection(c *gin.Context) (model.Connection, string, bool) {
	id := c.Param("id")
	ownerID, all := s.scope(c)
	if s.Auth != nil && s.Auth.Enabled && currentUser(c) == nil {
		abortErr(c, http.StatusUnauthorized, fmt.Errorf("请先登录"))
		return model.Connection{}, "", false
	}
	conn, err := s.Store.GetFor(id, ownerID, all)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			abortErr(c, http.StatusNotFound, fmt.Errorf("连接不存在"))
		} else {
			abortErr(c, http.StatusInternalServerError, err)
		}
		return model.Connection{}, "", false
	}
	if s.Access != nil {
		if err := s.Access.ValidateConnectionCached(c.Request.Context(), conn, s.accessUser(c)); err != nil {
			abortErr(c, http.StatusForbidden, err)
			return model.Connection{}, "", false
		}
	}
	password, err := s.Store.Password(conn)
	if err != nil {
		abortErr(c, http.StatusInternalServerError, fmt.Errorf("读取连接密码失败: %w", err))
		return model.Connection{}, "", false
	}
	conn.Connected = s.DB.Status(conn.ID)
	return conn, password, true
}

func (s *Server) serveWeb(c *gin.Context) {
	p := c.Request.URL.Path
	if strings.HasPrefix(p, "/api/") || p == "/api" {
		c.JSON(http.StatusNotFound, gin.H{"error": "接口不存在"})
		return
	}
	if s.Static == nil {
		c.String(http.StatusNotFound, "前端资源未构建")
		return
	}
	name := strings.TrimPrefix(path.Clean(p), "/")
	if name != "" && name != "." {
		if f, err := s.Static.Open(name); err == nil {
			info, statErr := f.Stat()
			f.Close()
			if statErr == nil && !info.IsDir() {
				http.FileServerFS(s.Static).ServeHTTP(c.Writer, c.Request)
				return
			}
		}
		if path.Ext(name) != "" {
			c.String(http.StatusNotFound, "资源不存在")
			return
		}
	}
	index, err := fs.ReadFile(s.Static, "index.html")
	if err != nil {
		c.String(http.StatusNotFound, "index.html 不存在")
		return
	}
	c.Header("Cache-Control", "no-cache")
	c.Header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' http://127.0.0.1:18620 http://localhost:18620; object-src 'none'; base-uri 'self'; frame-ancestors 'none'")
	c.Data(http.StatusOK, "text/html; charset=utf-8", index)
}

func (s *Server) hostGuard() gin.HandlerFunc {
	return func(c *gin.Context) {
		if len(s.AllowedHosts) == 0 {
			c.Next()
			return
		}
		host := strings.ToLower(c.Request.Host)
		if parsedHost, _, err := net.SplitHostPort(host); err == nil {
			host = parsedHost
		}
		host = strings.Trim(host, "[]")
		if !s.AllowedHosts[host] {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "不允许的 Host 请求头，请使用 localhost 或 127.0.0.1 访问"})
			return
		}
		c.Next()
	}
}

func securityHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-Frame-Options", "DENY")
		c.Header("Referrer-Policy", "same-origin")
		c.Header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		if isAPIPath(c.Request.URL.Path) {
			c.Header("Cache-Control", "no-store")
		}
		c.Next()
	}
}

func (s *Server) corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		allowedOrigin := false
		if origin != "" {
			if parsed, err := url.Parse(origin); err == nil {
				host := strings.ToLower(parsed.Hostname())
				allowedOrigin = isLoopbackName(host)
				if !allowedOrigin && s.PublicOrigin != "" {
					if publicOrigin, parseErr := url.Parse(strings.TrimSpace(s.PublicOrigin)); parseErr == nil {
						allowedOrigin = strings.EqualFold(parsed.Scheme, publicOrigin.Scheme) && strings.EqualFold(parsed.Host, publicOrigin.Host)
					}
				}
			}
			if allowedOrigin {
				c.Header("Access-Control-Allow-Origin", origin)
				c.Header("Vary", "Origin")
				c.Header("Access-Control-Allow-Credentials", "true")
				c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
				c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
				c.Header("Access-Control-Max-Age", "86400")
			}
		}
		if c.Request.Method == http.MethodOptions {
			if origin != "" && !allowedOrigin {
				c.AbortWithStatus(http.StatusForbidden)
				return
			}
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

func abortErr(c *gin.Context, status int, err error) {
	c.AbortWithStatusJSON(status, gin.H{"error": err.Error()})
}

func bindJSON(c *gin.Context, dst any) bool {
	if err := c.ShouldBindJSON(dst); err != nil {
		abortErr(c, http.StatusBadRequest, fmt.Errorf("请求参数格式错误: %w", err))
		return false
	}
	return true
}
