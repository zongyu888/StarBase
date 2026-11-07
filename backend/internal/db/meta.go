package db

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"

	"navideck/backend/internal/model"
)

func quoteIdent(driver, name string) string {
	switch driver {
	case model.DriverMySQL, model.DriverMariaDB:
		return "`" + strings.ReplaceAll(name, "`", "``") + "`"
	case model.DriverSQLServer:
		return "[" + strings.ReplaceAll(name, "]", "]]") + "]"
	default:
		return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
	}
}

func isMySQLFamily(driver string) bool {
	return driver == model.DriverMySQL || driver == model.DriverMariaDB
}

func effectiveSchema(driver, database, schema string) string {
	if schema != "" {
		return schema
	}
	switch driver {
	case model.DriverMySQL, model.DriverMariaDB:
		return database
	case model.DriverPostgres:
		return "public"
	case model.DriverSQLServer:
		return "dbo"
	case model.DriverSQLite:
		return "main"
	case model.DriverSnowflake:
		return "PUBLIC"
	default:
		return ""
	}
}

func qualifiedTable(driver, database, schema, table string) string {
	switch driver {
	case model.DriverMySQL, model.DriverMariaDB:
		return quoteIdent(driver, database) + "." + quoteIdent(driver, table)
	case model.DriverSQLite:
		return quoteIdent(driver, "main") + "." + quoteIdent(driver, table)
	case model.DriverSQLServer:
		if strings.TrimSpace(schema) != "" {
			return quoteIdent(driver, schema) + "." + quoteIdent(driver, table)
		}
		return quoteIdent(driver, table)
	case model.DriverOracle:
		if strings.TrimSpace(schema) == "" {
			return quoteIdent(driver, table)
		}
		return quoteIdent(driver, schema) + "." + quoteIdent(driver, table)
	default:
		return quoteIdent(driver, effectiveSchema(driver, database, schema)) + "." + quoteIdent(driver, table)
	}
}

func isSystemDatabase(driver, name string) bool {
	switch driver {
	case model.DriverMySQL, model.DriverMariaDB:
		switch strings.ToLower(name) {
		case "information_schema", "mysql", "performance_schema", "sys":
			return true
		}
		return false
	case model.DriverPostgres:
		switch name {
		case "postgres", "template0", "template1":
			return true
		}
		return false
	case model.DriverSQLServer:
		switch strings.ToLower(name) {
		case "master", "model", "msdb", "tempdb":
			return true
		}
		return false
	case model.DriverSnowflake:
		return strings.EqualFold(name, "SNOWFLAKE")
	default:
		return false
	}
}

func oracleSchema(conn model.Connection, schema string) string {
	if trimmed := strings.TrimSpace(schema); trimmed != "" {
		return strings.ToUpper(trimmed)
	}
	return strings.ToUpper(strings.TrimSpace(conn.Username))
}

func (m *Manager) Databases(ctx context.Context, conn model.Connection, password string) ([]model.DatabaseInfo, error) {
	switch conn.Driver {
	case model.DriverMySQL, model.DriverMariaDB:
		pool, err := m.serverPool(ctx, conn, password)
		if err != nil {
			return nil, err
		}
		const q = `
SELECT s.SCHEMA_NAME,
       s.DEFAULT_CHARACTER_SET_NAME,
       s.DEFAULT_COLLATION_NAME,
       CAST(COALESCE(t.table_count, 0) AS UNSIGNED),
       CAST(COALESCE(t.size_bytes, 0) AS UNSIGNED)
FROM information_schema.SCHEMATA s
LEFT JOIN (
    SELECT TABLE_SCHEMA,
           COUNT(*) AS table_count,
           SUM(COALESCE(DATA_LENGTH, 0) + COALESCE(INDEX_LENGTH, 0)) AS size_bytes
    FROM information_schema.TABLES
    GROUP BY TABLE_SCHEMA
) t ON t.TABLE_SCHEMA = s.SCHEMA_NAME
ORDER BY s.SCHEMA_NAME`
		rows, err := pool.QueryContext(ctx, q)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []model.DatabaseInfo
		for rows.Next() {
			var d model.DatabaseInfo
			if err := rows.Scan(&d.Name, &d.Charset, &d.Collation, &d.TableCount, &d.SizeBytes); err != nil {
				return nil, err
			}
			d.IsSystem = isSystemDatabase(conn.Driver, d.Name)
			out = append(out, d)
		}
		return out, rows.Err()

	case model.DriverPostgres:
		pool, err := m.serverPool(ctx, conn, password)
		if err != nil {
			return nil, err
		}
		const q = `
SELECT d.datname,
       pg_encoding_to_char(d.encoding),
       CASE WHEN has_database_privilege(d.datname, 'CONNECT') THEN pg_database_size(d.datname) ELSE 0 END
FROM pg_database d
WHERE NOT d.datistemplate AND d.datallowconn
ORDER BY d.datname`
		rows, err := pool.QueryContext(ctx, q)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []model.DatabaseInfo
		for rows.Next() {
			var d model.DatabaseInfo
			if err := rows.Scan(&d.Name, &d.Charset, &d.SizeBytes); err != nil {
				return nil, err
			}
			d.IsSystem = isSystemDatabase(conn.Driver, d.Name)
			out = append(out, d)
		}
		return out, rows.Err()

	case model.DriverSQLServer:
		pool, err := m.serverPool(ctx, conn, password)
		if err != nil {
			return nil, err
		}
		const q = `
SELECT d.name,
       COALESCE(d.collation_name, ''),
       CAST(COALESCE(SUM(CAST(mf.size AS BIGINT)), 0) * 8192 AS BIGINT)
FROM sys.databases d
LEFT JOIN sys.master_files mf ON mf.database_id = d.database_id
GROUP BY d.name, d.collation_name
ORDER BY d.name`
		rows, err := pool.QueryContext(ctx, q)
		if err != nil {
			rows, err = pool.QueryContext(ctx, `SELECT name, COALESCE(collation_name, ''), CAST(0 AS BIGINT) FROM sys.databases ORDER BY name`)
			if err != nil {
				return nil, err
			}
		}
		defer rows.Close()
		var out []model.DatabaseInfo
		for rows.Next() {
			var d model.DatabaseInfo
			if err := rows.Scan(&d.Name, &d.Charset, &d.SizeBytes); err != nil {
				return nil, err
			}
			d.Collation = d.Charset
			d.IsSystem = isSystemDatabase(conn.Driver, d.Name)
			out = append(out, d)
		}
		return out, rows.Err()

	case model.DriverSnowflake:
		pool, err := m.serverPool(ctx, conn, password)
		if err != nil {
			return nil, err
		}
		return snowflakeDatabases(ctx, pool)

	case model.DriverMongo:
		return m.mongoDatabases(ctx, conn, password)

	case model.DriverRedis:
		return m.redisDatabases(ctx, conn, password)

	case model.DriverChroma:
		return m.chromaDatabases(ctx, conn, password)

	case model.DriverOracle:
		pool, err := m.DB(ctx, conn, password, conn.Database)
		if err != nil {
			return nil, err
		}
		var charset string
		_ = pool.QueryRowContext(ctx, `SELECT value FROM nls_database_parameters WHERE parameter = 'NLS_CHARACTERSET'`).Scan(&charset)
		var count int64
		_ = pool.QueryRowContext(ctx, `SELECT COUNT(*) FROM user_tables`).Scan(&count)
		name := strings.TrimSpace(conn.Database)
		if name == "" {
			name = strings.TrimSpace(conn.OracleSID)
		}
		if name == "" {
			name = "Oracle"
		}
		return []model.DatabaseInfo{{
			Name:       name,
			Charset:    charset,
			Collation:  charset,
			TableCount: count,
		}}, nil

	default:
		pool, err := m.DB(ctx, conn, password, "main")
		if err != nil {
			return nil, err
		}
		var count int64
		_ = pool.QueryRowContext(ctx, `SELECT COUNT(*) FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'`).Scan(&count)
		path, _ := m.resolveSQLitePath(conn.SQLitePath)
		var size int64
		if st, err := os.Stat(path); err == nil {
			size = st.Size()
		}
		return []model.DatabaseInfo{{
			Name:       "main",
			Charset:    "UTF-8",
			Collation:  "BINARY",
			TableCount: count,
			SizeBytes:  size,
		}}, nil
	}
}

func (m *Manager) Schemas(ctx context.Context, conn model.Connection, password, database string) ([]string, error) {
	switch conn.Driver {
	case model.DriverMySQL, model.DriverMariaDB:
		if database == "" {
			return []string{}, nil
		}
		return []string{database}, nil
	case model.DriverSQLite:
		return []string{"main"}, nil
	case model.DriverSQLServer:
		pool, err := m.DB(ctx, conn, password, database)
		if err != nil {
			return nil, err
		}
		const q = `
SELECT name FROM sys.schemas
WHERE name NOT IN ('sys', 'INFORMATION_SCHEMA', 'guest')
ORDER BY name`
		rows, err := pool.QueryContext(ctx, q)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []string
		for rows.Next() {
			var name string
			if err := rows.Scan(&name); err != nil {
				return nil, err
			}
			out = append(out, name)
		}
		return out, rows.Err()
	case model.DriverSnowflake:
		pool, err := m.DB(ctx, conn, password, database)
		if err != nil {
			return nil, err
		}
		return snowflakeSchemas(ctx, pool, database)
	case model.DriverMongo, model.DriverRedis:
		return []string{}, nil
	case model.DriverChroma:
		return []string{}, nil
	case model.DriverOracle:
		pool, err := m.DB(ctx, conn, password, database)
		if err != nil {
			return nil, err
		}
		var out []string
		rows, err := pool.QueryContext(ctx, `SELECT username FROM all_users ORDER BY username`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		for rows.Next() {
			var name string
			if err := rows.Scan(&name); err != nil {
				return nil, err
			}
			if strings.EqualFold(name, conn.Username) || !isOracleSystemSchema(name) {
				out = append(out, name)
			}
		}
		return out, rows.Err()
	default:
		pool, err := m.DB(ctx, conn, password, database)
		if err != nil {
			return nil, err
		}
		const q = `
SELECT schema_name FROM information_schema.schemata
WHERE schema_name NOT IN ('information_schema') AND schema_name NOT LIKE 'pg_%'
ORDER BY schema_name`
		rows, err := pool.QueryContext(ctx, q)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []string
		for rows.Next() {
			var name string
			if err := rows.Scan(&name); err != nil {
				return nil, err
			}
			out = append(out, name)
		}
		return out, rows.Err()
	}
}

func isOracleSystemSchema(name string) bool {
	switch strings.ToUpper(name) {
	case "SYS", "SYSTEM", "SYSMAN", "DBSNMP", "OUTLN", "XDB", "WMSYS", "ORDSYS", "MDSYS",
		"CTXSYS", "DVSYS", "LBACSYS", "AUDSYS", "GSMADMIN_INTERNAL", "OJVMSYS", "APPQOSSYS",
		"ORDDATA", "ORACLE_OCM", "ANONYMOUS", "XS$NULL", "PUBLIC":
		return true
	default:
		return false
	}
}

func (m *Manager) Objects(ctx context.Context, conn model.Connection, password, database, schema string) ([]model.ObjectInfo, error) {
	if conn.Driver == model.DriverChroma {
		return m.chromaObjects(ctx, conn, password, database, schema)
	}
	pool, err := m.DB(ctx, conn, password, database)
	if err != nil {
		return nil, err
	}
	schema = effectiveSchema(conn.Driver, database, schema)

	var out []model.ObjectInfo
	switch conn.Driver {
	case model.DriverMySQL, model.DriverMariaDB:
		const q = `
SELECT TABLE_NAME, TABLE_TYPE, COALESCE(ENGINE, ''),
       CAST(COALESCE(TABLE_ROWS, 0) AS UNSIGNED),
       CAST(COALESCE(DATA_LENGTH, 0) + COALESCE(INDEX_LENGTH, 0) AS UNSIGNED),
       COALESCE(TABLE_COMMENT, ''),
       COALESCE(DATE_FORMAT(CREATE_TIME, '%Y-%m-%d %H:%i:%s'), ''),
       COALESCE(DATE_FORMAT(UPDATE_TIME, '%Y-%m-%d %H:%i:%s'), '')
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = ?
ORDER BY TABLE_NAME`
		rows, err := pool.QueryContext(ctx, q, database)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		for rows.Next() {
			var o model.ObjectInfo
			var tableType string
			if err := rows.Scan(&o.Name, &tableType, &o.Engine, &o.Rows, &o.SizeBytes, &o.Comment, &o.CreatedAt, &o.UpdatedAt); err != nil {
				return nil, err
			}
			if tableType == "VIEW" || tableType == "SYSTEM VIEW" {
				o.Type = "view"
			} else {
				o.Type = "table"
			}
			out = append(out, o)
		}
		return out, rows.Err()

	case model.DriverPostgres:
		const q = `
SELECT c.relname,
       CASE c.relkind WHEN 'v' THEN 'view' WHEN 'm' THEN 'view' WHEN 'f' THEN 'table' ELSE 'table' END,
       COALESCE(am.amname, ''),
       CAST(COALESCE(s.n_live_tup, GREATEST(c.reltuples, 0)) AS BIGINT),
       CAST(pg_total_relation_size(c.oid) AS BIGINT),
       COALESCE(obj_description(c.oid, 'pg_class'), ''),
       '',
       ''
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_am am ON am.oid = c.relam
LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
WHERE n.nspname = $1 AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
ORDER BY c.relname`
		rows, err := pool.QueryContext(ctx, q, schema)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		for rows.Next() {
			var o model.ObjectInfo
			if err := rows.Scan(&o.Name, &o.Type, &o.Engine, &o.Rows, &o.SizeBytes, &o.Comment, &o.CreatedAt, &o.UpdatedAt); err != nil {
				return nil, err
			}
			out = append(out, o)
		}
		return out, rows.Err()

	case model.DriverSQLServer:
		const q = `
SELECT o.name,
       CASE WHEN o.type = 'V' THEN 'view' ELSE 'table' END,
       'SQL Server',
       CAST(COALESCE(SUM(CASE WHEN p.index_id IN (0, 1) THEN p.rows ELSE 0 END), 0) AS BIGINT),
       CAST(COALESCE(SUM(CAST(p.used_page_count AS BIGINT)), 0) * 8192 AS BIGINT),
       COALESCE(MAX(CAST(ep.value AS NVARCHAR(MAX))), ''),
       '',
       ''
FROM sys.objects o
JOIN sys.schemas s ON s.schema_id = o.schema_id
LEFT JOIN sys.dm_db_partition_stats p ON p.object_id = o.object_id
LEFT JOIN sys.extended_properties ep ON ep.major_id = o.object_id AND ep.minor_id = 0 AND ep.name = 'MS_Description'
WHERE s.name = @p1 AND o.type IN ('U', 'V') AND o.is_ms_shipped = 0
GROUP BY o.name, o.type
ORDER BY o.name`
		rows, err := pool.QueryContext(ctx, q, schema)
		if err != nil {
			const fallback = `
SELECT o.name,
       CASE WHEN o.type = 'V' THEN 'view' ELSE 'table' END,
       'SQL Server', CAST(0 AS BIGINT), CAST(0 AS BIGINT),
       COALESCE(MAX(CAST(ep.value AS NVARCHAR(MAX))), ''), '', ''
FROM sys.objects o
JOIN sys.schemas s ON s.schema_id = o.schema_id
LEFT JOIN sys.extended_properties ep ON ep.major_id = o.object_id AND ep.minor_id = 0 AND ep.name = 'MS_Description'
WHERE s.name = @p1 AND o.type IN ('U', 'V') AND o.is_ms_shipped = 0
GROUP BY o.name, o.type
ORDER BY o.name`
			rows, err = pool.QueryContext(ctx, fallback, schema)
			if err != nil {
				return nil, err
			}
		}
		defer rows.Close()
		for rows.Next() {
			var o model.ObjectInfo
			if err := rows.Scan(&o.Name, &o.Type, &o.Engine, &o.Rows, &o.SizeBytes, &o.Comment, &o.CreatedAt, &o.UpdatedAt); err != nil {
				return nil, err
			}
			out = append(out, o)
		}
		return out, rows.Err()

	case model.DriverSnowflake:
		return snowflakeObjects(ctx, pool, database, schema)

	case model.DriverMongo:
		return m.mongoObjects(ctx, conn, password, database)

	case model.DriverRedis:
		return m.redisObjects(ctx, conn, password, database)

	case model.DriverOracle:
		const q = `
SELECT t.TABLE_NAME, 'table', 'Oracle', NVL(t.NUM_ROWS, 0), 0, NVL(c.COMMENTS, ''), '', ''
FROM all_tables t
LEFT JOIN all_tab_comments c ON c.OWNER = t.OWNER AND c.TABLE_NAME = t.TABLE_NAME AND c.TABLE_TYPE = 'TABLE'
WHERE t.OWNER = :1 AND t.TABLE_NAME NOT LIKE 'BIN$%'
UNION ALL
SELECT v.VIEW_NAME, 'view', 'Oracle', 0, 0, NVL(c.COMMENTS, ''), '', ''
FROM all_views v
LEFT JOIN all_tab_comments c ON c.OWNER = v.OWNER AND c.TABLE_NAME = v.VIEW_NAME AND c.TABLE_TYPE = 'VIEW'
WHERE v.OWNER = :1
ORDER BY 1`
		rows, err := pool.QueryContext(ctx, q, oracleSchema(conn, schema))
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		for rows.Next() {
			var o model.ObjectInfo
			if err := rows.Scan(&o.Name, &o.Type, &o.Engine, &o.Rows, &o.SizeBytes, &o.Comment, &o.CreatedAt, &o.UpdatedAt); err != nil {
				return nil, err
			}
			out = append(out, o)
		}
		return out, rows.Err()

	default:
		const q = `SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name`
		rows, err := pool.QueryContext(ctx, q)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var o model.ObjectInfo
			if err := rows.Scan(&o.Name, &o.Type); err != nil {
				rows.Close()
				return nil, err
			}
			o.Engine = "SQLite"
			out = append(out, o)
		}
		if err := rows.Close(); err != nil {
			return nil, err
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}
		for i := range out {
			if out[i].Type != "table" {
				continue
			}
			var count int64
			query := "SELECT COUNT(*) FROM " + qualifiedTable(conn.Driver, database, "main", out[i].Name)
			if err := pool.QueryRowContext(ctx, query).Scan(&count); err == nil {
				out[i].Rows = count
			}
		}
		return out, nil
	}
}

func (m *Manager) TableMeta(ctx context.Context, conn model.Connection, password, database, schema, table string) (*model.TableMeta, error) {
	if conn.Driver == model.DriverChroma {
		return nil, fmt.Errorf("Chroma 集合请在 Chroma 工作台中查看")
	}
	objects, err := m.Objects(ctx, conn, password, database, schema)
	if err != nil {
		return nil, err
	}
	var info *model.ObjectInfo
	for i := range objects {
		if objects[i].Name == table {
			info = &objects[i]
			break
		}
	}
	if info == nil {
		return nil, fmt.Errorf("对象 %q 不存在", table)
	}
	if conn.Driver == model.DriverMongo {
		return m.mongoTableMeta(ctx, conn, password, database, table)
	}
	pool, err := m.DB(ctx, conn, password, database)
	if err != nil {
		return nil, err
	}
	schema = effectiveSchema(conn.Driver, database, schema)
	if conn.Driver == model.DriverOracle {
		schema = oracleSchema(conn, schema)
	}

	meta := &model.TableMeta{
		Database:  database,
		Schema:    schema,
		Name:      table,
		Type:      info.Type,
		Engine:    info.Engine,
		Rows:      info.Rows,
		SizeBytes: info.SizeBytes,
		Comment:   info.Comment,
		CreatedAt: info.CreatedAt,
		UpdatedAt: info.UpdatedAt,
	}

	switch conn.Driver {
	case model.DriverMySQL, model.DriverMariaDB:
		meta.Columns, err = mysqlColumns(ctx, pool, database, table)
		if err != nil {
			return nil, err
		}
		meta.Indexes, err = mysqlIndexes(ctx, pool, database, table)
		if err != nil {
			return nil, err
		}
		meta.ForeignKeys, err = mysqlForeignKeys(ctx, pool, database, table)
		if err != nil {
			return nil, err
		}
		meta.DDL, err = mysqlDDL(ctx, pool, database, table)
		if err != nil {
			return nil, err
		}
	case model.DriverPostgres:
		meta.Columns, err = pgColumns(ctx, pool, schema, table)
		if err != nil {
			return nil, err
		}
		meta.Indexes, err = pgIndexes(ctx, pool, schema, table)
		if err != nil {
			return nil, err
		}
		meta.ForeignKeys, err = pgForeignKeys(ctx, pool, schema, table)
		if err != nil {
			return nil, err
		}
		meta.DDL, err = pgDDL(ctx, pool, schema, table, info.Type, meta)
		if err != nil {
			return nil, err
		}
	case model.DriverSQLServer:
		meta.Columns, err = sqlServerColumns(ctx, pool, schema, table)
		if err != nil {
			return nil, err
		}
		meta.Indexes, err = sqlServerIndexes(ctx, pool, schema, table)
		if err != nil {
			return nil, err
		}
		meta.ForeignKeys, err = sqlServerForeignKeys(ctx, pool, schema, table)
		if err != nil {
			return nil, err
		}
		meta.DDL = sqlServerDDL(schema, table, meta)
	case model.DriverOracle:
		meta.Columns, err = oracleColumns(ctx, pool, schema, table)
		if err != nil {
			return nil, err
		}
		meta.Indexes, err = oracleIndexes(ctx, pool, schema, table)
		if err != nil {
			return nil, err
		}
		meta.ForeignKeys, err = oracleForeignKeys(ctx, pool, schema, table)
		if err != nil {
			return nil, err
		}
		meta.DDL = oracleDDL(schema, table, meta)
	case model.DriverSnowflake:
		meta.Columns, err = snowflakeColumns(ctx, pool, database, schema, table)
		if err != nil {
			return nil, err
		}
		meta.Indexes, meta.ForeignKeys, err = snowflakeConstraints(ctx, pool, database, schema, table)
		if err != nil {
			return nil, err
		}
		if ddl, ddlErr := snowflakeDDL(ctx, pool, database, schema, table, info.Type); ddlErr == nil {
			meta.DDL = ddl
		} else {
			meta.DDL = snowflakeDDLFromMeta(schema, table, meta)
		}
	case model.DriverMongo:
		return m.mongoTableMeta(ctx, conn, password, database, table)
	default:
		meta.DDL, err = sqliteDDL(ctx, pool, table)
		if err != nil {
			return nil, err
		}
		meta.Columns, err = sqliteColumns(ctx, pool, table, strings.Contains(strings.ToUpper(meta.DDL), "AUTOINCREMENT"))
		if err != nil {
			return nil, err
		}
		meta.Indexes, err = sqliteIndexes(ctx, pool, table)
		if err != nil {
			return nil, err
		}
		meta.ForeignKeys, err = sqliteForeignKeys(ctx, pool, table)
		if err != nil {
			return nil, err
		}
	}

	if meta.Columns == nil {
		meta.Columns = []model.ColumnInfo{}
	}
	if meta.Indexes == nil {
		meta.Indexes = []model.IndexInfo{}
	}
	if meta.ForeignKeys == nil {
		meta.ForeignKeys = []model.ForeignKeyInfo{}
	}
	meta.PrimaryKey = []string{}
	for _, idx := range meta.Indexes {
		if idx.Primary {
			meta.PrimaryKey = append(meta.PrimaryKey, idx.Columns...)
		}
	}
	if len(meta.PrimaryKey) == 0 {
		for _, col := range meta.Columns {
			if col.Key == "PRI" {
				meta.PrimaryKey = append(meta.PrimaryKey, col.Name)
			}
		}
	}
	meta.Editable = meta.Type == "table" && len(meta.PrimaryKey) > 0 && !conn.ReadOnly
	return meta, nil
}

func mysqlColumns(ctx context.Context, pool *sql.DB, database, table string) ([]model.ColumnInfo, error) {
	const q = `
SELECT COLUMN_NAME, LOWER(DATA_TYPE), COLUMN_TYPE,
       IS_NULLABLE = 'YES',
       COLUMN_DEFAULT,
       COLUMN_KEY, EXTRA, COALESCE(COLUMN_COMMENT, ''), ORDINAL_POSITION,
       COALESCE(CHARACTER_MAXIMUM_LENGTH, 0),
       COALESCE(NUMERIC_PRECISION, 0),
       COALESCE(NUMERIC_SCALE, 0),
       COALESCE(GENERATION_EXPRESSION, '') <> ''
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
ORDER BY ORDINAL_POSITION`
	rows, err := pool.QueryContext(ctx, q, database, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.ColumnInfo
	for rows.Next() {
		var c model.ColumnInfo
		var def sql.NullString
		if err := rows.Scan(&c.Name, &c.DataType, &c.ColumnType, &c.Nullable, &def, &c.Key, &c.Extra, &c.Comment,
			&c.Position, &c.Length, &c.Precision, &c.Scale, &c.Generated); err != nil {
			return nil, err
		}
		if def.Valid {
			v := def.String
			c.DefaultValue = &v
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func mysqlIndexes(ctx context.Context, pool *sql.DB, database, table string) ([]model.IndexInfo, error) {
	const q = `
SELECT INDEX_NAME, NON_UNIQUE, INDEX_TYPE, SEQ_IN_INDEX, COALESCE(COLUMN_NAME, ''), COALESCE(INDEX_COMMENT, '')
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
ORDER BY INDEX_NAME = 'PRIMARY' DESC, INDEX_NAME, SEQ_IN_INDEX`
	rows, err := pool.QueryContext(ctx, q, database, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	indexes := map[string]*model.IndexInfo{}
	order := []string{}
	for rows.Next() {
		var name, typ, column, comment string
		var nonUnique int
		var seq int
		if err := rows.Scan(&name, &nonUnique, &typ, &seq, &column, &comment); err != nil {
			return nil, err
		}
		idx, ok := indexes[name]
		if !ok {
			idx = &model.IndexInfo{Name: name, Unique: nonUnique == 0, Primary: name == "PRIMARY", Type: typ, Comment: comment}
			indexes[name] = idx
			order = append(order, name)
		}
		idx.Columns = append(idx.Columns, column)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]model.IndexInfo, 0, len(order))
	for _, name := range order {
		out = append(out, *indexes[name])
	}
	return out, nil
}

func mysqlForeignKeys(ctx context.Context, pool *sql.DB, database, table string) ([]model.ForeignKeyInfo, error) {
	const q = `
SELECT k.CONSTRAINT_NAME, k.COLUMN_NAME, k.REFERENCED_TABLE_SCHEMA,
       k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME,
       r.DELETE_RULE, r.UPDATE_RULE
FROM information_schema.KEY_COLUMN_USAGE k
JOIN information_schema.REFERENTIAL_CONSTRAINTS r
  ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
WHERE k.TABLE_SCHEMA = ? AND k.TABLE_NAME = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL
ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION`
	rows, err := pool.QueryContext(ctx, q, database, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	fks := map[string]*model.ForeignKeyInfo{}
	order := []string{}
	for rows.Next() {
		var name, column, refSchema, refTable, refColumn, onDelete, onUpdate string
		if err := rows.Scan(&name, &column, &refSchema, &refTable, &refColumn, &onDelete, &onUpdate); err != nil {
			return nil, err
		}
		fk, ok := fks[name]
		if !ok {
			fk = &model.ForeignKeyInfo{Name: name, RefSchema: refSchema, RefTable: refTable, OnDelete: onDelete, OnUpdate: onUpdate}
			fks[name] = fk
			order = append(order, name)
		}
		fk.Columns = append(fk.Columns, column)
		fk.RefColumns = append(fk.RefColumns, refColumn)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]model.ForeignKeyInfo, 0, len(order))
	for _, name := range order {
		out = append(out, *fks[name])
	}
	return out, nil
}

func mysqlDDL(ctx context.Context, pool *sql.DB, database, table string) (string, error) {
	query := "SHOW CREATE TABLE " + quoteIdent(model.DriverMySQL, database) + "." + quoteIdent(model.DriverMySQL, table)
	row := pool.QueryRowContext(ctx, query)
	var name, ddl string
	if err := row.Scan(&name, &ddl); err != nil {
		return "", err
	}
	return strings.TrimSpace(ddl) + ";", nil
}

func pgColumns(ctx context.Context, pool *sql.DB, schema, table string) ([]model.ColumnInfo, error) {
	const q = `
SELECT a.attname,
       t.typname,
       format_type(a.atttypid, a.atttypmod),
       NOT a.attnotnull,
       pg_get_expr(ad.adbin, ad.adrelid),
       a.attnum,
       a.attidentity,
       a.attgenerated,
       COALESCE(col_description(a.attrelid, a.attnum), '')
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_type t ON t.oid = a.atttypid
LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY a.attnum`
	rows, err := pool.QueryContext(ctx, q, schema, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.ColumnInfo
	for rows.Next() {
		var c model.ColumnInfo
		var def sql.NullString
		var identity, generated string
		if err := rows.Scan(&c.Name, &c.DataType, &c.ColumnType, &c.Nullable, &def, &c.Position, &identity, &generated, &c.Comment); err != nil {
			return nil, err
		}
		if def.Valid {
			v := def.String
			c.DefaultValue = &v
		}
		switch {
		case generated != "":
			c.Generated = true
			c.Extra = "generated"
		case identity != "":
			c.Extra = "identity"
		case def.Valid && strings.Contains(def.String, "nextval("):
			c.Extra = "auto_increment"
		}
		c.Position = len(out) + 1
		out = append(out, c)
	}
	return out, rows.Err()
}

func pgIndexes(ctx context.Context, pool *sql.DB, schema, table string) ([]model.IndexInfo, error) {
	const q = `
SELECT i.relname, ix.indisunique, ix.indisprimary, COALESCE(a.attname, ''), s.ordinality, am.amname
FROM pg_index ix
JOIN pg_class i ON i.oid = ix.indexrelid
JOIN pg_class t ON t.oid = ix.indrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
JOIN pg_am am ON am.oid = i.relam
CROSS JOIN LATERAL unnest(ix.indkey::int2[]) WITH ORDINALITY AS s(attnum, ordinality)
LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = s.attnum
WHERE n.nspname = $1 AND t.relname = $2
ORDER BY ix.indisprimary DESC, i.relname, s.ordinality`
	rows, err := pool.QueryContext(ctx, q, schema, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	indexes := map[string]*model.IndexInfo{}
	order := []string{}
	for rows.Next() {
		var name, column, typ string
		var unique, primary bool
		var ordinality int
		if err := rows.Scan(&name, &unique, &primary, &column, &ordinality, &typ); err != nil {
			return nil, err
		}
		idx, ok := indexes[name]
		if !ok {
			idx = &model.IndexInfo{Name: name, Unique: unique, Primary: primary, Type: typ}
			indexes[name] = idx
			order = append(order, name)
		}
		idx.Columns = append(idx.Columns, column)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]model.IndexInfo, 0, len(order))
	for _, name := range order {
		out = append(out, *indexes[name])
	}
	return out, nil
}

func pgForeignKeys(ctx context.Context, pool *sql.DB, schema, table string) ([]model.ForeignKeyInfo, error) {
	const q = `
SELECT con.conname, con.confdeltype, con.confupdtype, fn.nspname, ft.relname,
       a.attname, fa.attname, s.i
FROM pg_constraint con
JOIN pg_class t ON t.oid = con.conrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
JOIN pg_class ft ON ft.oid = con.confrelid
JOIN pg_namespace fn ON fn.oid = ft.relnamespace
JOIN generate_subscripts(con.conkey, 1) s(i) ON true
JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = con.conkey[s.i]
JOIN pg_attribute fa ON fa.attrelid = ft.oid AND fa.attnum = con.confkey[s.i]
WHERE con.contype = 'f' AND n.nspname = $1 AND t.relname = $2
ORDER BY con.conname, s.i`
	rows, err := pool.QueryContext(ctx, q, schema, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	fks := map[string]*model.ForeignKeyInfo{}
	order := []string{}
	for rows.Next() {
		var name, del, upd, refSchema, refTable, column, refColumn string
		var i int
		if err := rows.Scan(&name, &del, &upd, &refSchema, &refTable, &column, &refColumn, &i); err != nil {
			return nil, err
		}
		fk, ok := fks[name]
		if !ok {
			fk = &model.ForeignKeyInfo{
				Name:      name,
				RefSchema: refSchema,
				RefTable:  refTable,
				OnDelete:  pgAction(del),
				OnUpdate:  pgAction(upd),
			}
			fks[name] = fk
			order = append(order, name)
		}
		fk.Columns = append(fk.Columns, column)
		fk.RefColumns = append(fk.RefColumns, refColumn)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]model.ForeignKeyInfo, 0, len(order))
	for _, name := range order {
		out = append(out, *fks[name])
	}
	return out, nil
}

func pgAction(code string) string {
	switch code {
	case "a":
		return "NO ACTION"
	case "r":
		return "RESTRICT"
	case "c":
		return "CASCADE"
	case "n":
		return "SET NULL"
	case "d":
		return "SET DEFAULT"
	default:
		return code
	}
}

func sqliteDDL(ctx context.Context, pool *sql.DB, table string) (string, error) {
	var ddl sql.NullString
	err := pool.QueryRowContext(ctx, `SELECT sql FROM sqlite_master WHERE type IN ('table','view') AND name = ?`, table).Scan(&ddl)
	if err != nil {
		return "", err
	}
	if !ddl.Valid {
		return "", nil
	}
	out := strings.TrimSpace(ddl.String)
	if !strings.HasSuffix(out, ";") {
		out += ";"
	}
	return out, nil
}

func sqliteColumns(ctx context.Context, pool *sql.DB, table string, hasAutoincrement bool) ([]model.ColumnInfo, error) {
	query := `PRAGMA table_xinfo(` + quoteIdent(model.DriverSQLite, table) + `)`
	rows, err := pool.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	type rawColumn struct {
		cid, notNull, pk, hidden int
		name, colType            string
		defaultValue             sql.NullString
	}
	var raw []rawColumn
	for rows.Next() {
		values := make([]any, len(columns))
		ptrs := make([]any, len(columns))
		for i := range values {
			ptrs[i] = &values[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		rc := rawColumn{}
		rc.cid = toInt(values[0])
		rc.name = toString(values[1])
		rc.colType = toString(values[2])
		rc.notNull = toInt(values[3])
		if values[4] != nil {
			rc.defaultValue = sql.NullString{String: toString(values[4]), Valid: true}
		}
		rc.pk = toInt(values[5])
		if len(values) > 6 {
			rc.hidden = toInt(values[6])
		}
		if rc.hidden == 1 {
			continue
		}
		raw = append(raw, rc)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]model.ColumnInfo, 0, len(raw))
	for _, rc := range raw {
		dataType := strings.ToLower(strings.TrimSpace(rc.colType))
		if idx := strings.IndexAny(dataType, "( "); idx > 0 {
			dataType = dataType[:idx]
		}
		if dataType == "" {
			dataType = "text"
		}
		col := model.ColumnInfo{
			Name:       rc.name,
			DataType:   dataType,
			ColumnType: rc.colType,
			Nullable:   rc.notNull == 0 && rc.pk == 0,
			Position:   rc.cid + 1,
			Generated:  rc.hidden == 2 || rc.hidden == 3,
		}
		if rc.colType == "" {
			col.ColumnType = "TEXT"
		}
		if rc.defaultValue.Valid {
			v := rc.defaultValue.String
			col.DefaultValue = &v
		}
		if rc.pk > 0 {
			col.Key = "PRI"
		}
		if rc.hidden == 2 || rc.hidden == 3 {
			col.Extra = "generated"
		} else if rc.pk == 1 && hasAutoincrement && strings.Contains(strings.ToUpper(rc.colType), "INT") {
			col.Extra = "auto_increment"
		}
		out = append(out, col)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Position < out[j].Position })
	return out, nil
}

func sqliteIndexes(ctx context.Context, pool *sql.DB, table string) ([]model.IndexInfo, error) {
	query := `PRAGMA index_list(` + quoteIdent(model.DriverSQLite, table) + `)`
	rows, err := pool.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	type indexRaw struct {
		name    string
		unique  int
		origin  string
		partial int
	}
	var raw []indexRaw
	for rows.Next() {
		cols, err := rows.Columns()
		if err != nil {
			rows.Close()
			return nil, err
		}
		values := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range values {
			ptrs[i] = &values[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			rows.Close()
			return nil, err
		}
		idx := indexRaw{name: toString(values[1]), unique: toInt(values[2]), origin: toString(values[3])}
		if len(values) > 4 {
			idx.partial = toInt(values[4])
		}
		raw = append(raw, idx)
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	var out []model.IndexInfo
	for _, idx := range raw {
		colsQuery := `PRAGMA index_info(` + quoteIdent(model.DriverSQLite, idx.name) + `)`
		colRows, err := pool.QueryContext(ctx, colsQuery)
		if err != nil {
			return nil, err
		}
		var cols []string
		for colRows.Next() {
			colCols, err := colRows.Columns()
			if err != nil {
				colRows.Close()
				return nil, err
			}
			values := make([]any, len(colCols))
			ptrs := make([]any, len(colCols))
			for i := range values {
				ptrs[i] = &values[i]
			}
			if err := colRows.Scan(ptrs...); err != nil {
				colRows.Close()
				return nil, err
			}
			cols = append(cols, toString(values[2]))
		}
		colRows.Close()
		out = append(out, model.IndexInfo{
			Name:    idx.name,
			Columns: cols,
			Unique:  idx.unique == 1,
			Primary: idx.origin == "pk",
			Type:    "btree",
			Comment: sqliteIndexOrigin(idx.origin),
		})
	}
	return out, nil
}

func sqliteForeignKeys(ctx context.Context, pool *sql.DB, table string) ([]model.ForeignKeyInfo, error) {
	query := `PRAGMA foreign_key_list(` + quoteIdent(model.DriverSQLite, table) + `)`
	rows, err := pool.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cols, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	fks := map[int]*model.ForeignKeyInfo{}
	order := []int{}
	for rows.Next() {
		values := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range values {
			ptrs[i] = &values[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		id := toInt(values[0])
		refTable := toString(values[2])
		column := toString(values[3])
		refColumn := toString(values[4])
		onUpdate := toString(values[5])
		onDelete := toString(values[6])
		fk, ok := fks[id]
		if !ok {
			fk = &model.ForeignKeyInfo{
				Name:      "fk_" + strconv.Itoa(id),
				RefSchema: "main",
				RefTable:  refTable,
				OnUpdate:  onUpdate,
				OnDelete:  onDelete,
			}
			fks[id] = fk
			order = append(order, id)
		}
		fk.Columns = append(fk.Columns, column)
		fk.RefColumns = append(fk.RefColumns, refColumn)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]model.ForeignKeyInfo, 0, len(order))
	for _, id := range order {
		out = append(out, *fks[id])
	}
	return out, nil
}

func pgDDL(ctx context.Context, pool *sql.DB, schema, table, objectType string, meta *model.TableMeta) (string, error) {
	if objectType == "view" {
		const q = `
SELECT 'CREATE OR REPLACE VIEW ' || quote_ident(n.nspname) || '.' || quote_ident(c.relname) ||
       ' AS ' || pg_get_viewdef(c.oid, true) || ';'
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = $1 AND c.relname = $2`
		var ddl string
		if err := pool.QueryRowContext(ctx, q, schema, table).Scan(&ddl); err != nil {
			return "", err
		}
		return ddl, nil
	}

	var b strings.Builder
	b.WriteString("CREATE TABLE ")
	b.WriteString(quoteIdent(model.DriverPostgres, schema))
	b.WriteString(".")
	b.WriteString(quoteIdent(model.DriverPostgres, table))
	b.WriteString(" (\n")
	lines := make([]string, 0, len(meta.Columns)+len(meta.ForeignKeys)+1)
	for _, col := range meta.Columns {
		var line strings.Builder
		line.WriteString("  ")
		line.WriteString(quoteIdent(model.DriverPostgres, col.Name))
		line.WriteString(" ")
		line.WriteString(col.ColumnType)
		if col.Generated {
			if col.DefaultValue != nil {
				line.WriteString(" GENERATED ALWAYS AS (")
				line.WriteString(*col.DefaultValue)
				line.WriteString(") STORED")
			}
		} else if col.Extra == "identity" {
			line.WriteString(" GENERATED BY DEFAULT AS IDENTITY")
		} else if col.DefaultValue != nil {
			line.WriteString(" DEFAULT ")
			line.WriteString(*col.DefaultValue)
		}
		if !col.Nullable {
			line.WriteString(" NOT NULL")
		}
		lines = append(lines, line.String())
	}
	var primary *model.IndexInfo
	for i := range meta.Indexes {
		if meta.Indexes[i].Primary {
			primary = &meta.Indexes[i]
			break
		}
	}
	if primary != nil && len(primary.Columns) > 0 {
		cols := make([]string, 0, len(primary.Columns))
		for _, c := range primary.Columns {
			cols = append(cols, quoteIdent(model.DriverPostgres, c))
		}
		lines = append(lines, "  CONSTRAINT "+quoteIdent(model.DriverPostgres, primary.Name)+" PRIMARY KEY ("+strings.Join(cols, ", ")+")")
	}
	for _, fk := range meta.ForeignKeys {
		cols := make([]string, 0, len(fk.Columns))
		for _, c := range fk.Columns {
			cols = append(cols, quoteIdent(model.DriverPostgres, c))
		}
		refCols := make([]string, 0, len(fk.RefColumns))
		for _, c := range fk.RefColumns {
			refCols = append(refCols, quoteIdent(model.DriverPostgres, c))
		}
		lines = append(lines, "  CONSTRAINT "+quoteIdent(model.DriverPostgres, fk.Name)+" FOREIGN KEY ("+strings.Join(cols, ", ")+") REFERENCES "+
			quoteIdent(model.DriverPostgres, fk.RefSchema)+"."+quoteIdent(model.DriverPostgres, fk.RefTable)+" ("+strings.Join(refCols, ", ")+")"+
			fkActionClause(fk.OnDelete, "ON DELETE")+fkActionClause(fk.OnUpdate, "ON UPDATE"))
	}
	b.WriteString(strings.Join(lines, ",\n"))
	b.WriteString("\n);\n")

	for _, idx := range meta.Indexes {
		if idx.Primary {
			continue
		}
		cols := make([]string, 0, len(idx.Columns))
		for _, c := range idx.Columns {
			cols = append(cols, quoteIdent(model.DriverPostgres, c))
		}
		b.WriteString("CREATE ")
		if idx.Unique {
			b.WriteString("UNIQUE ")
		}
		b.WriteString("INDEX ")
		b.WriteString(quoteIdent(model.DriverPostgres, idx.Name))
		b.WriteString(" ON ")
		b.WriteString(quoteIdent(model.DriverPostgres, schema))
		b.WriteString(".")
		b.WriteString(quoteIdent(model.DriverPostgres, table))
		b.WriteString(" (")
		b.WriteString(strings.Join(cols, ", "))
		b.WriteString(");\n")
	}
	if meta.Comment != "" {
		b.WriteString("COMMENT ON TABLE ")
		b.WriteString(quoteIdent(model.DriverPostgres, schema))
		b.WriteString(".")
		b.WriteString(quoteIdent(model.DriverPostgres, table))
		b.WriteString(" IS '")
		b.WriteString(strings.ReplaceAll(meta.Comment, "'", "''"))
		b.WriteString("';\n")
	}
	for _, col := range meta.Columns {
		if col.Comment == "" {
			continue
		}
		b.WriteString("COMMENT ON COLUMN ")
		b.WriteString(quoteIdent(model.DriverPostgres, schema))
		b.WriteString(".")
		b.WriteString(quoteIdent(model.DriverPostgres, table))
		b.WriteString(".")
		b.WriteString(quoteIdent(model.DriverPostgres, col.Name))
		b.WriteString(" IS '")
		b.WriteString(strings.ReplaceAll(col.Comment, "'", "''"))
		b.WriteString("';\n")
	}
	return b.String(), nil
}

func fkActionClause(action, keyword string) string {
	if strings.TrimSpace(action) == "" || strings.EqualFold(action, "NO ACTION") {
		return ""
	}
	return " " + keyword + " " + action
}

func sqliteIndexOrigin(origin string) string {
	switch origin {
	case "c":
		return "手动创建"
	case "u":
		return "UNIQUE 约束"
	case "pk":
		return "主键约束"
	default:
		return origin
	}
}

func toInt(v any) int {
	switch x := v.(type) {
	case int64:
		return int(x)
	case int:
		return x
	case float64:
		return int(x)
	case []byte:
		n, _ := strconv.Atoi(string(x))
		return n
	case string:
		n, _ := strconv.Atoi(x)
		return n
	default:
		return 0
	}
}

func toString(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case []byte:
		return string(x)
	case int64:
		return strconv.FormatInt(x, 10)
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	default:
		return fmt.Sprint(x)
	}
}
