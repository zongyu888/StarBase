// StarBase Agent：运行在用户本机的数据库连接代理。
// 只监听回环地址，通过配对令牌与网站前端通信，使浏览器访问的网站可以连接本机/内网数据库。
package main

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"navideck/backend/internal/api"
	"navideck/backend/internal/auth"
	"navideck/backend/internal/db"
	"navideck/backend/internal/model"
	"navideck/backend/internal/store"
)

const (
	agentName         = "StarBase Agent"
	agentPublicOrigin = "https://stargrow.store"
	pinLifetime       = 5 * time.Minute
	maxPairFailures   = 5
	pairLockDuration  = time.Minute
)

type agentGuard struct {
	next http.Handler

	origins map[string]bool

	mu          sync.Mutex
	token       string
	pin         string
	pinExpires  time.Time
	failures    int
	lockedUntil time.Time
}

func main() {
	dataFlag := flag.String("data", "", "数据目录（默认用户配置目录下的 StarBaseAgent）")
	addrFlag := flag.String("addr", "127.0.0.1:18620", "监听地址，必须是回环地址")
	originFlag := flag.String("origins", "", "额外允许的 Origin，逗号分隔")
	flag.Parse()

	if err := ensureLoopback(*addrFlag); err != nil {
		log.Fatalf("%s 启动失败: %v", agentName, err)
	}

	dataDir := resolveDataDir(*dataFlag)
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		log.Fatalf("%s 无法创建数据目录 %s: %v", agentName, dataDir, err)
	}

	appStore, err := store.Open(dataDir)
	if err != nil {
		log.Fatalf("%s 初始化本地数据失败: %v", agentName, err)
	}
	if appStore.FirstRun() {
		if _, created, seedErr := appStore.EnsureDemo(""); seedErr == nil && created {
			log.Printf("已创建示例数据库: %s", filepath.Join(appStore.DataDir(), "demo.db"))
		}
	}

	authSvc, _, err := auth.NewService(auth.Options{Enabled: false, DataDir: appStore.DataDir()})
	if err != nil {
		log.Fatalf("%s 初始化本地服务失败: %v", agentName, err)
	}

	manager := db.NewManager(appStore.DataDir())
	defer manager.Close()

	server := &api.Server{
		Store:        appStore,
		DB:           manager,
		Auth:         authSvc,
		Started:      time.Now(),
		PublicOrigin: agentPublicOrigin,
		Desktop:      true,
	}

	origins := defaultOrigins()
	for _, extra := range strings.Split(*originFlag, ",") {
		if normalized := normalizeOrigin(extra); normalized != "" {
			origins[normalized] = true
		}
	}
	guard := &agentGuard{next: server.Router(), origins: origins}
	guard.rotatePIN()

	httpServer := &http.Server{
		Addr:              *addrFlag,
		Handler:           guard,
		ReadHeaderTimeout: 10 * time.Second,
	}

	listener, err := net.Listen("tcp", *addrFlag)
	if err != nil {
		log.Fatalf("%s 无法监听 %s: %v", agentName, *addrFlag, err)
	}

	log.Printf("%s %s 已启动: http://%s", agentName, model.Version, listener.Addr())
	log.Printf("数据目录: %s", appStore.DataDir())
	log.Printf("允许的网站来源: %s", guard.originList())
	log.Printf("配对码: %s（%d 分钟内有效，输入到网页「本地 Agent」对话框）", guard.currentPIN(), int(pinLifetime.Minutes()))

	go func() {
		if serveErr := httpServer.Serve(listener); serveErr != nil && serveErr != http.ErrServerClosed {
			log.Printf("%s 服务异常退出: %v", agentName, serveErr)
		}
	}()

	// 保持配对码有效并定期刷新，方便用户在 5 分钟后重新查看。
	go func() {
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			guard.rotatePIN()
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(ctx)
	log.Printf("%s 已停止", agentName)
}

func (g *agentGuard) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin != "" && !g.originAllowed(origin) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "不允许的请求来源"})
		return
	}

	g.setCORS(w, origin)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	switch r.URL.Path {
	case "/api/agent/health":
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		g.mu.Lock()
		g.rotatePINLocked()
		paired := g.token != ""
		g.mu.Unlock()
		writeJSON(w, http.StatusOK, map[string]any{
			"name":    agentName,
			"version": model.Version,
			"paired":  paired,
		})
		return
	case "/api/agent/pair":
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		g.handlePair(w, r)
		return
	}

	if strings.HasPrefix(r.URL.Path, "/api/") {
		g.mu.Lock()
		token := g.token
		g.mu.Unlock()
		provided := strings.TrimSpace(r.Header.Get("X-StarBase-Agent-Token"))
		if token == "" || provided == "" || subtle.ConstantTimeCompare([]byte(provided), []byte(token)) != 1 {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "本地 Agent 未配对或令牌无效，请重新配对"})
			return
		}
	}

	g.next.ServeHTTP(w, r)
}

type pairRequest struct {
	PIN string `json:"pin"`
}

func (g *agentGuard) handlePair(w http.ResponseWriter, r *http.Request) {
	var req pairRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "配对请求格式错误"})
		return
	}

	g.mu.Lock()
	defer g.mu.Unlock()

	if g.token != "" {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "该 Agent 已配对；如需重新配对，请重启 Agent"})
		return
	}
	if time.Now().Before(g.lockedUntil) {
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "配对失败次数过多，请稍后再试"})
		return
	}
	g.rotatePINLocked()

	pin := strings.TrimSpace(req.PIN)
	if pin == "" || subtle.ConstantTimeCompare([]byte(pin), []byte(g.pin)) != 1 {
		g.failures++
		if g.failures >= maxPairFailures {
			g.lockedUntil = time.Now().Add(pairLockDuration)
			g.failures = 0
		}
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "配对码不正确或已过期"})
		return
	}

	token, err := randomHex(32)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "生成配对令牌失败"})
		return
	}
	g.token = token
	g.failures = 0
	g.pin = ""
	g.pinExpires = time.Time{}
	log.Printf("网站已完成配对（token 仅保存在 Agent 内存和浏览器本地）")

	writeJSON(w, http.StatusOK, map[string]any{
		"token":   token,
		"name":    agentName,
		"version": model.Version,
	})
}

func (g *agentGuard) originAllowed(origin string) bool {
	normalized := normalizeOrigin(origin)
	return normalized != "" && g.origins[normalized]
}

func (g *agentGuard) setCORS(w http.ResponseWriter, origin string) {
	if origin == "" {
		return
	}
	w.Header().Set("Access-Control-Allow-Origin", origin)
	w.Header().Set("Vary", "Origin")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-StarBase-Agent-Token")
	w.Header().Set("Access-Control-Max-Age", "86400")
}

func (g *agentGuard) rotatePIN() {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.token != "" {
		return
	}
	previous := g.pin
	g.rotatePINLocked()
	if g.pin != previous {
		log.Printf("当前配对码: %s", g.pin)
	}
}

func (g *agentGuard) rotatePINLocked() {
	if g.token != "" {
		return
	}
	if g.pin != "" && time.Now().Before(g.pinExpires) {
		return
	}
	pin, err := randomPIN()
	if err != nil {
		return
	}
	g.pin = pin
	g.pinExpires = time.Now().Add(pinLifetime)
}

func (g *agentGuard) currentPIN() string {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.token != "" {
		return "已配对"
	}
	return g.pin
}

func (g *agentGuard) originList() string {
	out := make([]string, 0, len(g.origins))
	for origin := range g.origins {
		out = append(out, origin)
	}
	return strings.Join(out, ", ")
}

func defaultOrigins() map[string]bool {
	values := []string{
		"https://stargrow.store",
		"https://www.stargrow.store",
		"https://starbase-9o0.pages.dev",
		"https://starbase.pages.dev",
		"https://starbase-api.stargrow.store",
		"http://localhost:5173",
		"http://127.0.0.1:5173",
		"http://localhost:8620",
		"http://127.0.0.1:8620",
	}
	out := make(map[string]bool, len(values))
	for _, value := range values {
		out[value] = true
	}
	return out
}

func normalizeOrigin(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return ""
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return ""
	}
	return strings.ToLower(parsed.Scheme + "://" + parsed.Host)
}

func randomPIN() (string, error) {
	buffer := make([]byte, 4)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}
	value := (uint32(buffer[0])<<24 | uint32(buffer[1])<<16 | uint32(buffer[2])<<8 | uint32(buffer[3])) % 1000000
	return fmt.Sprintf("%06d", value), nil
}

func randomHex(size int) (string, error) {
	buffer := make([]byte, size)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}
	return hex.EncodeToString(buffer), nil
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func ensureLoopback(addr string) error {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return fmt.Errorf("监听地址格式错误: %w", err)
	}
	ip := net.ParseIP(strings.Trim(host, "[]"))
	if ip == nil || !ip.IsLoopback() {
		return fmt.Errorf("为了安全，Agent 只能监听 127.0.0.1 或 ::1")
	}
	return nil
}

func resolveDataDir(flagValue string) string {
	for _, candidate := range []string{flagValue, os.Getenv("STARBASE_AGENT_DATA")} {
		if trimmed := strings.TrimSpace(candidate); trimmed != "" {
			abs, err := filepath.Abs(trimmed)
			if err == nil {
				return abs
			}
			return trimmed
		}
	}
	base, err := os.UserConfigDir()
	if err != nil || strings.TrimSpace(base) == "" {
		base = "."
	}
	return filepath.Join(base, "StarBaseAgent")
}
