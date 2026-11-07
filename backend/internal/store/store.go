package store

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"navideck/backend/internal/model"
)

var ErrNotFound = errors.New("connection not found")

type storedConnection struct {
	model.Connection
	Secret string `json:"secret,omitempty"`
}

type fileData struct {
	Version     int                `json:"version"`
	Connections []storedConnection `json:"connections"`
}

type Store struct {
	mu          sync.RWMutex
	dir         string
	path        string
	queriesPath string
	key         []byte
	connections []model.Connection
	queries     []model.SavedQuery
	firstRun    bool
}

func Open(dir string) (*Store, error) {
	absDir, err := filepath.Abs(dir)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(absDir, 0o700); err != nil {
		return nil, err
	}
	key, err := loadOrCreateKey(filepath.Join(absDir, "secret.key"))
	if err != nil {
		return nil, fmt.Errorf("load secret key: %w", err)
	}

	s := &Store{
		dir:         absDir,
		path:        filepath.Join(absDir, "connections.json"),
		queriesPath: filepath.Join(absDir, "saved-queries.json"),
		key:         key,
	}

	raw, err := os.ReadFile(s.path)
	if os.IsNotExist(err) {
		s.firstRun = true
	} else if err != nil {
		return nil, err
	} else {
		var data fileData
		if err := json.Unmarshal(raw, &data); err != nil {
			return nil, fmt.Errorf("parse connections.json: %w", err)
		}
		for _, entry := range data.Connections {
			conn := entry.Connection
			conn.PasswordEncrypted = entry.Secret
			s.normalizeDefaults(&conn)
			s.connections = append(s.connections, conn)
		}
	}

	queryRaw, err := os.ReadFile(s.queriesPath)
	if err == nil {
		var data queryFileData
		if err := json.Unmarshal(queryRaw, &data); err != nil {
			return nil, fmt.Errorf("parse saved-queries.json: %w", err)
		}
		s.queries = data.Queries
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	return s, nil
}

func (s *Store) DataDir() string { return s.dir }

func (s *Store) FirstRun() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.firstRun
}

func (s *Store) ListFor(ownerID string, all bool) []model.Connection {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]model.Connection, 0, len(s.connections))
	for _, conn := range s.connections {
		if all || conn.OwnerID == ownerID {
			out = append(out, conn)
		}
	}
	return out
}

func (s *Store) GetFor(id, ownerID string, all bool) (model.Connection, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, conn := range s.connections {
		if conn.ID == id && (all || conn.OwnerID == ownerID) {
			return conn, nil
		}
	}
	return model.Connection{}, ErrNotFound
}

func (s *Store) AddFor(input model.ConnectionInput, ownerID string) (model.Connection, error) {
	conn, err := s.connectionFromInput(input, model.Connection{})
	if err != nil {
		return model.Connection{}, err
	}
	conn.ID = uuid.NewString()
	conn.OwnerID = ownerID
	conn.CreatedAt = time.Now().UTC()
	conn.UpdatedAt = conn.CreatedAt
	if input.Password != nil {
		secret, err := encryptSecret(s.key, *input.Password)
		if err != nil {
			return model.Connection{}, err
		}
		conn.PasswordEncrypted = secret
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.connections = append(s.connections, conn)
	if err := s.persistLocked(); err != nil {
		s.connections = s.connections[:len(s.connections)-1]
		return model.Connection{}, err
	}
	return conn, nil
}

func (s *Store) UpdateFor(id, ownerID string, all bool, input model.ConnectionInput) (model.Connection, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.connections {
		if s.connections[i].ID != id || (!all && s.connections[i].OwnerID != ownerID) {
			continue
		}
		updated, err := s.connectionFromInput(input, s.connections[i])
		if err != nil {
			return model.Connection{}, err
		}
		if input.Password != nil {
			secret, err := encryptSecret(s.key, *input.Password)
			if err != nil {
				return model.Connection{}, err
			}
			updated.PasswordEncrypted = secret
		}
		updated.UpdatedAt = time.Now().UTC()
		old := s.connections[i]
		s.connections[i] = updated
		if err := s.persistLocked(); err != nil {
			s.connections[i] = old
			return model.Connection{}, err
		}
		return updated, nil
	}
	return model.Connection{}, ErrNotFound
}

func (s *Store) DeleteFor(id, ownerID string, all bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.connections {
		if s.connections[i].ID != id || (!all && s.connections[i].OwnerID != ownerID) {
			continue
		}
		removed := s.connections[i]
		s.connections = append(s.connections[:i], s.connections[i+1:]...)
		if err := s.persistLocked(); err != nil {
			s.connections = append(s.connections[:i], append([]model.Connection{removed}, s.connections[i:]...)...)
			return err
		}
		return nil
	}
	return ErrNotFound
}

func (s *Store) Password(conn model.Connection) (string, error) {
	if conn.PasswordEncrypted == "" {
		return "", nil
	}
	return decryptSecret(s.key, conn.PasswordEncrypted)
}

func (s *Store) EnsureDemo(ownerID string) (model.Connection, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.connections {
		if s.connections[i].ID != "demo" {
			continue
		}
		if s.connections[i].OwnerID == "" && ownerID != "" {
			s.connections[i].OwnerID = ownerID
			if err := s.persistLocked(); err != nil {
				s.connections[i].OwnerID = ""
				return model.Connection{}, false, err
			}
		}
		return s.connections[i], false, nil
	}
	now := time.Now().UTC()
	conn := model.Connection{
		ID:         "demo",
		OwnerID:    ownerID,
		Name:       "示例数据库 · 电商",
		Driver:     model.DriverSQLite,
		SQLitePath: "demo.db",
		Database:   "main",
		Color:      "#e8a33d",
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	s.connections = append(s.connections, conn)
	if err := s.persistLocked(); err != nil {
		s.connections = s.connections[:len(s.connections)-1]
		return model.Connection{}, false, err
	}
	return conn, true, nil
}

func (s *Store) EnsureUserDemoConnection(ownerID, relPath, name string) (model.Connection, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, conn := range s.connections {
		if conn.OwnerID == ownerID && conn.Driver == model.DriverSQLite && conn.SQLitePath == relPath {
			return conn, false, nil
		}
	}
	input := model.ConnectionInput{
		Name:       name,
		Driver:     model.DriverSQLite,
		SQLitePath: relPath,
		Database:   "main",
		Color:      "#e8a33d",
	}
	conn, err := s.connectionFromInput(input, model.Connection{})
	if err != nil {
		return model.Connection{}, false, err
	}
	conn.ID = uuid.NewString()
	conn.OwnerID = ownerID
	conn.CreatedAt = time.Now().UTC()
	conn.UpdatedAt = conn.CreatedAt
	s.connections = append(s.connections, conn)
	if err := s.persistLocked(); err != nil {
		s.connections = s.connections[:len(s.connections)-1]
		return model.Connection{}, false, err
	}
	return conn, true, nil
}

func (s *Store) ClaimOwnerless(ownerID string) error {
	if ownerID == "" {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	oldConnections := append([]model.Connection(nil), s.connections...)
	oldQueries := append([]model.SavedQuery(nil), s.queries...)
	changedConnections := false
	for i := range s.connections {
		if s.connections[i].OwnerID == "" {
			s.connections[i].OwnerID = ownerID
			changedConnections = true
		}
	}
	changedQueries := false
	for i := range s.queries {
		if s.queries[i].OwnerID == "" {
			s.queries[i].OwnerID = ownerID
			changedQueries = true
		}
	}
	if changedConnections {
		if err := s.persistLocked(); err != nil {
			s.connections = oldConnections
			return err
		}
	}
	if changedQueries {
		if err := s.persistQueriesLocked(); err != nil {
			s.connections = oldConnections
			s.queries = oldQueries
			if changedConnections {
				_ = s.persistLocked()
			}
			return err
		}
	}
	return nil
}

func (s *Store) DeleteByOwner(ownerID string) ([]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	oldConnections := append([]model.Connection(nil), s.connections...)
	oldQueries := append([]model.SavedQuery(nil), s.queries...)
	removedIDs := make([]string, 0)
	kept := s.connections[:0]
	for _, conn := range s.connections {
		if conn.OwnerID == ownerID {
			removedIDs = append(removedIDs, conn.ID)
			continue
		}
		kept = append(kept, conn)
	}
	s.connections = kept
	keptQueries := s.queries[:0]
	for _, query := range s.queries {
		if query.OwnerID != ownerID {
			keptQueries = append(keptQueries, query)
		}
	}
	s.queries = keptQueries
	if err := s.persistLocked(); err != nil {
		s.connections = oldConnections
		s.queries = oldQueries
		return nil, err
	}
	if err := s.persistQueriesLocked(); err != nil {
		s.connections = oldConnections
		s.queries = oldQueries
		_ = s.persistLocked()
		_ = s.persistQueriesLocked()
		return nil, err
	}
	return removedIDs, nil
}

func (s *Store) Prepare(input model.ConnectionInput, existing model.Connection) (model.Connection, error) {
	return s.connectionFromInput(input, existing)
}

func (s *Store) connectionFromInput(input model.ConnectionInput, existing model.Connection) (model.Connection, error) {
	driver := strings.ToLower(strings.TrimSpace(input.Driver))
	if driver == "" {
		driver = existing.Driver
	}
	switch driver {
	case model.DriverMySQL, model.DriverMariaDB, model.DriverPostgres, model.DriverSQLite,
		model.DriverSQLServer, model.DriverOracle, model.DriverSnowflake, model.DriverMongo, model.DriverRedis,
		model.DriverChroma:
	default:
		return model.Connection{}, fmt.Errorf("unsupported driver %q", input.Driver)
	}

	name := strings.TrimSpace(input.Name)
	if name == "" {
		return model.Connection{}, errors.New("连接名称不能为空")
	}

	conn := existing
	conn.Name = name
	conn.Driver = driver
	conn.Host = strings.TrimSpace(input.Host)
	conn.Port = input.Port
	conn.Username = strings.TrimSpace(input.Username)
	conn.Database = strings.TrimSpace(input.Database)
	conn.SSLMode = strings.TrimSpace(input.SSLMode)
	conn.SQLitePath = strings.TrimSpace(input.SQLitePath)
	conn.Instance = strings.TrimSpace(input.Instance)
	conn.OracleSID = strings.TrimSpace(input.OracleSID)
	conn.OracleWallet = strings.TrimSpace(input.OracleWallet)
	conn.Account = strings.TrimSpace(input.Account)
	conn.Warehouse = strings.TrimSpace(input.Warehouse)
	conn.Role = strings.TrimSpace(input.Role)
	conn.DefaultSchema = strings.TrimSpace(input.DefaultSchema)
	conn.AuthSource = strings.TrimSpace(input.AuthSource)
	conn.Tenant = strings.TrimSpace(input.Tenant)
	conn.Template = strings.TrimSpace(input.Template)
	conn.Color = strings.TrimSpace(input.Color)
	conn.Group = strings.TrimSpace(input.Group)
	conn.ReadOnly = input.ReadOnly

	if driver == model.DriverSQLite {
		if conn.SQLitePath == "" {
			return model.Connection{}, errors.New("SQLite 数据库文件路径不能为空")
		}
		conn.Host = ""
		conn.Port = 0
		conn.Username = ""
		conn.Database = "main"
		conn.SSLMode = ""
		conn.Instance = ""
		conn.OracleSID = ""
		conn.OracleWallet = ""
		conn.Account = ""
		conn.Warehouse = ""
		conn.Role = ""
		conn.DefaultSchema = ""
		conn.AuthSource = ""
		conn.Tenant = ""
	} else {
		if conn.Host == "" && driver != model.DriverSnowflake {
			conn.Host = "127.0.0.1"
		}
		if conn.Port <= 0 {
			conn.Port = model.DefaultPort(driver)
		}
		if conn.SSLMode == "" {
			conn.SSLMode = "disable"
		}
		if driver == model.DriverOracle && conn.Database == "" && conn.OracleSID == "" {
			return model.Connection{}, errors.New("Oracle 服务名（Service Name / SID）不能为空")
		}
		if driver == model.DriverSnowflake {
			if conn.Account == "" {
				return model.Connection{}, errors.New("Snowflake 账户标识不能为空")
			}
			if conn.DefaultSchema == "" {
				conn.DefaultSchema = "PUBLIC"
			}
		}
		if driver == model.DriverMongo && conn.AuthSource == "" {
			conn.AuthSource = "admin"
		}
		if driver == model.DriverRedis && conn.Database == "" {
			conn.Database = "0"
		}
		if driver == model.DriverChroma {
			if conn.Tenant == "" {
				conn.Tenant = "default_tenant"
			}
			if conn.Database == "" {
				conn.Database = "default_database"
			}
			conn.SSLMode = ""
		}
	}
	s.normalizeDefaults(&conn)
	return conn, nil
}

func (s *Store) normalizeDefaults(conn *model.Connection) {
	if conn.Color == "" {
		conn.Color = "#e8a33d"
	}
	if conn.Driver == model.DriverSQLite {
		conn.Database = "main"
	} else if conn.Port == 0 {
		conn.Port = model.DefaultPort(conn.Driver)
	}
	if conn.Driver == model.DriverChroma {
		if conn.Tenant == "" {
			conn.Tenant = "default_tenant"
		}
		if conn.Database == "" {
			conn.Database = "default_database"
		}
	}
}

func (s *Store) persistLocked() error {
	data := fileData{Version: 1, Connections: make([]storedConnection, 0, len(s.connections))}
	for _, conn := range s.connections {
		data.Connections = append(data.Connections, storedConnection{
			Connection: conn,
			Secret:     conn.PasswordEncrypted,
		})
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
