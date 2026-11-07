package access

import (
	"context"
	"errors"
	"net"
	"path/filepath"
	"strings"
	"testing"

	"navideck/backend/internal/model"
)

func newTestPolicy(t *testing.T, allowed []string, locals []string) (*Policy, string) {
	t.Helper()
	dir := t.TempDir()
	policy := NewPolicy(dir, true, true, allowed, locals)
	return policy, dir
}

func mysqlConn(host string) model.Connection {
	return model.Connection{ID: "c1", Driver: model.DriverMySQL, Host: host, Port: 3306, Database: "app", Username: "app"}
}

func TestPrivateAndLoopbackBlockedForUsers(t *testing.T) {
	policy, _ := newTestPolicy(t, nil, []string{"203.0.113.5"})
	user := UserContext{UserID: "u1", Role: "USER"}
	blocked := []string{"127.0.0.1", "10.1.2.3", "172.16.5.4", "192.168.1.10", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "203.0.113.5"}
	for _, host := range blocked {
		if err := policy.ValidateConnection(context.Background(), mysqlConn(host), user); err == nil {
			t.Fatalf("host %s should be blocked", host)
		}
	}
}

func TestPublicAndAllowlistedHosts(t *testing.T) {
	policy, _ := newTestPolicy(t, []string{".corp.example.com", "db.allowed.example"}, nil)
	policy.Lookup = func(ctx context.Context, host string) ([]net.IP, error) {
		if host == "public.example.com" {
			return []net.IP{net.ParseIP("93.184.216.34")}, nil
		}
		if host == "internal.corp.example.com" {
			return []net.IP{net.ParseIP("10.0.0.5")}, nil
		}
		return nil, errors.New("not found")
	}
	user := UserContext{UserID: "u1", Role: "USER"}
	if err := policy.ValidateConnection(context.Background(), mysqlConn("public.example.com"), user); err != nil {
		t.Fatalf("public host should pass: %v", err)
	}
	if err := policy.ValidateConnection(context.Background(), mysqlConn("internal.corp.example.com"), user); err != nil {
		t.Fatalf("allowlisted internal host should pass: %v", err)
	}
	if err := policy.ValidateConnection(context.Background(), mysqlConn("missing.example.com"), user); err == nil {
		t.Fatal("unresolvable host should fail")
	}
}

func TestHostnameResolvingPrivateBlocked(t *testing.T) {
	policy, _ := newTestPolicy(t, nil, nil)
	policy.Lookup = func(ctx context.Context, host string) ([]net.IP, error) {
		return []net.IP{net.ParseIP("127.0.0.1")}, nil
	}
	err := policy.ValidateConnection(context.Background(), mysqlConn("rebind.example.com"), UserContext{UserID: "u1", Role: "USER"})
	if err == nil || !strings.Contains(err.Error(), "安全隔离") {
		t.Fatalf("expected isolation error, got %v", err)
	}
}

func TestAdminCanUsePrivateWhenAllowed(t *testing.T) {
	policy, _ := newTestPolicy(t, nil, nil)
	admin := UserContext{UserID: "admin", Role: "ADMIN", IsAdmin: true}
	if err := policy.ValidateConnection(context.Background(), mysqlConn("127.0.0.1"), admin); err != nil {
		t.Fatalf("admin should pass: %v", err)
	}
}

func TestSQLiteSandbox(t *testing.T) {
	policy, dir := newTestPolicy(t, nil, nil)
	user := UserContext{UserID: "u1", Role: "USER"}
	okPath := filepath.Join("users", "u1", "demo.db")
	if err := policy.ValidateConnection(context.Background(), model.Connection{ID: "s1", Driver: model.DriverSQLite, SQLitePath: okPath}, user); err != nil {
		t.Fatalf("own sandbox should pass: %v", err)
	}
	badPaths := []string{
		"secret.key",
		"../secret.key",
		filepath.Join("users", "u2", "demo.db"),
		filepath.Join(dir, "secret.key"),
	}
	for _, path := range badPaths {
		conn := model.Connection{ID: "s1", Driver: model.DriverSQLite, SQLitePath: path}
		if err := policy.ValidateConnection(context.Background(), conn, user); err == nil {
			t.Fatalf("sqlite path %q should be blocked", path)
		}
	}
	admin := UserContext{UserID: "admin", Role: "ADMIN", IsAdmin: true}
	conn := model.Connection{ID: "s2", Driver: model.DriverSQLite, SQLitePath: "demo.db"}
	if err := policy.ValidateConnection(context.Background(), conn, admin); err != nil {
		t.Fatalf("admin sqlite should pass: %v", err)
	}
}

func TestCredentialInjectionBlocked(t *testing.T) {
	policy, _ := newTestPolicy(t, nil, nil)
	user := UserContext{UserID: "u1", Role: "USER"}
	conn := mysqlConn("db.example.com")
	conn.Database = "app?allowAllFiles=true"
	if err := policy.ValidateConnection(context.Background(), conn, user); err == nil {
		t.Fatal("mysql database injection should be blocked")
	}
	conn = mysqlConn("db.example.com")
	conn.Username = "root@127.0.0.1"
	if err := policy.ValidateConnection(context.Background(), conn, user); err == nil {
		t.Fatal("mysql username injection should be blocked")
	}
	conn = mysqlConn("db.example.com/evil")
	if err := policy.ValidateConnection(context.Background(), conn, user); err == nil {
		t.Fatal("invalid host should be blocked")
	}
}

func TestOracleWalletBlockedForUsers(t *testing.T) {
	policy, _ := newTestPolicy(t, nil, nil)
	conn := model.Connection{ID: "o1", Driver: model.DriverOracle, Host: "db.example.com", Port: 1521, Database: "ORCL", OracleWallet: "C:\\wallet"}
	err := policy.ValidateConnection(context.Background(), conn, UserContext{UserID: "u1", Role: "USER"})
	if err == nil {
		t.Fatal("oracle wallet should be blocked for users")
	}
}

func TestDialContextBlocksPrivateAndAllowsAdmin(t *testing.T) {
	policy, _ := newTestPolicy(t, nil, nil)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	address := listener.Addr().String()

	if _, err := policy.DialContext(context.Background(), "tcp", address); err == nil {
		t.Fatal("user dial to loopback should be blocked")
	}
	ctx := WithAllowPrivate(context.Background(), true)
	conn, err := policy.DialContext(ctx, "tcp", address)
	if err != nil {
		t.Fatalf("admin dial should pass: %v", err)
	}
	_ = conn.Close()
}

func TestProxyFakeIPAllowedForUsers(t *testing.T) {
	policy, _ := newTestPolicy(t, nil, []string{"198.18.0.1", "fdfe:dcba:9876::1"})
	policy.Lookup = func(ctx context.Context, host string) ([]net.IP, error) {
		switch host {
		case "db.public.example":
			return []net.IP{net.ParseIP("198.18.0.212"), net.ParseIP("2001:2::d0")}, nil
		case "db.clash6.example":
			return []net.IP{net.ParseIP("fdfe:dcba:9876::1234")}, nil
		default:
			return []net.IP{net.ParseIP("10.0.0.5")}, nil
		}
	}
	user := UserContext{UserID: "u1", Role: "USER"}
	for _, host := range []string{"db.public.example", "db.clash6.example"} {
		if err := policy.ValidateConnection(context.Background(), mysqlConn(host), user); err != nil {
			t.Fatalf("proxy fake-ip host %s should pass: %v", host, err)
		}
	}
	if err := policy.ValidateConnection(context.Background(), mysqlConn("db.internal.example"), user); err == nil {
		t.Fatal("real private host should still be blocked")
	}
}

func TestMixedDNSKeepsPublicAddress(t *testing.T) {
	policy, _ := newTestPolicy(t, nil, nil)
	policy.Lookup = func(ctx context.Context, host string) ([]net.IP, error) {
		return []net.IP{net.ParseIP("10.0.0.5"), net.ParseIP("93.184.216.34")}, nil
	}
	user := UserContext{UserID: "u1", Role: "USER"}
	if err := policy.ValidateConnection(context.Background(), mysqlConn("mixed.example.com"), user); err != nil {
		t.Fatalf("mixed DNS with a public address should pass: %v", err)
	}
}
