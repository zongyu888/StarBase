package main

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/go-sql-driver/mysql"

	"navideck/backend/internal/access"
	"navideck/backend/internal/api"
	"navideck/backend/internal/auth"
	"navideck/backend/internal/db"
	"navideck/backend/internal/model"
	"navideck/backend/internal/store"
)

//go:embed all:web/dist
var webAssets embed.FS

func main() {
	dataDir := envOr("NAVIDECK_DATA_DIR", "data")
	host := envOr("NAVIDECK_HOST", "127.0.0.1")
	port := envOr("NAVIDECK_PORT", "8620")

	appStore, err := store.Open(dataDir)
	if err != nil {
		log.Fatalf("初始化数据目录失败: %v", err)
	}
	demoPath := filepath.Join(appStore.DataDir(), "demo.db")
	if err := db.SeedDemo(demoPath); err != nil {
		log.Printf("初始化示例数据库失败: %v", err)
	}

	authEnabled := envBoolDefault("NAVIDECK_AUTH", true)
	registrationEnabled := envBoolDefault("NAVIDECK_REGISTRATION", true)
	devCodesRequested := envBoolDefault("NAVIDECK_AUTH_DEV_CODES", false)
	devCodes := devCodesRequested && isLoopbackBind(host)
	if devCodesRequested && !devCodes {
		log.Printf("[安全警告] NAVIDECK_AUTH_DEV_CODES 只允许在 127.0.0.1/localhost 监听时启用，已自动关闭")
	}
	sessionHours := envIntDefault("NAVIDECK_SESSION_HOURS", 72)
	mail := auth.MailConfig{
		Host:     envOr("NAVIDECK_SMTP_HOST", ""),
		Port:     envIntDefault("NAVIDECK_SMTP_PORT", 0),
		Username: envOr("NAVIDECK_SMTP_USERNAME", ""),
		Password: os.Getenv("NAVIDECK_SMTP_PASSWORD"),
		From:     envOr("NAVIDECK_SMTP_FROM", ""),
		FromName: os.Getenv("NAVIDECK_SMTP_FROM_NAME"),
		DevCodes: devCodes,
	}
	mail, mailFromFile, err := auth.LoadMailConfig(appStore.DataDir(), mail)
	if err != nil {
		log.Fatalf("读取邮件配置失败: %v", err)
	}
	if mailFromFile {
		log.Printf("已加载邮件配置: %s", filepath.Join(appStore.DataDir(), "mail.json"))
	}
	authSvc, bootstrap, err := auth.NewService(auth.Options{
		Enabled:             authEnabled,
		RegistrationEnabled: registrationEnabled,
		DataDir:             appStore.DataDir(),
		JWTSecret:           os.Getenv("NAVIDECK_JWT_SECRET"),
		JWTExpire:           time.Duration(sessionHours) * time.Hour,
		Mail:                mail,
		AdminUsername:       envOr("NAVIDECK_ADMIN_USERNAME", "admin"),
		AdminPassword:       os.Getenv("NAVIDECK_ADMIN_PASSWORD"),
		AdminEmail:          os.Getenv("NAVIDECK_ADMIN_EMAIL"),
	})
	if err != nil {
		log.Fatalf("初始化认证服务失败: %v", err)
	}
	if bootstrap.Admin != nil {
		if err := appStore.ClaimOwnerless(bootstrap.Admin.ID); err != nil {
			log.Printf("迁移旧连接归属失败: %v", err)
		}
	} else if authEnabled {
		for _, profile := range authSvc.ListUsers() {
			if profile.Role == auth.RoleAdmin {
				if err := appStore.ClaimOwnerless(profile.ID); err != nil {
					log.Printf("迁移旧连接归属失败: %v", err)
				}
				break
			}
		}
	}
	if appStore.FirstRun() {
		switch {
		case bootstrap.Admin != nil:
			if _, created, err := appStore.EnsureDemo(bootstrap.Admin.ID); err != nil {
				log.Printf("创建示例连接失败: %v", err)
			} else if created {
				log.Printf("已创建示例数据库: %s", demoPath)
			}
		case !authEnabled:
			if _, created, err := appStore.EnsureDemo(""); err != nil {
				log.Printf("创建示例连接失败: %v", err)
			} else if created {
				log.Printf("已创建示例数据库: %s", demoPath)
			}
		}
	}

	allowedDBHosts := splitCSV(os.Getenv("NAVIDECK_DB_ALLOWED_HOSTS"))
	accessPolicy := access.NewPolicy(
		appStore.DataDir(),
		envBoolDefault("NAVIDECK_ADMIN_ALLOW_PRIVATE", true),
		envBoolDefault("NAVIDECK_ADMIN_ALLOW_SERVER_PATHS", true),
		allowedDBHosts,
		localInterfaceIPs(),
	)
	manager := db.NewManager(appStore.DataDir(), accessPolicy.DialContext)
	mysql.RegisterDialContext("tcp", func(ctx context.Context, address string) (net.Conn, error) {
		return accessPolicy.DialContext(ctx, "tcp", address)
	})
	defer manager.Close()

	staticFS, err := fs.Sub(webAssets, "web/dist")
	if err != nil {
		log.Fatalf("加载前端资源失败: %v", err)
	}
	allowedHosts := map[string]bool{"127.0.0.1": true, "localhost": true, "::1": true}
	if host != "0.0.0.0" && host != "::" {
		allowedHosts[strings.ToLower(host)] = true
	}
	for _, allowed := range splitCSV(os.Getenv("NAVIDECK_ALLOWED_HOSTS")) {
		allowedHosts[strings.ToLower(allowed)] = true
	}
	server := &api.Server{
		Store:          appStore,
		DB:             manager,
		Auth:           authSvc,
		Access:         accessPolicy,
		Static:         staticFS,
		Started:        time.Now(),
		AllowedHosts:   allowedHosts,
		CookieSecure:   envBoolDefault("NAVIDECK_COOKIE_SECURE", false),
		PublicOrigin:   strings.TrimSpace(os.Getenv("NAVIDECK_PUBLIC_ORIGIN")),
		TrustedProxies: splitCSV(os.Getenv("NAVIDECK_TRUSTED_PROXIES")),
		DownloadsDir:   filepath.Join(dataDir, "downloads"),
	}
	httpServer := &http.Server{
		Addr:              host + ":" + port,
		Handler:           server.Router(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       5 * time.Minute,
		WriteTimeout:      5 * time.Minute,
		IdleTimeout:       2 * time.Minute,
		MaxHeaderBytes:    1 << 20,
	}

	go func() {
		log.Printf("StarBase %s 已启动: http://%s:%s", model.Version, host, port)
		log.Printf("数据目录: %s", appStore.DataDir())
		if authEnabled {
			log.Printf("认证: 已开启；注册: %s；邮件服务: %s", enabledLabel(registrationEnabled), enabledLabel(mail.Host != "" && mail.From != ""))
			if devCodes {
				if mail.Host != "" && mail.From != "" {
					log.Printf("[开发模式] 图形验证码会显示在登录页；邮箱验证码通过 SMTP 发送")
				} else {
					log.Printf("[开发模式] 邮箱验证码与图形验证码会显示在登录页/服务日志中；请勿用于公网部署")
				}
			}
			if host == "0.0.0.0" || host == "::" {
				log.Printf("[安全提示] 当前监听所有网卡，请通过 HTTPS 反向代理访问，并配置 NAVIDECK_ALLOWED_HOSTS")
			}
			if bootstrap.Admin != nil {
				if bootstrap.Generated {
					log.Printf("[初始管理员] 用户名: %s  初始密码: %s  （登录后请立即修改）", bootstrap.Admin.Username, bootstrap.InitialPassword)
				} else {
					log.Printf("[初始管理员] 用户名: %s（密码来自 NAVIDECK_ADMIN_PASSWORD）", bootstrap.Admin.Username)
				}
			}
		} else {
			log.Printf("[安全提示] 认证已关闭，仅适用于只监听本机的单用户环境")
		}
		fmt.Println("提示: 首次打开会自动创建并加载「示例数据库 · 电商」")
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("HTTP 服务启动失败: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	log.Println("正在关闭服务...")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(ctx)
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envBoolDefault(key string, fallback bool) bool {
	raw := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	if raw == "" {
		return fallback
	}
	switch raw {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return fallback
	}
}

func envIntDefault(key string, fallback int) int {
	value, err := strconv.Atoi(strings.TrimSpace(os.Getenv(key)))
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}

func splitCSV(raw string) []string {
	var out []string
	for _, item := range strings.Split(raw, ",") {
		item = strings.TrimSpace(item)
		if item != "" {
			out = append(out, item)
		}
	}
	return out
}

func isLoopbackBind(host string) bool {
	switch strings.ToLower(strings.TrimSpace(host)) {
	case "127.0.0.1", "localhost", "::1":
		return true
	default:
		return false
	}
}

func enabledLabel(enabled bool) string {
	if enabled {
		return "开启"
	}
	return "关闭"
}

func localInterfaceIPs() []string {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return nil
	}
	var out []string
	for _, addr := range addrs {
		if ipNet, ok := addr.(*net.IPNet); ok && ipNet.IP != nil {
			out = append(out, ipNet.IP.String())
		}
	}
	return out
}
