package auth

import (
	"crypto/rand"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math/big"
	"mime"
	"net"
	"net/smtp"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	emailCodeTTL      = 5 * time.Minute
	emailCodeCooldown = 60 * time.Second
	emailCodeAttempts = 5
)

type MailConfig struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Username string `json:"username"`
	Password string `json:"password"`
	From     string `json:"from"`
	FromName string `json:"fromName"`
	DevCodes bool   `json:"-"`
}

// LoadMailConfig 优先使用环境变量，缺失项由 data/mail.json 补齐。
// mail.json 位于数据目录且被 .gitignore 忽略，适合保存部署环境的 SMTP 密码。
func LoadMailConfig(dataDir string, base MailConfig) (MailConfig, bool, error) {
	path := filepath.Join(dataDir, "mail.json")
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return base, false, nil
	}
	if err != nil {
		return base, false, err
	}
	var fileCfg MailConfig
	if err := json.Unmarshal(raw, &fileCfg); err != nil {
		return base, false, fmt.Errorf("解析 mail.json 失败: %w", err)
	}
	if base.Host == "" {
		base.Host = fileCfg.Host
	}
	if base.Port <= 0 {
		base.Port = fileCfg.Port
	}
	if base.Username == "" {
		base.Username = fileCfg.Username
	}
	if base.Password == "" {
		base.Password = fileCfg.Password
	}
	if base.From == "" {
		base.From = fileCfg.From
	}
	if base.From == "" && strings.Contains(base.Username, "@") {
		base.From = base.Username
	}
	if base.FromName == "" {
		base.FromName = fileCfg.FromName
	}
	return base, true, nil
}

type emailCodeEntry struct {
	code     string
	expireAt time.Time
	attempts int
}

type EmailCodes struct {
	cfg      MailConfig
	mu       sync.Mutex
	codes    map[string]emailCodeEntry
	cooldown map[string]time.Time
}

func NewEmailCodes(cfg MailConfig) *EmailCodes {
	cfg.Host = strings.TrimSpace(cfg.Host)
	cfg.Username = strings.TrimSpace(cfg.Username)
	cfg.From = strings.TrimSpace(cfg.From)
	if cfg.Port <= 0 {
		cfg.Port = 465
	}
	if cfg.From == "" && strings.Contains(cfg.Username, "@") {
		cfg.From = cfg.Username
	}
	if strings.TrimSpace(cfg.FromName) == "" {
		cfg.FromName = "StarBase"
	}
	return &EmailCodes{
		cfg:      cfg,
		codes:    make(map[string]emailCodeEntry),
		cooldown: make(map[string]time.Time),
	}
}

func (s *EmailCodes) Configured() bool {
	return s.cfg.Host != "" && s.cfg.From != ""
}

func (s *EmailCodes) DevCodes() bool { return s.cfg.DevCodes }

func (s *EmailCodes) Send(to, scene string) (string, error) {
	to = normalizeEmail(to)
	sceneTitle := "注册验证"
	switch scene {
	case "reset":
		sceneTitle = "重置密码"
	case "test":
		sceneTitle = "测试邮件"
	}
	now := time.Now()
	s.mu.Lock()
	if until, ok := s.cooldown[to]; ok && until.After(now) {
		remaining := int(time.Until(until).Seconds()) + 1
		s.mu.Unlock()
		return "", NewError(429, fmt.Sprintf("发送太频繁，请 %d 秒后再试", remaining))
	}
	s.cooldown[to] = now.Add(emailCodeCooldown)
	s.mu.Unlock()

	code := randomNumericCode(6)
	if !s.Configured() {
		if !s.cfg.DevCodes {
			s.releaseCooldown(to)
			return "", NewError(503, "邮件服务未配置：请设置 NAVIDECK_SMTP_HOST、NAVIDECK_SMTP_FROM 等环境变量")
		}
		log.Printf("[auth] SMTP 未配置（开发模式），邮箱 %s 的%s验证码: %s", to, sceneTitle, code)
		s.storeCode(to, code)
		return code, nil
	}
	subject := "【" + s.cfg.FromName + "】" + sceneTitle
	if err := s.sendMail(to, subject, buildEmailHTML(code, s.cfg.FromName, sceneTitle)); err != nil {
		log.Printf("[auth] 邮件发送失败: %s — %v", to, err)
		s.releaseCooldown(to)
		return "", NewError(502, "邮件发送失败，请稍后重试")
	}
	s.storeCode(to, code)
	log.Printf("[auth] %s验证码邮件已发送: %s", sceneTitle, to)
	return "", nil
}

func (s *EmailCodes) Verify(to, input string) bool {
	to = normalizeEmail(to)
	input = strings.TrimSpace(input)
	if to == "" || input == "" {
		return false
	}
	now := time.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, ok := s.codes[to]
	if !ok {
		return false
	}
	if entry.expireAt.Before(now) {
		delete(s.codes, to)
		return false
	}
	if entry.code != input {
		entry.attempts++
		if entry.attempts >= emailCodeAttempts {
			delete(s.codes, to)
		} else {
			s.codes[to] = entry
		}
		return false
	}
	delete(s.codes, to)
	return true
}

func (s *EmailCodes) storeCode(email, code string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	if len(s.codes) > 5000 {
		for key, entry := range s.codes {
			if entry.expireAt.Before(now) {
				delete(s.codes, key)
			}
		}
	}
	s.codes[email] = emailCodeEntry{code: code, expireAt: now.Add(emailCodeTTL)}
}

func (s *EmailCodes) releaseCooldown(email string) {
	s.mu.Lock()
	delete(s.cooldown, email)
	s.mu.Unlock()
}

func randomNumericCode(length int) string {
	var b strings.Builder
	for i := 0; i < length; i++ {
		n, err := rand.Int(rand.Reader, big.NewInt(10))
		if err != nil {
			b.WriteByte('0')
			continue
		}
		b.WriteByte(byte('0' + n.Int64()))
	}
	return b.String()
}

func (s *EmailCodes) sendMail(to, subject, html string) error {
	addr := net.JoinHostPort(s.cfg.Host, strconv.Itoa(s.cfg.Port))
	tlsCfg := &tls.Config{ServerName: s.cfg.Host, MinVersion: tls.VersionTLS12}

	var conn net.Conn
	var err error
	if s.cfg.Port == 465 {
		conn, err = tls.DialWithDialer(&net.Dialer{Timeout: 15 * time.Second}, "tcp", addr, tlsCfg)
	} else {
		conn, err = net.DialTimeout("tcp", addr, 15*time.Second)
	}
	if err != nil {
		return fmt.Errorf("连接 SMTP 失败: %w", err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(30 * time.Second))

	client, err := smtp.NewClient(conn, s.cfg.Host)
	if err != nil {
		return fmt.Errorf("SMTP 握手失败: %w", err)
	}
	defer client.Close()
	if s.cfg.Port != 465 {
		if ok, _ := client.Extension("STARTTLS"); ok {
			if err := client.StartTLS(tlsCfg); err != nil {
				return fmt.Errorf("STARTTLS 失败: %w", err)
			}
		}
	}
	if s.cfg.Username != "" {
		if ok, _ := client.Extension("AUTH"); ok {
			if err := client.Auth(smtp.PlainAuth("", s.cfg.Username, s.cfg.Password, s.cfg.Host)); err != nil {
				return fmt.Errorf("SMTP 认证失败: %w", err)
			}
		}
	}
	if err := client.Mail(s.cfg.From); err != nil {
		return err
	}
	if err := client.Rcpt(to); err != nil {
		return err
	}
	w, err := client.Data()
	if err != nil {
		return err
	}
	if _, err := w.Write([]byte(s.buildMessage(to, subject, html))); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	return client.Quit()
}

func (s *EmailCodes) buildMessage(to, subject, html string) string {
	var b strings.Builder
	b.WriteString("From: " + mime.BEncoding.Encode("UTF-8", s.cfg.FromName) + " <" + s.cfg.From + ">\r\n")
	b.WriteString("To: " + to + "\r\n")
	b.WriteString("Subject: " + mime.BEncoding.Encode("UTF-8", subject) + "\r\n")
	b.WriteString("Date: " + time.Now().Format(time.RFC1123Z) + "\r\n")
	b.WriteString("MIME-Version: 1.0\r\n")
	b.WriteString("Content-Type: text/html; charset=UTF-8\r\n")
	b.WriteString("Content-Transfer-Encoding: base64\r\n\r\n")
	b.WriteString(wrapBase64(html))
	b.WriteString("\r\n")
	return b.String()
}

func wrapBase64(s string) string {
	enc := base64.StdEncoding.EncodeToString([]byte(s))
	var b strings.Builder
	for len(enc) > 76 {
		b.WriteString(enc[:76])
		b.WriteString("\r\n")
		enc = enc[76:]
	}
	b.WriteString(enc)
	return b.String()
}

func buildEmailHTML(code, siteName, sceneTitle string) string {
	return "<!DOCTYPE html>" +
		"<html lang=\"zh-CN\"><head><meta charset=\"UTF-8\"></head>" +
		"<body style=\"margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;\">" +
		"<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"background:#f1f5f9;\">" +
		"<tr><td align=\"center\" style=\"padding:24px 12px;\">" +
		"<table role=\"presentation\" width=\"600\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;\">" +
		"<tr><td style=\"background:#0f172a;padding:10px 24px;text-align:center;\">" +
		"<span style=\"color:#94a3b8;font-size:12px;\">系统邮件，请勿回复</span>" +
		"</td></tr>" +
		"<tr><td align=\"center\" style=\"padding:28px 24px 8px;\">" +
		"<h1 style=\"margin:0;color:#1e293b;font-size:21px;\">" + siteName + " " + sceneTitle + "</h1>" +
		"</td></tr>" +
		"<tr><td align=\"center\" style=\"padding:4px 24px 20px;\">" +
		"<p style=\"margin:0;color:#64748b;font-size:14px;\">请使用以下验证码完成操作</p>" +
		"</td></tr>" +
		"<tr><td align=\"center\" style=\"padding:0 24px;\">" +
		"<div style=\"background:#0ea5e9;background:linear-gradient(135deg,#0284c7 0%,#0ea5e9 100%);border-radius:10px;padding:22px;max-width:360px;margin:0 auto;\">" +
		"<div style=\"color:#ffffff;font-size:36px;font-weight:900;letter-spacing:10px;font-family:'Courier New',monospace;\">" + code + "</div>" +
		"</div>" +
		"</td></tr>" +
		"<tr><td style=\"padding:22px 28px;color:#64748b;font-size:13px;line-height:1.8;\">" +
		"· 验证码 <strong style=\"color:#1e293b;\">5 分钟</strong>内有效<br/>" +
		"· 请勿将验证码泄露给他人<br/>" +
		"· 如非本人操作，请忽略此邮件" +
		"</td></tr>" +
		"</table></td></tr></table></body></html>"
}
