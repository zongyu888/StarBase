package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

const defaultTokenTTL = 72 * time.Hour

type Claims struct {
	Username string `json:"username"`
	Role     string `json:"role"`
	Version  int    `json:"ver"`
	jwt.RegisteredClaims
}

type Tokens struct {
	key     []byte
	ttl     time.Duration
	mu      sync.Mutex
	revoked map[string]int64
}

func LoadOrCreateSecret(dataDir string) (string, error) {
	if raw := strings.TrimSpace(os.Getenv("NAVIDECK_JWT_SECRET")); raw != "" {
		return raw, nil
	}
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return "", err
	}
	path := filepath.Join(dataDir, "session.key")
	if raw, err := os.ReadFile(path); err == nil && len(strings.TrimSpace(string(raw))) > 0 {
		return strings.TrimSpace(string(raw)), nil
	}
	buf := make([]byte, 48)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	secret := base64.RawURLEncoding.EncodeToString(buf)
	if err := os.WriteFile(path, []byte(secret), 0o600); err != nil {
		return "", err
	}
	return secret, nil
}

func NewTokens(secret string, ttl time.Duration) *Tokens {
	if ttl <= 0 {
		ttl = defaultTokenTTL
	}
	raw := []byte(secret)
	if len(raw) < 32 {
		sum := sha256.Sum256(raw)
		raw = sum[:]
	}
	return &Tokens{
		key:     raw,
		ttl:     ttl,
		revoked: make(map[string]int64),
	}
}

func (t *Tokens) TTL() time.Duration { return t.ttl }

func (t *Tokens) Issue(user *User) (string, time.Time, error) {
	now := time.Now()
	expires := now.Add(t.ttl)
	claims := &Claims{
		Username: user.Username,
		Role:     user.Role,
		Version:  user.TokenVersion,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   user.ID,
			ID:        strings.ReplaceAll(uuid.NewString(), "-", ""),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(expires),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString(t.key)
	if err != nil {
		return "", time.Time{}, err
	}
	return signed, expires, nil
}

func (t *Tokens) Parse(token string) (*Claims, error) {
	claims := &Claims{}
	parser := jwt.NewParser(
		jwt.WithValidMethods([]string{"HS256"}),
		jwt.WithLeeway(10*time.Second),
		jwt.WithExpirationRequired(),
	)
	tok, err := parser.ParseWithClaims(token, claims, func(parsed *jwt.Token) (any, error) {
		return t.key, nil
	})
	if err != nil || !tok.Valid {
		return nil, errors.New("会话无效或已过期")
	}
	if claims.Subject == "" || claims.ID == "" {
		return nil, errors.New("会话无效")
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if exp, ok := t.revoked[claims.ID]; ok {
		if exp > time.Now().Unix() {
			return nil, errors.New("会话已退出")
		}
		delete(t.revoked, claims.ID)
	}
	return claims, nil
}

func (t *Tokens) Revoke(token string) {
	claims := &Claims{}
	parser := jwt.NewParser(jwt.WithValidMethods([]string{"HS256"}), jwt.WithoutClaimsValidation())
	if _, err := parser.ParseWithClaims(token, claims, func(parsed *jwt.Token) (any, error) {
		return t.key, nil
	}); err != nil {
		return
	}
	if claims.ID == "" {
		return
	}
	exp := time.Now().Add(t.ttl).Unix()
	if claims.ExpiresAt != nil {
		exp = claims.ExpiresAt.Unix()
	}
	now := time.Now().Unix()
	t.mu.Lock()
	defer t.mu.Unlock()
	if len(t.revoked) > 5000 {
		for id, until := range t.revoked {
			if until <= now {
				delete(t.revoked, id)
			}
		}
	}
	if exp > now {
		t.revoked[claims.ID] = exp
	}
}
