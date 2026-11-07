package auth

import "time"

const (
	RoleAdmin = "ADMIN"
	RoleUser  = "USER"
)

type User struct {
	ID            string     `json:"id"`
	Username      string     `json:"username"`
	Email         string     `json:"email"`
	DisplayName   string     `json:"displayName"`
	PasswordHash  string     `json:"passwordHash"`
	Role          string     `json:"role"`
	Enabled       bool       `json:"enabled"`
	EmailVerified bool       `json:"emailVerified"`
	TokenVersion  int        `json:"tokenVersion"`
	CreatedAt     time.Time  `json:"createdAt"`
	UpdatedAt     time.Time  `json:"updatedAt"`
	LastLoginAt   *time.Time `json:"lastLoginAt,omitempty"`
}

func (u *User) IsAdmin() bool { return u != nil && u.Role == RoleAdmin }

type UserProfile struct {
	ID            string     `json:"id"`
	Username      string     `json:"username"`
	Email         string     `json:"email"`
	DisplayName   string     `json:"displayName"`
	Role          string     `json:"role"`
	Enabled       bool       `json:"enabled"`
	EmailVerified bool       `json:"emailVerified"`
	CreatedAt     time.Time  `json:"createdAt"`
	LastLoginAt   *time.Time `json:"lastLoginAt,omitempty"`
}

func (u *User) Profile() UserProfile {
	return UserProfile{
		ID:            u.ID,
		Username:      u.Username,
		Email:         u.Email,
		DisplayName:   u.DisplayName,
		Role:          u.Role,
		Enabled:       u.Enabled,
		EmailVerified: u.EmailVerified,
		CreatedAt:     u.CreatedAt,
		LastLoginAt:   u.LastLoginAt,
	}
}

type Status struct {
	AuthEnabled         bool `json:"authEnabled"`
	RegistrationEnabled bool `json:"registrationEnabled"`
	MailConfigured      bool `json:"mailConfigured"`
	DevCodes            bool `json:"devCodes"`
	HasUsers            bool `json:"hasUsers"`
}

type RegisterRequest struct {
	Username    string `json:"username"`
	Email       string `json:"email"`
	DisplayName string `json:"displayName"`
	Password    string `json:"password"`
	VerifyCode  string `json:"verifyCode"`
	CaptchaID   string `json:"captchaId"`
	CaptchaCode string `json:"captchaCode"`
}

type LoginRequest struct {
	Login       string `json:"login"`
	Password    string `json:"password"`
	CaptchaID   string `json:"captchaId"`
	CaptchaCode string `json:"captchaCode"`
}

type EmailCodeRequest struct {
	Email string `json:"email"`
	Scene string `json:"scene"`
}

type ResetPasswordRequest struct {
	Email       string `json:"email"`
	VerifyCode  string `json:"verifyCode"`
	NewPassword string `json:"newPassword"`
	CaptchaID   string `json:"captchaId"`
	CaptchaCode string `json:"captchaCode"`
}

type ChangePasswordRequest struct {
	OldPassword string `json:"oldPassword"`
	NewPassword string `json:"newPassword"`
}

type CaptchaChallenge struct {
	CaptchaID   string `json:"captchaId"`
	ImageBase64 string `json:"imageBase64"`
	DevCode     string `json:"devCode,omitempty"`
}

type AuthResponse struct {
	User UserProfile `json:"user"`
}

type EmailCodeResponse struct {
	OK      bool   `json:"ok"`
	Message string `json:"message"`
	DevCode string `json:"devCode,omitempty"`
}

type AdminUpdateUserRequest struct {
	Enabled *bool `json:"enabled"`
}

// Error carries an HTTP status for API mapping.
type Error struct {
	Status  int
	Message string
}

func (e *Error) Error() string { return e.Message }

func NewError(status int, message string) error {
	return &Error{Status: status, Message: message}
}

func StatusOf(err error) int {
	if e, ok := err.(*Error); ok && e.Status > 0 {
		return e.Status
	}
	return 0
}
