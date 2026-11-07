package auth

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

var (
	ErrUserNotFound = errors.New("user not found")
	ErrUserExists   = errors.New("user already exists")
)

type userFileData struct {
	Version int     `json:"version"`
	Users   []*User `json:"users"`
}

type Users struct {
	mu    sync.RWMutex
	path  string
	users []*User
}

func OpenUsers(dir string) (*Users, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	store := &Users{path: filepath.Join(dir, "users.json")}
	raw, err := os.ReadFile(store.path)
	if errors.Is(err, os.ErrNotExist) {
		return store, nil
	}
	if err != nil {
		return nil, err
	}
	var data userFileData
	if err := json.Unmarshal(raw, &data); err != nil {
		return nil, fmt.Errorf("parse users.json: %w", err)
	}
	for _, user := range data.Users {
		if user == nil || user.ID == "" {
			continue
		}
		if user.Role == "" {
			user.Role = RoleUser
		}
		store.users = append(store.users, user)
	}
	return store, nil
}

func (s *Users) Path() string { return s.path }

func (s *Users) Count() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.users)
}

func (s *Users) List() []UserProfile {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]UserProfile, 0, len(s.users))
	for _, user := range s.users {
		out = append(out, user.Profile())
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].CreatedAt.Equal(out[j].CreatedAt) {
			return out[i].Username < out[j].Username
		}
		return out[i].CreatedAt.Before(out[j].CreatedAt)
	})
	return out
}

func (s *Users) GetByID(id string) (*User, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, user := range s.users {
		if user.ID == id {
			copy := *user
			return &copy, nil
		}
	}
	return nil, ErrUserNotFound
}

func (s *Users) FindByUsername(username string) (*User, error) {
	needle := strings.ToLower(strings.TrimSpace(username))
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, user := range s.users {
		if strings.ToLower(user.Username) == needle {
			copy := *user
			return &copy, nil
		}
	}
	return nil, ErrUserNotFound
}

func (s *Users) FindByEmail(email string) (*User, error) {
	needle := normalizeEmail(email)
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, user := range s.users {
		if normalizeEmail(user.Email) == needle {
			copy := *user
			return &copy, nil
		}
	}
	return nil, ErrUserNotFound
}

func (s *Users) FindByLogin(login string) (*User, error) {
	login = strings.TrimSpace(login)
	if strings.Contains(login, "@") {
		if user, err := s.FindByEmail(login); err == nil {
			return user, nil
		}
	}
	return s.FindByUsername(login)
}

func (s *Users) Create(user *User) error {
	now := time.Now().UTC()
	if user.ID == "" {
		user.ID = uuid.NewString()
	}
	if user.Role == "" {
		user.Role = RoleUser
	}
	if user.CreatedAt.IsZero() {
		user.CreatedAt = now
	}
	user.UpdatedAt = now

	s.mu.Lock()
	defer s.mu.Unlock()
	username := strings.ToLower(strings.TrimSpace(user.Username))
	email := normalizeEmail(user.Email)
	for _, existing := range s.users {
		if strings.ToLower(existing.Username) == username {
			return ErrUserExists
		}
		if email != "" && normalizeEmail(existing.Email) == email {
			return ErrUserExists
		}
	}
	s.users = append(s.users, user)
	if err := s.persistLocked(); err != nil {
		s.users = s.users[:len(s.users)-1]
		return err
	}
	return nil
}

func (s *Users) Update(user *User) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	username := strings.ToLower(strings.TrimSpace(user.Username))
	email := normalizeEmail(user.Email)
	for i, existing := range s.users {
		if existing.ID == user.ID {
			for j, other := range s.users {
				if i == j {
					continue
				}
				if strings.ToLower(other.Username) == username {
					return ErrUserExists
				}
				if email != "" && normalizeEmail(other.Email) == email {
					return ErrUserExists
				}
			}
			user.UpdatedAt = time.Now().UTC()
			old := s.users[i]
			s.users[i] = user
			if err := s.persistLocked(); err != nil {
				s.users[i] = old
				return err
			}
			return nil
		}
	}
	return ErrUserNotFound
}

func (s *Users) RecordLogin(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, user := range s.users {
		if user.ID != id {
			continue
		}
		now := time.Now().UTC()
		user.LastLoginAt = &now
		user.UpdatedAt = now
		return s.persistLocked()
	}
	return ErrUserNotFound
}

func (s *Users) BumpTokenVersion(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, user := range s.users {
		if user.ID != id {
			continue
		}
		user.TokenVersion++
		user.UpdatedAt = time.Now().UTC()
		return s.persistLocked()
	}
	return ErrUserNotFound
}

func (s *Users) SetEnabled(id string, enabled bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, user := range s.users {
		if user.ID != id {
			continue
		}
		user.Enabled = enabled
		user.UpdatedAt = time.Now().UTC()
		return s.persistLocked()
	}
	return ErrUserNotFound
}

func (s *Users) Delete(id string) (*User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, user := range s.users {
		if user.ID != id {
			continue
		}
		removed := user
		s.users = append(s.users[:i], s.users[i+1:]...)
		if err := s.persistLocked(); err != nil {
			s.users = append(s.users[:i], append([]*User{removed}, s.users[i:]...)...)
			return nil, err
		}
		copy := *removed
		return &copy, nil
	}
	return nil, ErrUserNotFound
}

func (s *Users) persistLocked() error {
	data := userFileData{Version: 1, Users: s.users}
	if data.Users == nil {
		data.Users = []*User{}
	}
	raw, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}
