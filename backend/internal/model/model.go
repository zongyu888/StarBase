package model

import "time"

const (
	DriverMySQL     = "mysql"
	DriverMariaDB   = "mariadb"
	DriverPostgres  = "postgres"
	DriverSQLite    = "sqlite"
	DriverSQLServer = "sqlserver"
	DriverOracle    = "oracle"
	DriverSnowflake = "snowflake"
	DriverMongo     = "mongodb"
	DriverRedis     = "redis"
	DriverChroma    = "chroma"
)

const Version = "1.5.2"

func DefaultPort(driver string) int {
	switch driver {
	case DriverMySQL, DriverMariaDB:
		return 3306
	case DriverPostgres:
		return 5432
	case DriverSQLServer:
		return 1433
	case DriverOracle:
		return 1521
	case DriverSnowflake:
		return 443
	case DriverMongo:
		return 27017
	case DriverRedis:
		return 6379
	case DriverChroma:
		return 8000
	default:
		return 0
	}
}

type Connection struct {
	ID                string    `json:"id"`
	OwnerID           string    `json:"ownerId,omitempty"`
	Name              string    `json:"name"`
	Driver            string    `json:"driver"`
	Host              string    `json:"host,omitempty"`
	Port              int       `json:"port,omitempty"`
	Username          string    `json:"username,omitempty"`
	Database          string    `json:"database,omitempty"`
	SSLMode           string    `json:"sslMode,omitempty"`
	SQLitePath        string    `json:"sqlitePath,omitempty"`
	Instance          string    `json:"instance,omitempty"`
	OracleSID         string    `json:"oracleSid,omitempty"`
	OracleWallet      string    `json:"oracleWallet,omitempty"`
	Account           string    `json:"account,omitempty"`
	Warehouse         string    `json:"warehouse,omitempty"`
	Role              string    `json:"role,omitempty"`
	DefaultSchema     string    `json:"defaultSchema,omitempty"`
	AuthSource        string    `json:"authSource,omitempty"`
	Tenant            string    `json:"tenant,omitempty"`
	Template          string    `json:"template,omitempty"`
	Color             string    `json:"color,omitempty"`
	Group             string    `json:"group,omitempty"`
	ReadOnly          bool      `json:"readOnly"`
	CreatedAt         time.Time `json:"createdAt"`
	UpdatedAt         time.Time `json:"updatedAt"`
	Connected         bool      `json:"connected"`
	PasswordEncrypted string    `json:"-"`
}

type ConnectionInput struct {
	Name          string  `json:"name"`
	Driver        string  `json:"driver"`
	Host          string  `json:"host"`
	Port          int     `json:"port"`
	Username      string  `json:"username"`
	Password      *string `json:"password"`
	Database      string  `json:"database"`
	SSLMode       string  `json:"sslMode"`
	SQLitePath    string  `json:"sqlitePath"`
	Instance      string  `json:"instance"`
	OracleSID     string  `json:"oracleSid"`
	OracleWallet  string  `json:"oracleWallet"`
	Account       string  `json:"account"`
	Warehouse     string  `json:"warehouse"`
	Role          string  `json:"role"`
	DefaultSchema string  `json:"defaultSchema"`
	AuthSource    string  `json:"authSource"`
	Tenant        string  `json:"tenant"`
	Template      string  `json:"template"`
	Color         string  `json:"color"`
	Group         string  `json:"group"`
	ReadOnly      bool    `json:"readOnly"`
}

type TestConnectionRequest struct {
	ID string `json:"id,omitempty"`
	ConnectionInput
}

type TestConnectionResult struct {
	OK        bool   `json:"ok"`
	LatencyMs int64  `json:"latencyMs"`
	Message   string `json:"message,omitempty"`
	Server    string `json:"server,omitempty"`
}

type DatabaseInfo struct {
	Name       string `json:"name"`
	Charset    string `json:"charset,omitempty"`
	Collation  string `json:"collation,omitempty"`
	TableCount int64  `json:"tableCount"`
	SizeBytes  int64  `json:"sizeBytes"`
	IsSystem   bool   `json:"isSystem,omitempty"`
}

type ObjectInfo struct {
	ID        string `json:"id,omitempty"`
	Name      string `json:"name"`
	Type      string `json:"type"`
	Engine    string `json:"engine,omitempty"`
	Rows      int64  `json:"rows"`
	SizeBytes int64  `json:"sizeBytes"`
	Comment   string `json:"comment,omitempty"`
	CreatedAt string `json:"createdAt,omitempty"`
	UpdatedAt string `json:"updatedAt,omitempty"`
}

type ColumnInfo struct {
	Name         string  `json:"name"`
	DataType     string  `json:"dataType"`
	ColumnType   string  `json:"columnType"`
	Nullable     bool    `json:"nullable"`
	DefaultValue *string `json:"defaultValue"`
	Key          string  `json:"key,omitempty"`
	Extra        string  `json:"extra,omitempty"`
	Comment      string  `json:"comment,omitempty"`
	Position     int     `json:"position"`
	Length       int64   `json:"length,omitempty"`
	Precision    int64   `json:"precision,omitempty"`
	Scale        int64   `json:"scale,omitempty"`
	Generated    bool    `json:"generated,omitempty"`
}

type IndexInfo struct {
	Name    string   `json:"name"`
	Columns []string `json:"columns"`
	Unique  bool     `json:"unique"`
	Primary bool     `json:"primary"`
	Type    string   `json:"type,omitempty"`
	Comment string   `json:"comment,omitempty"`
}

type ForeignKeyInfo struct {
	Name       string   `json:"name"`
	Columns    []string `json:"columns"`
	RefSchema  string   `json:"refSchema,omitempty"`
	RefTable   string   `json:"refTable"`
	RefColumns []string `json:"refColumns"`
	OnDelete   string   `json:"onDelete,omitempty"`
	OnUpdate   string   `json:"onUpdate,omitempty"`
}

type TableMeta struct {
	Database    string           `json:"database"`
	Schema      string           `json:"schema"`
	Name        string           `json:"name"`
	Type        string           `json:"type"`
	Engine      string           `json:"engine,omitempty"`
	Rows        int64            `json:"rows"`
	SizeBytes   int64            `json:"sizeBytes"`
	Comment     string           `json:"comment,omitempty"`
	CreatedAt   string           `json:"createdAt,omitempty"`
	UpdatedAt   string           `json:"updatedAt,omitempty"`
	Columns     []ColumnInfo     `json:"columns"`
	Indexes     []IndexInfo      `json:"indexes"`
	ForeignKeys []ForeignKeyInfo `json:"foreignKeys"`
	PrimaryKey  []string         `json:"primaryKey"`
	DDL         string           `json:"ddl"`
	Editable    bool             `json:"editable"`
}

type ResultColumn struct {
	Name         string `json:"name"`
	DatabaseType string `json:"databaseType,omitempty"`
	ScanType     string `json:"scanType,omitempty"`
	Nullable     bool   `json:"nullable"`
}

type QueryResult struct {
	Index        int            `json:"index"`
	Statement    string         `json:"statement"`
	Kind         string         `json:"kind"`
	Columns      []ResultColumn `json:"columns,omitempty"`
	Rows         [][]any        `json:"rows,omitempty"`
	RowCount     int            `json:"rowCount"`
	AffectedRows int64          `json:"affectedRows"`
	LastInsertID int64          `json:"lastInsertId,omitempty"`
	DurationMs   int64          `json:"durationMs"`
	Truncated    bool           `json:"truncated"`
	Error        string         `json:"error,omitempty"`
}

type QueryResponse struct {
	Results    []QueryResult `json:"results"`
	DurationMs int64         `json:"durationMs"`
	Database   string        `json:"database,omitempty"`
}

type Filter struct {
	Column   string `json:"column"`
	Operator string `json:"operator"`
	Value    string `json:"value"`
}

type RowsResponse struct {
	Columns     []ColumnInfo `json:"columns"`
	Rows        [][]any      `json:"rows"`
	Total       int64        `json:"total"`
	Page        int          `json:"page"`
	PageSize    int          `json:"pageSize"`
	PrimaryKeys []string     `json:"primaryKeys"`
	Editable    bool         `json:"editable"`
}

type NewColumn struct {
	Name          string  `json:"name"`
	Type          string  `json:"type"`
	Nullable      bool    `json:"nullable"`
	DefaultValue  *string `json:"defaultValue"`
	PrimaryKey    bool    `json:"primaryKey"`
	AutoIncrement bool    `json:"autoIncrement"`
	Comment       string  `json:"comment"`
}

type CreateTableRequest struct {
	Database string      `json:"database"`
	Schema   string      `json:"schema"`
	Name     string      `json:"name"`
	Comment  string      `json:"comment"`
	Columns  []NewColumn `json:"columns"`
}

type ForeignKeyInput struct {
	Name       string   `json:"name"`
	Columns    []string `json:"columns"`
	RefSchema  string   `json:"refSchema,omitempty"`
	RefTable   string   `json:"refTable"`
	RefColumns []string `json:"refColumns"`
	OnDelete   string   `json:"onDelete,omitempty"`
	OnUpdate   string   `json:"onUpdate,omitempty"`
}

type AlterTableRequest struct {
	Database   string           `json:"database"`
	Schema     string           `json:"schema"`
	Table      string           `json:"table"`
	Action     string           `json:"action"`
	Column     *NewColumn       `json:"column,omitempty"`
	Name       string           `json:"name,omitempty"`
	NewName    string           `json:"newName,omitempty"`
	Comment    *string          `json:"comment,omitempty"`
	Columns    []string         `json:"columns,omitempty"`
	Unique     bool             `json:"unique,omitempty"`
	ForeignKey *ForeignKeyInput `json:"foreignKey,omitempty"`
}

type CreateDatabaseRequest struct {
	Name      string `json:"name"`
	Charset   string `json:"charset,omitempty"`
	Collation string `json:"collation,omitempty"`
}

type MutationResult struct {
	AffectedRows int64  `json:"affectedRows"`
	LastInsertID int64  `json:"lastInsertId,omitempty"`
	DDL          string `json:"ddl,omitempty"`
}

type BatchRowUpdate struct {
	Keys    map[string]any `json:"keys"`
	Changes map[string]any `json:"changes"`
}

type BatchRowsRequest struct {
	Database string           `json:"database"`
	Schema   string           `json:"schema"`
	Table    string           `json:"table"`
	Updates  []BatchRowUpdate `json:"updates"`
	Inserts  []map[string]any `json:"inserts"`
	Deletes  []map[string]any `json:"deletes"`
}

type BatchRowsResult struct {
	Updated  int `json:"updated"`
	Inserted int `json:"inserted"`
	Deleted  int `json:"deleted"`
}

type ImportMapping struct {
	CSVColumn   string `json:"csvColumn"`
	TableColumn string `json:"tableColumn"`
}

type CSVImportOptions struct {
	Delimiter   string          `json:"delimiter,omitempty"`
	EmptyAsNull bool            `json:"emptyAsNull"`
	NullValue   string          `json:"nullValue,omitempty"`
	Mapping     []ImportMapping `json:"mapping,omitempty"`
}

type SavedQuery struct {
	ID           string    `json:"id"`
	OwnerID      string    `json:"ownerId,omitempty"`
	Name         string    `json:"name"`
	ConnectionID string    `json:"connectionId"`
	Database     string    `json:"database"`
	Schema       string    `json:"schema"`
	SQL          string    `json:"sql"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

type SavedQueryInput struct {
	Name         string `json:"name"`
	ConnectionID string `json:"connectionId"`
	Database     string `json:"database"`
	Schema       string `json:"schema"`
	SQL          string `json:"sql"`
}

type RedisHashEntry struct {
	Field string `json:"field"`
	Value string `json:"value"`
}

type RedisZSetEntry struct {
	Member string  `json:"member"`
	Score  float64 `json:"score"`
}

type RedisStreamEntry struct {
	ID     string            `json:"id"`
	Fields map[string]string `json:"fields"`
}

type RedisKeyInfo struct {
	Key       string `json:"key"`
	Type      string `json:"type"`
	TTL       int64  `json:"ttl"`
	Value     any    `json:"value"`
	Size      int64  `json:"size,omitempty"`
	Encoding  string `json:"encoding,omitempty"`
	Length    int64  `json:"length"`
	Cursor    uint64 `json:"cursor,omitempty"`
	More      bool   `json:"more,omitempty"`
	Truncated bool   `json:"truncated,omitempty"`
}

type RedisKeyMeta struct {
	Key  string `json:"key"`
	Type string `json:"type"`
}

type RedisKeysPage struct {
	Keys    []RedisKeyMeta `json:"keys"`
	Cursor  uint64         `json:"cursor"`
	Done    bool           `json:"done"`
	Scanned int            `json:"scanned"`
}

type RedisDBStats struct {
	DB      int   `json:"db"`
	Keys    int64 `json:"keys"`
	Expires int64 `json:"expires"`
	AvgTTL  int64 `json:"avgTtl"`
}

type RedisInfo struct {
	Raw      map[string]string `json:"raw"`
	Keyspace []RedisDBStats    `json:"keyspace"`
}

type RedisDeleteKeysResult struct {
	Deleted   int64 `json:"deleted"`
	Scanned   int   `json:"scanned"`
	Truncated bool  `json:"truncated"`
}

type RedisEntryRequest struct {
	Database string         `json:"database"`
	Key      string         `json:"key"`
	Action   string         `json:"action"`
	Field    string         `json:"field"`
	Value    string         `json:"value"`
	Member   string         `json:"member"`
	Score    float64        `json:"score"`
	Index    int64          `json:"index"`
	ID       string         `json:"id"`
	Fields   map[string]any `json:"fields"`
	Left     bool           `json:"left"`
}

type RedisCommandResult struct {
	Result any `json:"result"`
}

type ChromaCollection struct {
	ID            string         `json:"id"`
	Name          string         `json:"name"`
	Metadata      map[string]any `json:"metadata,omitempty"`
	HNSW          map[string]any `json:"hnsw,omitempty"`
	Count         int64          `json:"count"`
	Dimension     int            `json:"dimension,omitempty"`
	Version       int            `json:"version,omitempty"`
	Tenant        string         `json:"tenant,omitempty"`
	Database      string         `json:"database,omitempty"`
	Distance      string         `json:"distance,omitempty"`
	Configuration map[string]any `json:"configuration,omitempty"`
}

type ChromaDocument struct {
	ID        string         `json:"id"`
	Document  string         `json:"document,omitempty"`
	Metadata  map[string]any `json:"metadata,omitempty"`
	Embedding []float64      `json:"embedding,omitempty"`
	Distance  *float64       `json:"distance,omitempty"`
}

type ChromaDocumentsPage struct {
	Documents []ChromaDocument `json:"documents"`
	Total     int64            `json:"total"`
	Limit     int              `json:"limit"`
	Offset    int              `json:"offset"`
}

type ChromaDocumentInput struct {
	ID        string         `json:"id"`
	Document  *string        `json:"document,omitempty"`
	Metadata  map[string]any `json:"metadata,omitempty"`
	Embedding []float64      `json:"embedding,omitempty"`
}

type ChromaQueryRequest struct {
	Embedding []float64      `json:"embedding"`
	NResults  int            `json:"nResults"`
	Where     map[string]any `json:"where,omitempty"`
}

type ChromaFilterRequest struct {
	Where map[string]any `json:"where"`
	Limit int            `json:"limit"`
}

type ChromaQueryResult struct {
	Documents []ChromaDocument `json:"documents"`
}

type ChromaInfo struct {
	Version   string `json:"version,omitempty"`
	Heartbeat bool   `json:"heartbeat"`
	Tenant    string `json:"tenant"`
	Database  string `json:"database"`
	Server    string `json:"server,omitempty"`
}

type HealthInfo struct {
	OK       bool     `json:"ok"`
	Version  string   `json:"version"`
	Drivers  []string `json:"drivers"`
	UptimeMs int64    `json:"uptimeMs"`
	Desktop  bool     `json:"desktop,omitempty"`
}

type APIError struct {
	Error   string `json:"error"`
	Details string `json:"details,omitempty"`
}
