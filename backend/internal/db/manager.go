package db

import (
	"context"
	"crypto/tls"
	"database/sql"
	"fmt"
	"navideck/backend/internal/access"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	mssql "github.com/microsoft/go-mssqldb"
	"github.com/redis/go-redis/v9"
	_ "github.com/sijms/go-ora/v2"
	"github.com/snowflakedb/gosnowflake"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"go.mongodb.org/mongo-driver/mongo/readpref"
	_ "modernc.org/sqlite"

	"navideck/backend/internal/model"
)

type DialFunc func(ctx context.Context, network, address string) (net.Conn, error)

type dialAdapter struct{ fn DialFunc }

func (d dialAdapter) DialContext(ctx context.Context, network, address string) (net.Conn, error) {
	return d.fn(ctx, network, address)
}

type Manager struct {
	mu           sync.Mutex
	pools        map[string]*sql.DB
	mongoClients map[string]*mongo.Client
	redisClients map[string]*redis.Client
	connected    map[string]bool
	dataDir      string
	dial         DialFunc

	httpClient     *http.Client
	chromaMu       sync.Mutex
	chromaVersions map[string]string
}

func NewManager(dataDir string, dial ...DialFunc) *Manager {
	manager := &Manager{
		pools:          make(map[string]*sql.DB),
		mongoClients:   make(map[string]*mongo.Client),
		redisClients:   make(map[string]*redis.Client),
		connected:      make(map[string]bool),
		dataDir:        dataDir,
		chromaVersions: make(map[string]string),
	}
	if len(dial) > 0 {
		manager.dial = dial[0]
	}
	manager.httpClient = manager.newHTTPClient()
	return manager
}

func poolKey(connID, database string) string {
	return connID + "\x00" + database
}

func (m *Manager) Connect(ctx context.Context, conn model.Connection, password string) error {
	switch conn.Driver {
	case model.DriverMongo:
		if _, err := m.MongoClient(ctx, conn, password); err != nil {
			return err
		}
		return nil
	case model.DriverRedis:
		if _, err := m.RedisClient(ctx, conn, password, conn.Database); err != nil {
			return err
		}
		return nil
	case model.DriverChroma:
		if _, err := m.ChromaHeartbeat(ctx, conn, password); err != nil {
			return err
		}
		m.mu.Lock()
		m.connected[conn.ID] = true
		m.mu.Unlock()
		return nil
	}

	var db *sql.DB
	var err error
	if conn.Driver == model.DriverOracle {
		db, err = m.DB(ctx, conn, password, conn.Database)
	} else {
		db, err = m.serverPool(ctx, conn, password)
		if err == nil && conn.Database != "" && conn.Driver != model.DriverSQLite {
			db, err = m.DB(ctx, conn, password, conn.Database)
		}
	}
	if err != nil {
		return err
	}
	if err := db.PingContext(ctx); err != nil {
		return err
	}
	m.mu.Lock()
	m.connected[conn.ID] = true
	m.mu.Unlock()
	return nil
}

func (m *Manager) Disconnect(connID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	prefix := connID + "\x00"
	for key, db := range m.pools {
		if strings.HasPrefix(key, prefix) {
			_ = db.Close()
			delete(m.pools, key)
		}
	}
	if client, ok := m.mongoClients[connID]; ok {
		_ = client.Disconnect(context.Background())
		delete(m.mongoClients, connID)
	}
	for key, client := range m.redisClients {
		if strings.HasPrefix(key, prefix) {
			_ = client.Close()
			delete(m.redisClients, key)
		}
	}
	delete(m.connected, connID)
	m.chromaMu.Lock()
	delete(m.chromaVersions, connID)
	m.chromaMu.Unlock()
}

func (m *Manager) Close() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for key, db := range m.pools {
		_ = db.Close()
		delete(m.pools, key)
	}
	for key, client := range m.mongoClients {
		_ = client.Disconnect(context.Background())
		delete(m.mongoClients, key)
	}
	for key, client := range m.redisClients {
		_ = client.Close()
		delete(m.redisClients, key)
	}
	if m.httpClient != nil {
		m.httpClient.CloseIdleConnections()
	}
}

func (m *Manager) Status(connID string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.connected[connID]
}

func (m *Manager) DB(ctx context.Context, conn model.Connection, password, database string) (*sql.DB, error) {
	if conn.Driver == model.DriverMongo || conn.Driver == model.DriverRedis {
		return nil, fmt.Errorf("%s 不使用 SQL 连接", driverDisplayName(conn.Driver))
	}
	database = strings.TrimSpace(database)
	if conn.Driver == model.DriverSQLite {
		return m.serverPool(ctx, conn, password)
	}
	if conn.Driver == model.DriverOracle {
		if database == "" {
			database = strings.TrimSpace(conn.Database)
		}
		if database == "" {
			database = strings.TrimSpace(conn.OracleSID)
		}
		if database == "" {
			return nil, fmt.Errorf("Oracle 服务名不能为空")
		}
	}
	if database == "" {
		return m.serverPool(ctx, conn, password)
	}
	key := poolKey(conn.ID, database)
	m.mu.Lock()
	if pool, ok := m.pools[key]; ok {
		m.mu.Unlock()
		return pool, nil
	}
	pool, err := m.open(ctx, conn, password, database)
	if err != nil {
		m.mu.Unlock()
		return nil, err
	}
	m.pools[key] = pool
	m.connected[conn.ID] = true
	m.mu.Unlock()
	return pool, nil
}

func (m *Manager) serverPool(ctx context.Context, conn model.Connection, password string) (*sql.DB, error) {
	key := poolKey(conn.ID, "")
	m.mu.Lock()
	if pool, ok := m.pools[key]; ok {
		m.mu.Unlock()
		return pool, nil
	}
	pool, err := m.open(ctx, conn, password, "")
	if err != nil {
		m.mu.Unlock()
		return nil, err
	}
	m.pools[key] = pool
	m.connected[conn.ID] = true
	m.mu.Unlock()
	return pool, nil
}

func (m *Manager) open(ctx context.Context, conn model.Connection, password, database string) (*sql.DB, error) {
	dsn, driver, err := m.buildDSN(conn, password, database)
	if err != nil {
		return nil, err
	}
	pool, err := m.openSQL(conn, dsn, driver)
	if err != nil {
		return nil, err
	}
	pool.SetMaxOpenConns(12)
	pool.SetMaxIdleConns(6)
	pool.SetConnMaxIdleTime(10 * time.Minute)
	pool.SetConnMaxLifetime(60 * time.Minute)

	pingCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	if err := pool.PingContext(pingCtx); err != nil {
		_ = pool.Close()
		return nil, humanizeConnError(conn, err)
	}
	return pool, nil
}

func (m *Manager) openSQL(conn model.Connection, dsn, driver string) (*sql.DB, error) {
	if m.dial == nil {
		return sql.Open(driver, dsn)
	}
	switch driver {
	case "pgx":
		cfg, err := pgx.ParseConfig(dsn)
		if err != nil {
			return nil, err
		}
		cfg.DialFunc = func(ctx context.Context, network, address string) (net.Conn, error) {
			return m.dial(ctx, network, address)
		}
		return stdlib.OpenDB(*cfg), nil
	case "sqlserver":
		connector, err := mssql.NewConnector(dsn)
		if err != nil {
			return nil, err
		}
		connector.Dialer = dialAdapter{fn: m.dial}
		return sql.OpenDB(connector), nil
	default:
		return sql.Open(driver, dsn)
	}
}

func (m *Manager) buildDSN(conn model.Connection, password, database string) (string, string, error) {
	switch conn.Driver {
	case model.DriverMySQL, model.DriverMariaDB:
		cfg := mysql.NewConfig()
		cfg.User = conn.Username
		cfg.Passwd = password
		cfg.Net = "tcp"
		cfg.Addr = net.JoinHostPort(conn.Host, strconv.Itoa(conn.Port))
		cfg.DBName = database
		cfg.ParseTime = true
		cfg.Loc = time.Local
		cfg.Timeout = 15 * time.Second
		cfg.ReadTimeout = 90 * time.Second
		cfg.WriteTimeout = 90 * time.Second
		cfg.Params = map[string]string{"charset": "utf8mb4"}
		switch conn.SSLMode {
		case "preferred":
			cfg.TLSConfig = "preferred"
		case "require":
			cfg.TLSConfig = "true"
		case "skip-verify":
			cfg.TLSConfig = "skip-verify"
		}
		return cfg.FormatDSN(), "mysql", nil

	case model.DriverPostgres:
		dbName := database
		if dbName == "" {
			dbName = conn.Database
		}
		if dbName == "" {
			dbName = "postgres"
		}
		sslMode := conn.SSLMode
		switch sslMode {
		case "":
			sslMode = "disable"
		case "disable", "allow", "prefer", "require", "verify-ca", "verify-full":
		default:
			sslMode = "disable"
		}
		u := url.URL{
			Scheme: "postgres",
			User:   url.UserPassword(conn.Username, password),
			Host:   net.JoinHostPort(conn.Host, strconv.Itoa(conn.Port)),
			Path:   "/" + dbName,
		}
		q := u.Query()
		q.Set("sslmode", sslMode)
		q.Set("connect_timeout", "15")
		u.RawQuery = q.Encode()
		return u.String(), "pgx", nil

	case model.DriverSQLServer:
		u := url.URL{
			Scheme: "sqlserver",
			Host:   net.JoinHostPort(conn.Host, strconv.Itoa(conn.Port)),
		}
		if conn.Username != "" {
			u.User = url.UserPassword(conn.Username, password)
		}
		if strings.TrimSpace(conn.Instance) != "" {
			u.Path = "/" + strings.TrimSpace(conn.Instance)
		}
		q := u.Query()
		if database != "" {
			q.Set("database", database)
		}
		switch strings.ToLower(conn.SSLMode) {
		case "require", "preferred":
			q.Set("encrypt", "true")
			q.Set("trustservercertificate", "true")
		case "verify-ca", "verify-full":
			q.Set("encrypt", "true")
			q.Set("trustservercertificate", "false")
		case "strict":
			q.Set("encrypt", "strict")
		default:
			q.Set("encrypt", "disable")
		}
		q.Set("app name", "StarBase")
		q.Set("connection timeout", "15")
		q.Set("guid conversion", "1")
		u.RawQuery = q.Encode()
		return u.String(), "sqlserver", nil

	case model.DriverOracle:
		service := strings.TrimSpace(database)
		if service == "" {
			service = strings.TrimSpace(conn.Database)
		}
		if service == "" && strings.TrimSpace(conn.OracleSID) == "" {
			return "", "", fmt.Errorf("Oracle 服务名不能为空")
		}
		u := url.URL{
			Scheme: "oracle",
			Host:   net.JoinHostPort(conn.Host, strconv.Itoa(conn.Port)),
		}
		if conn.Username != "" {
			u.User = url.UserPassword(conn.Username, password)
		}
		if strings.TrimSpace(conn.OracleSID) == "" {
			u.Path = "/" + service
		}
		q := u.Query()
		if strings.TrimSpace(conn.OracleSID) != "" {
			q.Set("sid", strings.TrimSpace(conn.OracleSID))
		}
		switch strings.ToLower(conn.SSLMode) {
		case "require", "preferred":
			q.Set("ssl", "true")
			q.Set("ssl verify", "false")
		case "verify-ca", "verify-full":
			q.Set("ssl", "true")
			q.Set("ssl verify", "true")
		}
		if strings.TrimSpace(conn.OracleWallet) != "" {
			q.Set("wallet", strings.TrimSpace(conn.OracleWallet))
		}
		q.Set("connect timeout", "15")
		q.Set("program", "StarBase")
		u.RawQuery = q.Encode()
		return u.String(), "oracle", nil

	case model.DriverSnowflake:
		dbName := database
		if dbName == "" {
			dbName = conn.Database
		}
		cfg := &gosnowflake.Config{
			Account:     conn.Account,
			User:        conn.Username,
			Password:    password,
			Database:    dbName,
			Schema:      conn.DefaultSchema,
			Warehouse:   conn.Warehouse,
			Role:        conn.Role,
			Application: "StarBase",
		}
		if dbName == "" {
			cfg.Schema = ""
		}
		dsn, err := gosnowflake.DSN(cfg)
		if err != nil {
			return "", "", err
		}
		return dsn, "snowflake", nil

	case model.DriverMongo, model.DriverRedis:
		return "", "", fmt.Errorf("%s 不使用 SQL 连接", driverDisplayName(conn.Driver))

	case model.DriverSQLite:
		absPath, err := m.resolveSQLitePath(conn.SQLitePath)
		if err != nil {
			return "", "", err
		}
		if err := os.MkdirAll(filepath.Dir(absPath), 0o755); err != nil {
			return "", "", err
		}
		u := sqliteFileURL(absPath)
		values := url.Values{}
		values.Add("_pragma", "busy_timeout(5000)")
		values.Add("_pragma", "foreign_keys(1)")
		u.RawQuery = values.Encode()
		return u.String(), "sqlite", nil
	}
	return "", "", fmt.Errorf("unsupported database driver %q", conn.Driver)
}

func (m *Manager) resolveSQLitePath(path string) (string, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return "", fmt.Errorf("SQLite 数据库文件路径为空")
	}
	if !filepath.IsAbs(path) {
		path = filepath.Join(m.dataDir, path)
	}
	return filepath.Abs(path)
}

func sqliteFileURL(absPath string) *url.URL {
	p := filepath.ToSlash(absPath)
	if !strings.HasPrefix(p, "/") {
		p = "/" + p
	}
	return &url.URL{Scheme: "file", Path: p}
}

func driverDisplayName(driver string) string {
	switch driver {
	case model.DriverMySQL:
		return "MySQL"
	case model.DriverMariaDB:
		return "MariaDB"
	case model.DriverPostgres:
		return "PostgreSQL"
	case model.DriverSQLite:
		return "SQLite"
	case model.DriverSQLServer:
		return "SQL Server"
	case model.DriverOracle:
		return "Oracle"
	case model.DriverSnowflake:
		return "Snowflake"
	case model.DriverMongo:
		return "MongoDB"
	case model.DriverRedis:
		return "Redis"
	case model.DriverChroma:
		return "Chroma"
	default:
		return driver
	}
}

func (m *Manager) mongoURI(conn model.Connection, password string) (string, error) {
	if strings.TrimSpace(conn.Host) == "" {
		return "", fmt.Errorf("MongoDB 主机不能为空")
	}
	u := url.URL{
		Scheme: "mongodb",
		Host:   net.JoinHostPort(conn.Host, strconv.Itoa(conn.Port)),
	}
	if conn.Username != "" {
		u.User = url.UserPassword(conn.Username, password)
	}
	if conn.Database != "" {
		u.Path = "/" + conn.Database
	}
	q := u.Query()
	authSource := conn.AuthSource
	if authSource == "" {
		authSource = "admin"
	}
	if conn.Username != "" {
		q.Set("authSource", authSource)
	}
	switch strings.ToLower(conn.SSLMode) {
	case "require", "preferred":
		q.Set("tls", "true")
		q.Set("tlsInsecure", "true")
	case "verify-ca", "verify-full":
		q.Set("tls", "true")
	}
	q.Set("appName", "StarBase")
	u.RawQuery = q.Encode()
	return u.String(), nil
}

func (m *Manager) connectMongo(ctx context.Context, conn model.Connection, password string) (*mongo.Client, error) {
	uri, err := m.mongoURI(conn, password)
	if err != nil {
		return nil, err
	}
	clientOptions := options.Client().ApplyURI(uri).SetConnectTimeout(15 * time.Second)
	if m.dial != nil {
		clientOptions.SetDialer(dialAdapter{fn: m.dial})
	}
	client, err := mongo.Connect(ctx, clientOptions)
	if err != nil {
		return nil, humanizeConnError(conn, err)
	}
	pingCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	if err := client.Ping(pingCtx, readpref.Primary()); err != nil {
		_ = client.Disconnect(context.Background())
		return nil, humanizeConnError(conn, err)
	}
	return client, nil
}

func (m *Manager) MongoClient(ctx context.Context, conn model.Connection, password string) (*mongo.Client, error) {
	m.mu.Lock()
	if client, ok := m.mongoClients[conn.ID]; ok {
		m.mu.Unlock()
		return client, nil
	}
	m.mu.Unlock()
	client, err := m.connectMongo(ctx, conn, password)
	if err != nil {
		return nil, err
	}
	m.mu.Lock()
	m.mongoClients[conn.ID] = client
	m.connected[conn.ID] = true
	m.mu.Unlock()
	return client, nil
}

func redisDatabaseIndex(database string) int {
	if database == "" {
		return 0
	}
	value, err := strconv.Atoi(database)
	if err != nil || value < 0 {
		return 0
	}
	if value > 15 {
		return 15
	}
	return value
}

func (m *Manager) redisOptions(conn model.Connection, password string, database string) *redis.Options {
	return m.redisOptionsWithContext(context.Background(), conn, password, database)
}

func (m *Manager) redisOptionsWithContext(ctx context.Context, conn model.Connection, password string, database string) *redis.Options {
	opts := &redis.Options{
		Addr:         net.JoinHostPort(conn.Host, strconv.Itoa(conn.Port)),
		Username:     conn.Username,
		Password:     password,
		DB:           redisDatabaseIndex(database),
		DialTimeout:  15 * time.Second,
		ReadTimeout:  90 * time.Second,
		WriteTimeout: 90 * time.Second,
	}
	if m.dial != nil {
		allowPrivate := access.AllowPrivate(ctx)
		opts.Dialer = func(dialCtx context.Context, network, address string) (net.Conn, error) {
			if allowPrivate {
				dialCtx = access.WithAllowPrivate(dialCtx, true)
			}
			return m.dial(dialCtx, network, address)
		}
	}
	switch strings.ToLower(conn.SSLMode) {
	case "require", "preferred", "verify-ca", "verify-full":
		opts.TLSConfig = &tls.Config{
			MinVersion:         tls.VersionTLS12,
			ServerName:         conn.Host,
			InsecureSkipVerify: strings.ToLower(conn.SSLMode) == "require" || strings.ToLower(conn.SSLMode) == "preferred",
		}
	}
	return opts
}

func (m *Manager) connectRedis(ctx context.Context, conn model.Connection, password, database string) (*redis.Client, error) {
	client := redis.NewClient(m.redisOptionsWithContext(ctx, conn, password, database))
	pingCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	if err := client.Ping(pingCtx).Err(); err != nil {
		_ = client.Close()
		return nil, humanizeConnError(conn, err)
	}
	return client, nil
}

func (m *Manager) RedisClient(ctx context.Context, conn model.Connection, password, database string) (*redis.Client, error) {
	key := conn.ID + "\x00" + strconv.Itoa(redisDatabaseIndex(database))
	m.mu.Lock()
	if client, ok := m.redisClients[key]; ok {
		m.mu.Unlock()
		return client, nil
	}
	m.mu.Unlock()
	client, err := m.connectRedis(ctx, conn, password, database)
	if err != nil {
		return nil, err
	}
	m.mu.Lock()
	m.redisClients[key] = client
	m.connected[conn.ID] = true
	m.mu.Unlock()
	return client, nil
}

func humanizeConnError(conn model.Connection, err error) error {
	switch conn.Driver {
	case model.DriverMySQL:
		return fmt.Errorf("MySQL 连接失败：%w", err)
	case model.DriverMariaDB:
		return fmt.Errorf("MariaDB 连接失败：%w", err)
	case model.DriverPostgres:
		return fmt.Errorf("PostgreSQL 连接失败：%w", err)
	case model.DriverSQLServer:
		return fmt.Errorf("SQL Server 连接失败：%w", err)
	case model.DriverOracle:
		return fmt.Errorf("Oracle 连接失败：%w", err)
	case model.DriverSQLite:
		return fmt.Errorf("SQLite 打开失败：%w", err)
	case model.DriverSnowflake:
		return fmt.Errorf("Snowflake 连接失败：%w", err)
	case model.DriverMongo:
		return fmt.Errorf("MongoDB 连接失败：%w", err)
	case model.DriverRedis:
		return fmt.Errorf("Redis 连接失败：%w", err)
	case model.DriverChroma:
		return fmt.Errorf("Chroma 连接失败：%w", err)
	default:
		return err
	}
}

func (m *Manager) Test(ctx context.Context, conn model.Connection, password string) (string, time.Duration, error) {
	start := time.Now()
	if conn.Driver == model.DriverChroma {
		info, err := m.ChromaInfo(ctx, conn, password)
		if err != nil {
			return "", time.Since(start), err
		}
		return info.Version, time.Since(start), nil
	}
	if conn.Driver == model.DriverMongo {
		client, err := m.connectMongo(ctx, conn, password)
		if err != nil {
			return "", time.Since(start), err
		}
		defer client.Disconnect(context.Background())
		version := "MongoDB"
		var result bson.M
		if err := client.Database("admin").RunCommand(ctx, bson.D{{Key: "buildInfo", Value: 1}}).Decode(&result); err == nil {
			if value, ok := result["version"]; ok {
				version = fmt.Sprint(value)
			}
		}
		return version, time.Since(start), nil
	}
	if conn.Driver == model.DriverRedis {
		client := redis.NewClient(m.redisOptionsWithContext(ctx, conn, password, conn.Database))
		defer client.Close()
		pingCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
		defer cancel()
		if err := client.Ping(pingCtx).Err(); err != nil {
			return "", time.Since(start), humanizeConnError(conn, err)
		}
		version := "Redis"
		if info, err := client.Info(pingCtx, "server").Result(); err == nil {
			for _, line := range strings.Split(info, "\n") {
				if strings.HasPrefix(line, "redis_version:") {
					version = strings.TrimSpace(strings.TrimPrefix(line, "redis_version:"))
					break
				}
			}
		}
		return version, time.Since(start), nil
	}

	dsn, driver, err := m.buildDSN(conn, password, conn.Database)
	if err != nil {
		return "", 0, err
	}
	pool, err := m.openSQL(conn, dsn, driver)
	if err != nil {
		return "", 0, err
	}
	defer pool.Close()
	pingCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	if err := pool.PingContext(pingCtx); err != nil {
		return "", time.Since(start), humanizeConnError(conn, err)
	}
	var version string
	var query string
	switch conn.Driver {
	case model.DriverMySQL, model.DriverMariaDB:
		query = "SELECT VERSION()"
	case model.DriverPostgres:
		query = "SHOW server_version"
	case model.DriverSQLServer:
		query = "SELECT CAST(SERVERPROPERTY('ProductVersion') AS VARCHAR(64))"
	case model.DriverOracle:
		query = "SELECT version FROM product_component_version WHERE product LIKE 'Oracle Database%' AND ROWNUM = 1"
	case model.DriverSnowflake:
		query = "SELECT CURRENT_VERSION()"
	default:
		query = "SELECT sqlite_version()"
	}
	_ = pool.QueryRowContext(pingCtx, query).Scan(&version)
	if version == "" {
		version = conn.Driver
	}
	return version, time.Since(start), nil
}

func (m *Manager) TestInput(ctx context.Context, conn model.Connection, password string) model.TestConnectionResult {
	version, latency, err := m.Test(ctx, conn, password)
	result := model.TestConnectionResult{
		OK:        err == nil,
		LatencyMs: latency.Milliseconds(),
		Server:    version,
	}
	if err != nil {
		result.Message = err.Error()
	} else {
		result.Message = "连接成功"
	}
	return result
}
