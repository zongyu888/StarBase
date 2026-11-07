package auth

import (
	"strings"
	"testing"
	"time"
)

func TestCaptchaIsOneTime(t *testing.T) {
	captchas := NewCaptchas()
	challenge := captchas.Generate(true)
	if challenge.CaptchaID == "" || challenge.DevCode == "" || !strings.HasPrefix(challenge.ImageBase64, "data:image/png;base64,") {
		t.Fatal("captcha challenge is incomplete")
	}
	if captchas.Verify(challenge.CaptchaID, "WRONG") {
		t.Fatal("wrong captcha should fail")
	}
	if !captchas.Verify(challenge.CaptchaID, strings.ToLower(challenge.DevCode)) {
		t.Fatal("correct captcha should pass case-insensitively")
	}
	if captchas.Verify(challenge.CaptchaID, challenge.DevCode) {
		t.Fatal("captcha must be one-time")
	}
}

func TestEmailCodeDevFlow(t *testing.T) {
	codes := NewEmailCodes(MailConfig{DevCodes: true})
	code, err := codes.Send("User@Example.com", "register")
	if err != nil {
		t.Fatalf("send dev code: %v", err)
	}
	if len(code) != 6 {
		t.Fatalf("unexpected code %q", code)
	}
	if _, err := codes.Send("User@Example.com", "register"); err == nil {
		t.Fatal("second send should hit cooldown")
	}
	if codes.Verify("user@example.com", "000000") && code != "000000" {
		t.Fatal("wrong code should fail")
	}
	if !codes.Verify("user@example.com", code) {
		t.Fatal("correct code should pass")
	}
	if codes.Verify("user@example.com", code) {
		t.Fatal("email code must be one-time")
	}
}

func TestJWTIssueParseRevoke(t *testing.T) {
	tokens := NewTokens("test-secret-with-enough-entropy-for-hs256", time.Hour)
	user := &User{ID: "u1", Username: "alice", Role: RoleUser, TokenVersion: 3}
	token, _, err := tokens.Issue(user)
	if err != nil {
		t.Fatal(err)
	}
	claims, err := tokens.Parse(token)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if claims.Subject != "u1" || claims.Username != "alice" || claims.Version != 3 {
		t.Fatalf("unexpected claims: %+v", claims)
	}
	tokens.Revoke(token)
	if _, err := tokens.Parse(token); err == nil {
		t.Fatal("revoked token should fail")
	}
}

func TestUsersUniqueness(t *testing.T) {
	users, err := OpenUsers(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	first := &User{Username: "Alice", Email: "alice@example.com", PasswordHash: "x", Role: RoleUser, Enabled: true}
	if err := users.Create(first); err != nil {
		t.Fatal(err)
	}
	if err := users.Create(&User{Username: "alice", Email: "other@example.com", PasswordHash: "x", Enabled: true}); err == nil {
		t.Fatal("duplicate username should fail")
	}
	if err := users.Create(&User{Username: "bob", Email: "ALICE@example.com", PasswordHash: "x", Enabled: true}); err == nil {
		t.Fatal("duplicate email should fail")
	}
	if found, err := users.FindByLogin("ALICE@example.com"); err != nil || found.ID != first.ID {
		t.Fatal("find by email should work")
	}
}

func TestCredentialValidation(t *testing.T) {
	valid := []string{"alice", "user_1", "张三丰", "a.b-c"}
	for _, name := range valid {
		if err := validateUsername(name); err != nil {
			t.Fatalf("username %q should pass: %v", name, err)
		}
	}
	invalid := []string{"ab", "has space", "bad/name", strings.Repeat("x", 33)}
	for _, name := range invalid {
		if err := validateUsername(name); err == nil {
			t.Fatalf("username %q should fail", name)
		}
	}
	if err := validatePassword("short"); err == nil {
		t.Fatal("short password should fail")
	}
	if err := validatePassword("long-enough-password"); err != nil {
		t.Fatal(err)
	}
	if err := validateEmail("not-an-email"); err == nil {
		t.Fatal("invalid email should fail")
	}
	if err := validateEmail("user@example.com"); err != nil {
		t.Fatal(err)
	}
}
