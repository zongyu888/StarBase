package access

import (
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"navideck/backend/internal/model"
)

type UserContext struct {
	UserID  string
	Role    string
	IsAdmin bool
}

type IPLookup func(ctx context.Context, host string) ([]net.IP, error)

type cachedResult struct {
	err     error
	expires time.Time
}

type Policy struct {
	DataDir                  string
	AllowPrivateForAdmin     bool
	AllowServerPathsForAdmin bool
	AllowedHosts             []string
	LocalIPs                 map[string]bool
	Lookup                   IPLookup

	mu    sync.Mutex
	cache map[string]cachedResult
}

func NewPolicy(dataDir string, allowPrivateAdmin, allowServerPathsAdmin bool, allowedHosts []string, localIPs []string) *Policy {
	allowed := make([]string, 0, len(allowedHosts))
	for _, item := range allowedHosts {
		item = strings.ToLower(strings.TrimSpace(item))
		if item == "" {
			continue
		}
		if strings.HasPrefix(item, "*.") {
			item = item[1:]
		}
		allowed = append(allowed, item)
	}
	locals := make(map[string]bool, len(localIPs))
	for _, item := range localIPs {
		ip := parseIP(item)
		if ip != nil {
			locals[ip.String()] = true
		}
	}
	policy := &Policy{
		DataDir:                  dataDir,
		AllowPrivateForAdmin:     allowPrivateAdmin,
		AllowServerPathsForAdmin: allowServerPathsAdmin,
		AllowedHosts:             allowed,
		LocalIPs:                 locals,
		cache:                    make(map[string]cachedResult),
	}
	policy.Lookup = policy.defaultLookup
	return policy
}

func (p *Policy) defaultLookup(ctx context.Context, host string) ([]net.IP, error) {
	addresses, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, err
	}
	out := make([]net.IP, 0, len(addresses))
	for _, address := range addresses {
		out = append(out, address.IP)
	}
	return out, nil
}

func (p *Policy) ValidateConnectionCached(ctx context.Context, conn model.Connection, user UserContext) error {
	// Oracle 驱动无法注入自定义拨号器，因此不做缓存，避免 DNS 重绑定窗口。
	if conn.Driver == model.DriverOracle {
		return p.ValidateConnection(ctx, conn, user)
	}
	key := strings.Join([]string{
		conn.ID, conn.Driver, conn.Host, fmt.Sprint(conn.Port), conn.Database,
		conn.SQLitePath, conn.OracleWallet, conn.Account, conn.Tenant, user.UserID, user.Role,
	}, "\x00")
	now := time.Now()
	p.mu.Lock()
	if result, ok := p.cache[key]; ok && result.expires.After(now) {
		p.mu.Unlock()
		return result.err
	}
	p.mu.Unlock()

	err := p.ValidateConnection(ctx, conn, user)
	p.mu.Lock()
	if _, exists := p.cache[key]; !exists && len(p.cache) >= 1024 {
		for itemKey, result := range p.cache {
			if result.expires.Before(now) {
				delete(p.cache, itemKey)
			}
		}
		for itemKey := range p.cache {
			if len(p.cache) < 1024 {
				break
			}
			delete(p.cache, itemKey)
		}
	}
	p.cache[key] = cachedResult{err: err, expires: now.Add(30 * time.Second)}
	p.mu.Unlock()
	return err
}

var (
	hostLabelPattern  = regexp.MustCompile(`^[A-Za-z0-9_]([A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?$`)
	snowflakeAccount  = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,190}$`)
	sqlServerInstance = regexp.MustCompile(`^[A-Za-z0-9_\\-]+$`)
)

func (p *Policy) ValidateConnection(ctx context.Context, conn model.Connection, user UserContext) error {
	if conn.Driver == model.DriverSQLite {
		return p.validateSQLite(conn.SQLitePath, user)
	}
	if conn.Driver == model.DriverSnowflake {
		if !snowflakeAccount.MatchString(strings.TrimSpace(conn.Account)) {
			return errors.New("Snowflake 账户标识格式不正确")
		}
		return nil
	}
	if !user.IsAdmin && strings.TrimSpace(conn.OracleWallet) != "" {
		return errors.New("出于安全隔离，普通用户不能使用服务器本地 Oracle Wallet")
	}
	if err := validateHostSyntax(conn.Host); err != nil {
		return err
	}
	port := conn.Port
	if port == 0 {
		port = model.DefaultPort(conn.Driver)
	}
	if port < 1 || port > 65535 {
		return errors.New("数据库端口需在 1-65535 之间")
	}
	if err := validateCredentialFields(conn); err != nil {
		return err
	}
	if user.IsAdmin && p.AllowPrivateForAdmin {
		return nil
	}
	host := strings.ToLower(strings.TrimSpace(conn.Host))
	if p.hostAllowed(host) {
		return nil
	}
	ips, err := p.resolveHost(ctx, host)
	if err != nil {
		return fmt.Errorf("无法解析数据库主机 %q: %w", conn.Host, err)
	}
	usable := make([]net.IP, 0, len(ips))
	for _, ip := range ips {
		if p.blockedTargetIP(ip) {
			continue
		}
		usable = append(usable, normalizeIP(ip))
	}
	if len(usable) == 0 {
		return fmt.Errorf("出于安全隔离，禁止连接本机/内网地址 %q；请使用公网数据库，或联系管理员配置允许列表", conn.Host)
	}
	return nil
}

// blockedTargetIP 判断解析结果是否应被拒绝。只要域名仍解析出一个可用地址，
// 就不因为 DNS 同时返回内网/本机地址而整体拒绝——拨号阶段只会尝试可用地址。
func (p *Policy) blockedTargetIP(ip net.IP) bool {
	normalized := normalizeIP(ip)
	if normalized == nil {
		return true
	}
	if isProxyVirtualIP(normalized) {
		return false
	}
	if isBlockedIP(normalized) {
		return true
	}
	if p.LocalIPs[normalized.String()] {
		return true
	}
	return false
}

// isProxyVirtualIP 识别 Clash / Mihomo 等 TUN 代理的 fake-IP 段。
// 这些地址是本机虚拟网卡地址，但目标并不是本机服务，不能按“本机/内网”拦截。
func isProxyVirtualIP(ip net.IP) bool {
	if v4 := ip.To4(); v4 != nil {
		return v4[0] == 198 && (v4[1] == 18 || v4[1] == 19)
	}
	if len(ip) != net.IPv6len {
		return false
	}
	if ip[0] == 0x20 && ip[1] == 0x01 && ip[2] == 0x00 && ip[3] == 0x02 &&
		ip[4] == 0x00 && ip[5] == 0x00 {
		return true
	}
	return ip[0] == 0xfd && ip[1] == 0xfe && ip[2] == 0xdc && ip[3] == 0xba &&
		ip[4] == 0x98 && ip[5] == 0x76 && ip[6] == 0x00 && ip[7] == 0x00
}

func (p *Policy) validateSQLite(path string, user UserContext) error {
	path = strings.TrimSpace(path)
	if path == "" {
		return errors.New("SQLite 数据库文件路径不能为空")
	}
	if strings.ContainsRune(path, '\x00') {
		return errors.New("SQLite 路径包含非法字符")
	}
	if user.IsAdmin && p.AllowServerPathsForAdmin {
		return nil
	}
	base := p.DataDir
	if base == "" {
		return errors.New("服务器数据目录未配置")
	}
	absBase, err := filepath.Abs(base)
	if err != nil {
		return err
	}
	var absPath string
	if filepath.IsAbs(path) {
		absPath = filepath.Clean(path)
	} else {
		absPath = filepath.Join(absBase, path)
	}
	var root string
	if user.IsAdmin {
		root = absBase
	} else {
		root = filepath.Join(absBase, "users", user.UserID)
	}
	root, _ = filepath.Abs(root)
	if !withinRoot(root, absPath) {
		return errors.New("出于安全隔离，普通用户只能访问自己的 SQLite 沙箱目录，不能读取服务器其他文件")
	}
	if err := ensureNoSymlinkEscape(root, absPath); err != nil {
		return err
	}
	return nil
}

func (p *Policy) resolveHost(ctx context.Context, host string) ([]net.IP, error) {
	if parsed := parseIP(host); parsed != nil {
		return []net.IP{parsed}, nil
	}
	lookupCtx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()
	ips, err := p.Lookup(lookupCtx, host)
	if err != nil {
		return nil, err
	}
	if len(ips) == 0 {
		return nil, errors.New("没有解析到地址")
	}
	return ips, nil
}

type allowPrivateKey struct{}

// WithAllowPrivate 由认证中间件注入：管理员连接本机/内网时需要显式放行。
func WithAllowPrivate(ctx context.Context, allow bool) context.Context {
	return context.WithValue(ctx, allowPrivateKey{}, allow)
}

func allowPrivate(ctx context.Context) bool {
	value, _ := ctx.Value(allowPrivateKey{}).(bool)
	return value
}

// AllowPrivate 返回当前请求上下文是否已放行本机/内网地址。
func AllowPrivate(ctx context.Context) bool {
	return allowPrivate(ctx)
}

// DialContext 在真正建立 TCP 连接时再次解析并锁定 IP，防止 DNS 重绑定绕过保存时的检查。
func (p *Policy) DialContext(ctx context.Context, network, address string) (net.Conn, error) {
	dialer := &net.Dialer{Timeout: 15 * time.Second, KeepAlive: 30 * time.Second}
	if allowPrivate(ctx) {
		return dialer.DialContext(ctx, network, address)
	}
	if network != "tcp" && network != "tcp4" && network != "tcp6" {
		return nil, fmt.Errorf("安全隔离：不允许使用 %s 网络连接数据库", network)
	}
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	host = strings.Trim(host, "[]")
	if p.hostAllowed(strings.ToLower(host)) {
		return dialer.DialContext(ctx, network, address)
	}
	ips, err := p.resolveHost(ctx, host)
	if err != nil {
		return nil, fmt.Errorf("无法解析数据库主机 %q: %w", host, err)
	}
	usable := make([]net.IP, 0, len(ips))
	for _, ip := range ips {
		if p.blockedTargetIP(ip) {
			continue
		}
		usable = append(usable, normalizeIP(ip))
	}
	if len(usable) == 0 {
		return nil, fmt.Errorf("出于安全隔离，禁止连接本机/内网地址 %q", host)
	}
	var lastErr error
	for _, ip := range usable {
		target := net.JoinHostPort(ip.String(), port)
		conn, dialErr := dialer.DialContext(ctx, network, target)
		if dialErr == nil {
			return conn, nil
		}
		lastErr = dialErr
	}
	if lastErr == nil {
		lastErr = errors.New("没有可连接的地址")
	}
	return nil, lastErr
}

func (p *Policy) hostAllowed(host string) bool {
	host = strings.TrimSuffix(strings.ToLower(strings.TrimSpace(host)), ".")
	for _, allowed := range p.AllowedHosts {
		if allowed == host {
			return true
		}
		if strings.HasPrefix(allowed, ".") && strings.HasSuffix(host, allowed) {
			return true
		}
	}
	return false
}

func withinRoot(root, target string) bool {
	root = filepath.Clean(root)
	target = filepath.Clean(target)
	if target == root {
		return true
	}
	return strings.HasPrefix(target, root+string(os.PathSeparator))
}

func ensureNoSymlinkEscape(root, target string) error {
	resolvedRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		// 沙箱目录尚未创建时没有已存在的符号链接可跳出；上面的词法校验已经限制在沙箱内。
		return nil
	}
	if _, err := os.Lstat(target); err == nil {
		resolvedTarget, err := filepath.EvalSymlinks(target)
		if err != nil {
			return err
		}
		if !withinRoot(resolvedRoot, resolvedTarget) {
			return errors.New("SQLite 路径不能通过符号链接跳出个人沙箱")
		}
		return nil
	}
	parent := filepath.Dir(target)
	for {
		resolved, err := filepath.EvalSymlinks(parent)
		if err == nil {
			if !withinRoot(resolvedRoot, resolved) {
				return errors.New("SQLite 路径不能通过符号链接跳出个人沙箱")
			}
			return nil
		}
		next := filepath.Dir(parent)
		if next == parent {
			return nil
		}
		parent = next
	}
}

func validateHostSyntax(host string) error {
	host = strings.TrimSpace(host)
	if host == "" {
		return errors.New("数据库主机不能为空")
	}
	if len(host) > 253 {
		return errors.New("数据库主机名过长")
	}
	if strings.ContainsAny(host, " /\\?#@") {
		return errors.New("数据库主机名包含非法字符")
	}
	if parseIP(strings.Trim(host, "[]")) != nil {
		return nil
	}
	if strings.Contains(host, ":") {
		return errors.New("数据库主机名格式不正确")
	}
	if strings.Contains(host, "..") || strings.HasPrefix(host, ".") || strings.HasSuffix(host, ".") {
		return errors.New("数据库主机名格式不正确")
	}
	for _, label := range strings.Split(host, ".") {
		if !hostLabelPattern.MatchString(label) {
			return errors.New("数据库主机名格式不正确")
		}
	}
	return nil
}

func validateCredentialFields(conn model.Connection) error {
	for _, value := range []string{conn.Username, conn.Database, conn.Instance, conn.Account, conn.Tenant} {
		if strings.ContainsRune(value, '\x00') {
			return errors.New("连接参数包含非法字符")
		}
	}
	for _, r := range conn.Username + conn.Database + conn.Instance + conn.Account + conn.Tenant {
		if r < 0x20 || r == 0x7f {
			return errors.New("连接参数包含控制字符")
		}
	}
	if conn.Driver == model.DriverMySQL || conn.Driver == model.DriverMariaDB {
		if strings.ContainsAny(conn.Database, "?/\\#") {
			return errors.New("MySQL 数据库名包含非法字符")
		}
		if strings.ContainsAny(conn.Username, "@:?/#") {
			return errors.New("MySQL 用户名包含非法字符")
		}
	}
	if conn.Driver == model.DriverSQLServer && conn.Instance != "" {
		if !sqlServerInstance.MatchString(conn.Instance) {
			return errors.New("SQL Server 实例名格式不正确")
		}
	}
	return nil
}

func parseIP(value string) net.IP {
	value = strings.TrimSpace(value)
	value = strings.Trim(value, "[]")
	return net.ParseIP(value)
}

func normalizeIP(ip net.IP) net.IP {
	if ip == nil {
		return nil
	}
	if v4 := ip.To4(); v4 != nil {
		return v4
	}
	return ip
}

func isBlockedIP(ip net.IP) bool {
	if ip == nil {
		return true
	}
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() ||
		ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
		ip.IsMulticast() || ip.IsInterfaceLocalMulticast() {
		return true
	}
	if v4 := ip.To4(); v4 != nil {
		if v4[0] == 100 && v4[1] >= 64 && v4[1] <= 127 {
			return true
		}
		if v4[0] == 169 && v4[1] == 254 {
			return true
		}
	}
	return false
}
