package auth

import (
	"crypto/rand"
	"fmt"
	"log"
	"math/big"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"golang.org/x/crypto/bcrypt"
)

const (
	bcryptCost     = 12
	authMaxFailed  = 6
	authFailWindow = 10 * time.Minute
	authLockWindow = 10 * time.Minute
)

var emailPattern = regexp.MustCompile(`^[A-Za-z0-9+_.-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$`)

type Options struct {
	Enabled             bool
	RegistrationEnabled bool
	DataDir             string
	JWTSecret           string
	JWTExpire           time.Duration
	Mail                MailConfig
	AdminUsername       string
	AdminPassword       string
	AdminEmail          string
}

type Bootstrap struct {
	Admin           *User
	InitialPassword string
	Generated       bool
}

type Service struct {
	Enabled      bool
	registration bool
	users        *Users
	tokens       *Tokens
	captcha      *Captchas
	email        *EmailCodes
	limiter      *Limiter
	failures     *FailureTracker
	dummyHash    []byte
}

func NewService(opts Options) (*Service, Bootstrap, error) {
	secret := strings.TrimSpace(opts.JWTSecret)
	if secret == "" {
		generated, err := LoadOrCreateSecret(opts.DataDir)
		if err != nil {
			return nil, Bootstrap{}, err
		}
		secret = generated
	}
	users, err := OpenUsers(opts.DataDir)
	if err != nil {
		return nil, Bootstrap{}, err
	}
	service := &Service{
		Enabled:      opts.Enabled,
		registration: opts.RegistrationEnabled,
		users:        users,
		tokens:       NewTokens(secret, opts.JWTExpire),
		captcha:      NewCaptchas(),
		email:        NewEmailCodes(opts.Mail),
		limiter:      NewLimiter(),
		failures:     NewFailureTracker(),
	}
	service.dummyHash, _ = bcrypt.GenerateFromPassword([]byte("navideck-timing-dummy-password"), bcryptCost)
	var bootstrap Bootstrap
	if opts.Enabled && users.Count() == 0 {
		username := strings.TrimSpace(opts.AdminUsername)
		if username == "" {
			username = "admin"
		}
		password := opts.AdminPassword
		generated := false
		if password == "" {
			password = randomPassword(16)
			generated = true
		}
		if err := validateUsername(username); err != nil {
			return nil, Bootstrap{}, fmt.Errorf("初始管理员用户名无效: %w", err)
		}
		if err := validatePassword(password); err != nil {
			return nil, Bootstrap{}, fmt.Errorf("初始管理员密码无效: %w", err)
		}
		hash, err := bcrypt.GenerateFromPassword([]byte(password), bcryptCost)
		if err != nil {
			return nil, Bootstrap{}, err
		}
		admin := &User{
			Username:      username,
			Email:         strings.TrimSpace(opts.AdminEmail),
			DisplayName:   "管理员",
			PasswordHash:  string(hash),
			Role:          RoleAdmin,
			Enabled:       true,
			EmailVerified: true,
		}
		if err := users.Create(admin); err != nil {
			return nil, Bootstrap{}, err
		}
		bootstrap = Bootstrap{Admin: admin, InitialPassword: password, Generated: generated}
	}
	return service, bootstrap, nil
}

func (s *Service) Status() Status {
	return Status{
		AuthEnabled:         s.Enabled,
		RegistrationEnabled: s.Enabled && s.registration,
		MailConfigured:      s.email.Configured(),
		DevCodes:            s.email.DevCodes(),
		HasUsers:            s.users.Count() > 0,
	}
}

func (s *Service) UsersPath() string { return s.users.Path() }

func (s *Service) TokenTTL() time.Duration { return s.tokens.TTL() }

func (s *Service) UserByID(id string) (*User, error) {
	return s.users.GetByID(id)
}

func (s *Service) ListUsers() []UserProfile { return s.users.List() }

func (s *Service) Captcha() CaptchaChallenge {
	return s.captcha.Generate(s.email.DevCodes())
}

func (s *Service) Allow(key string, limit int, window time.Duration) bool {
	return s.limiter.Allow(key, limit, window)
}

func (s *Service) SendEmailCode(email, scene string) (string, error) {
	if !s.Enabled {
		return "", NewError(403, "认证已关闭")
	}
	if validateEmail(email) != nil {
		return "", NewError(400, "邮箱格式不正确")
	}
	scene = strings.ToLower(strings.TrimSpace(scene))
	if scene != "register" && scene != "reset" {
		return "", NewError(400, "不支持的验证码场景")
	}
	email = normalizeEmail(email)
	if scene == "register" {
		if _, err := s.users.FindByEmail(email); err == nil {
			// 不暴露邮箱是否已存在，也不实际发送。
			return "", nil
		}
	} else if scene == "reset" {
		if _, err := s.users.FindByEmail(email); err != nil {
			return "", nil
		}
	}
	return s.email.Send(email, scene)
}

func (s *Service) SendTestEmail(to string) error {
	if err := validateEmail(to); err != nil {
		return err
	}
	if !s.email.Configured() {
		return NewError(503, "邮件服务未配置，请设置 data/mail.json 或 NAVIDECK_SMTP_* 环境变量")
	}
	_, err := s.email.Send(strings.TrimSpace(to), "test")
	return err
}

func (s *Service) Register(req RegisterRequest, ip string) (*User, error) {
	if !s.Enabled {
		return nil, NewError(403, "认证已关闭")
	}
	if !s.registration {
		return nil, NewError(403, "注册已关闭，请联系管理员")
	}
	if err := validateUsername(req.Username); err != nil {
		return nil, err
	}
	if err := validateEmail(req.Email); err != nil {
		return nil, err
	}
	if err := validatePassword(req.Password); err != nil {
		return nil, err
	}
	if !s.captcha.Verify(req.CaptchaID, req.CaptchaCode) {
		return nil, NewError(400, "图形验证码错误或已过期，请刷新后重试")
	}
	username := strings.TrimSpace(req.Username)
	email := strings.TrimSpace(req.Email)
	if _, err := s.users.FindByUsername(username); err == nil {
		return nil, NewError(400, "用户名已被占用")
	}
	if !s.email.Verify(email, req.VerifyCode) {
		return nil, NewError(400, "邮箱验证码错误或已过期，请重新获取")
	}
	if _, err := s.users.FindByEmail(email); err == nil {
		return nil, NewError(400, "该邮箱已注册")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcryptCost)
	if err != nil {
		return nil, err
	}
	displayName := strings.TrimSpace(req.DisplayName)
	if displayName == "" {
		displayName = username
	}
	user := &User{
		Username:      username,
		Email:         email,
		DisplayName:   displayName,
		PasswordHash:  string(hash),
		Role:          RoleUser,
		Enabled:       true,
		EmailVerified: true,
	}
	if err := s.users.Create(user); err != nil {
		if err == ErrUserExists {
			return nil, NewError(400, "用户名或邮箱已被占用")
		}
		return nil, err
	}
	return user, nil
}

func (s *Service) Login(req LoginRequest, ip string) (*User, error) {
	if !s.Enabled {
		return nil, NewError(403, "认证已关闭")
	}
	login := strings.TrimSpace(req.Login)
	if login == "" {
		return nil, NewError(400, "用户名或邮箱不能为空")
	}
	if len(login) > 254 || len(req.Password) > 72 {
		return nil, NewError(400, "输入内容过长")
	}
	if strings.TrimSpace(req.Password) == "" {
		return nil, NewError(400, "密码不能为空")
	}
	lockKey := strings.ToLower(login) + "|" + ip
	if remaining, locked := s.failures.Locked(lockKey); locked {
		minutes := int(remaining.Minutes()) + 1
		return nil, NewError(429, fmt.Sprintf("登录失败次数过多，账号已临时锁定，请约 %d 分钟后再试", minutes))
	}
	if !s.captcha.Verify(req.CaptchaID, req.CaptchaCode) {
		s.recordFailure(lockKey)
		return nil, NewError(400, "图形验证码错误或已过期，请刷新后重试")
	}
	user, err := s.users.FindByLogin(login)
	if err != nil {
		_ = bcrypt.CompareHashAndPassword(s.dummyHash, []byte(req.Password))
		s.recordFailure(lockKey)
		return nil, NewError(401, "用户名/邮箱或密码错误")
	}
	if bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)) != nil {
		s.recordFailure(lockKey)
		return nil, NewError(401, "用户名/邮箱或密码错误")
	}
	if !user.Enabled {
		return nil, NewError(403, "账号已被禁用，请联系管理员")
	}
	s.failures.Clear(lockKey)
	if err := s.users.RecordLogin(user.ID); err == nil {
		user.LastLoginAt = timePtr(time.Now().UTC())
	}
	return user, nil
}

func (s *Service) ResetPassword(req ResetPasswordRequest, ip string) error {
	if !s.Enabled {
		return NewError(403, "认证已关闭")
	}
	if validateEmail(req.Email) != nil {
		return NewError(400, "邮箱格式不正确")
	}
	if err := validatePassword(req.NewPassword); err != nil {
		return err
	}
	if !s.captcha.Verify(req.CaptchaID, req.CaptchaCode) {
		return NewError(400, "图形验证码错误或已过期，请刷新后重试")
	}
	email := normalizeEmail(req.Email)
	if !s.email.Verify(email, req.VerifyCode) {
		return NewError(400, "邮箱验证码错误或已过期，请重新获取")
	}
	user, err := s.users.FindByEmail(email)
	if err != nil {
		return NewError(400, "邮箱验证码错误或已过期，请重新获取")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcryptCost)
	if err != nil {
		return err
	}
	user.PasswordHash = string(hash)
	user.TokenVersion++
	if err := s.users.Update(user); err != nil {
		return err
	}
	s.failures.Clear(strings.ToLower(user.Username) + "|" + ip)
	return nil
}

func (s *Service) ChangePassword(userID, oldPassword, newPassword string) (*User, error) {
	user, err := s.users.GetByID(userID)
	if err != nil {
		return nil, NewError(404, "用户不存在")
	}
	if bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(oldPassword)) != nil {
		return nil, NewError(400, "原密码不正确")
	}
	if err := validatePassword(newPassword); err != nil {
		return nil, err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcryptCost)
	if err != nil {
		return nil, err
	}
	user.PasswordHash = string(hash)
	user.TokenVersion++
	if err := s.users.Update(user); err != nil {
		return nil, err
	}
	return user, nil
}

func (s *Service) IssueToken(user *User) (string, time.Time, error) {
	return s.tokens.Issue(user)
}

func (s *Service) RevokeToken(token string) { s.tokens.Revoke(token) }

func (s *Service) Authenticate(token string) (*User, error) {
	if !s.Enabled {
		return nil, NewError(401, "认证已关闭")
	}
	if strings.TrimSpace(token) == "" {
		return nil, NewError(401, "请先登录")
	}
	claims, err := s.tokens.Parse(token)
	if err != nil {
		return nil, NewError(401, "登录状态已失效，请重新登录")
	}
	user, err := s.users.GetByID(claims.Subject)
	if err != nil {
		return nil, NewError(401, "用户不存在")
	}
	if !user.Enabled {
		return nil, NewError(401, "账号已被禁用，请联系管理员")
	}
	if user.TokenVersion != claims.Version {
		return nil, NewError(401, "登录状态已失效，请重新登录")
	}
	return user, nil
}

func (s *Service) SetUserEnabled(id string, enabled bool) error {
	return s.users.SetEnabled(id, enabled)
}

func (s *Service) DeleteUser(id string) (*User, error) {
	return s.users.Delete(id)
}

func (s *Service) recordFailure(key string) {
	if lock := s.failures.Record(key, authMaxFailed, authFailWindow, authLockWindow); lock > 0 {
		log.Printf("[auth] 登录失败次数过多，已锁定 %s", key)
	}
}

func validateUsername(username string) error {
	username = strings.TrimSpace(username)
	n := utf8.RuneCountInString(username)
	if n < 3 || n > 32 {
		return NewError(400, "用户名长度需在 3-32 之间")
	}
	for _, r := range username {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_' || r == '-' || r == '.' {
			continue
		}
		return NewError(400, "用户名只能包含字母、数字、下划线、点和短横线")
	}
	return nil
}

func validatePassword(password string) error {
	n := utf8.RuneCountInString(password)
	if n < 8 || n > 64 {
		return NewError(400, "密码长度需在 8-64 之间")
	}
	if len(password) > 72 {
		return NewError(400, "密码过长")
	}
	return nil
}

func validateEmail(email string) error {
	email = strings.TrimSpace(email)
	if email == "" {
		return NewError(400, "邮箱不能为空")
	}
	if len(email) > 254 || !emailPattern.MatchString(email) {
		return NewError(400, "邮箱格式不正确")
	}
	return nil
}

func randomPassword(length int) string {
	const chars = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%"
	var b strings.Builder
	for i := 0; i < length; i++ {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(chars))))
		if err != nil {
			b.WriteByte(chars[i%len(chars)])
			continue
		}
		b.WriteByte(chars[n.Int64()])
	}
	return b.String()
}

func timePtr(t time.Time) *time.Time { return &t }
