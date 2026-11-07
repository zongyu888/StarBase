package db

import (
	"context"
	"database/sql"
	"strings"

	"navideck/backend/internal/model"
)

func snowflakeInfoSchema(database, object string) string {
	return quoteIdent(model.DriverSnowflake, database) + ".INFORMATION_SCHEMA." + object
}

func snowflakeDatabases(ctx context.Context, pool *sql.DB) ([]model.DatabaseInfo, error) {
	query := `SELECT DATABASE_NAME FROM SNOWFLAKE.INFORMATION_SCHEMA.DATABASES ORDER BY DATABASE_NAME`
	rows, err := pool.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.DatabaseInfo
	for rows.Next() {
		var d model.DatabaseInfo
		if err := rows.Scan(&d.Name); err != nil {
			return nil, err
		}
		d.IsSystem = isSystemDatabase(model.DriverSnowflake, d.Name)
		out = append(out, d)
	}
	return out, rows.Err()
}

func snowflakeSchemas(ctx context.Context, pool *sql.DB, database string) ([]string, error) {
	query := `SELECT SCHEMA_NAME FROM ` + snowflakeInfoSchema(database, "SCHEMATA") +
		` WHERE SCHEMA_NAME <> 'INFORMATION_SCHEMA' ORDER BY SCHEMA_NAME`
	rows, err := pool.QueryContext(ctx, query)
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

func snowflakeObjects(ctx context.Context, pool *sql.DB, database, schema string) ([]model.ObjectInfo, error) {
	query := `SELECT TABLE_NAME,
       TABLE_TYPE,
       'Snowflake',
       CAST(COALESCE(ROW_COUNT, 0) AS BIGINT),
       CAST(COALESCE(BYTES, 0) AS BIGINT),
       COALESCE(COMMENT, ''),
       COALESCE(TO_VARCHAR(CREATED), ''),
       COALESCE(TO_VARCHAR(LAST_ALTERED), '')
FROM ` + snowflakeInfoSchema(database, "TABLES") + `
WHERE TABLE_SCHEMA = ?
ORDER BY TABLE_NAME`
	rows, err := pool.QueryContext(ctx, query, schema)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.ObjectInfo
	for rows.Next() {
		var o model.ObjectInfo
		var tableType string
		if err := rows.Scan(&o.Name, &tableType, &o.Engine, &o.Rows, &o.SizeBytes, &o.Comment, &o.CreatedAt, &o.UpdatedAt); err != nil {
			return nil, err
		}
		if strings.Contains(strings.ToUpper(tableType), "VIEW") {
			o.Type = "view"
		} else {
			o.Type = "table"
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

func snowflakeColumns(ctx context.Context, pool *sql.DB, database, schema, table string) ([]model.ColumnInfo, error) {
	query := `SELECT COLUMN_NAME,
       LOWER(DATA_TYPE),
       CASE
         WHEN DATA_TYPE IN ('VARCHAR', 'CHAR', 'BINARY', 'VARBINARY') AND CHARACTER_MAXIMUM_LENGTH IS NOT NULL
           THEN DATA_TYPE || '(' || CHARACTER_MAXIMUM_LENGTH || ')'
         WHEN DATA_TYPE = 'NUMBER' AND NUMERIC_PRECISION IS NOT NULL
           THEN 'NUMBER(' || NUMERIC_PRECISION || ',' || COALESCE(NUMERIC_SCALE, 0) || ')'
         ELSE DATA_TYPE
       END,
       IS_NULLABLE,
       COLUMN_DEFAULT,
       ORDINAL_POSITION,
       COALESCE(IS_IDENTITY, 'NO'),
       COALESCE(COMMENT, '')
FROM ` + snowflakeInfoSchema(database, "COLUMNS") + `
WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
ORDER BY ORDINAL_POSITION`
	rows, err := pool.QueryContext(ctx, query, schema, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.ColumnInfo
	for rows.Next() {
		var c model.ColumnInfo
		var nullable, identity, defaultValue sql.NullString
		if err := rows.Scan(&c.Name, &c.DataType, &c.ColumnType, &nullable, &defaultValue, &c.Position, &identity, &c.Comment); err != nil {
			return nil, err
		}
		c.Nullable = strings.EqualFold(nullable.String, "YES")
		if defaultValue.Valid && strings.TrimSpace(defaultValue.String) != "" {
			value := strings.TrimSpace(defaultValue.String)
			c.DefaultValue = &value
		}
		if strings.EqualFold(identity.String, "YES") {
			c.Extra = "identity"
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func snowflakeConstraints(ctx context.Context, pool *sql.DB, database, schema, table string) ([]model.IndexInfo, []model.ForeignKeyInfo, error) {
	query := `SELECT tc.CONSTRAINT_NAME, tc.CONSTRAINT_TYPE, kcu.COLUMN_NAME
FROM ` + snowflakeInfoSchema(database, "TABLE_CONSTRAINTS") + ` tc
JOIN ` + snowflakeInfoSchema(database, "KEY_COLUMN_USAGE") + ` kcu
  ON kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
 AND kcu.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
 AND kcu.TABLE_SCHEMA = tc.TABLE_SCHEMA
 AND kcu.TABLE_NAME = tc.TABLE_NAME
WHERE tc.TABLE_SCHEMA = ? AND tc.TABLE_NAME = ?
  AND tc.CONSTRAINT_TYPE IN ('PRIMARY KEY', 'UNIQUE')
ORDER BY tc.CONSTRAINT_NAME, kcu.ORDINAL_POSITION`
	rows, err := pool.QueryContext(ctx, query, schema, table)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	indexes := map[string]*model.IndexInfo{}
	order := []string{}
	for rows.Next() {
		var name, typ, column string
		if err := rows.Scan(&name, &typ, &column); err != nil {
			return nil, nil, err
		}
		idx, ok := indexes[name]
		if !ok {
			primary := strings.EqualFold(typ, "PRIMARY KEY")
			idx = &model.IndexInfo{Name: name, Unique: true, Primary: primary, Type: strings.ToLower(typ)}
			indexes[name] = idx
			order = append(order, name)
		}
		idx.Columns = append(idx.Columns, column)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	out := make([]model.IndexInfo, 0, len(order))
	for _, name := range order {
		out = append(out, *indexes[name])
	}
	return out, []model.ForeignKeyInfo{}, nil
}

func snowflakeDDL(ctx context.Context, pool *sql.DB, database, schema, table, objectType string) (string, error) {
	kind := "TABLE"
	if objectType == "view" {
		kind = "VIEW"
	}
	fullName := database + "." + schema + "." + table
	var ddl string
	if err := pool.QueryRowContext(ctx, `SELECT GET_DDL(?, ?)`, kind, fullName).Scan(&ddl); err != nil {
		return "", err
	}
	return strings.TrimSpace(ddl) + ";", nil
}

func snowflakeColumnDefinition(col model.NewColumn) string {
	var b strings.Builder
	b.WriteString(quoteIdent(model.DriverSnowflake, col.Name))
	b.WriteString(" ")
	b.WriteString(col.Type)
	if col.AutoIncrement {
		b.WriteString(" AUTOINCREMENT")
	}
	if col.DefaultValue != nil && strings.TrimSpace(*col.DefaultValue) != "" {
		b.WriteString(" DEFAULT ")
		b.WriteString(strings.TrimSpace(*col.DefaultValue))
	}
	if !col.Nullable || col.PrimaryKey {
		b.WriteString(" NOT NULL")
	}
	return b.String()
}

func snowflakeColumnDDL(col model.ColumnInfo) string {
	var b strings.Builder
	b.WriteString("  ")
	b.WriteString(quoteIdent(model.DriverSnowflake, col.Name))
	b.WriteString(" ")
	b.WriteString(col.ColumnType)
	if strings.Contains(strings.ToLower(col.Extra), "identity") {
		b.WriteString(" AUTOINCREMENT")
	} else if col.DefaultValue != nil && strings.TrimSpace(*col.DefaultValue) != "" {
		b.WriteString(" DEFAULT ")
		b.WriteString(strings.TrimSpace(*col.DefaultValue))
	}
	if !col.Nullable {
		b.WriteString(" NOT NULL")
	}
	return b.String()
}

func snowflakeDDLFromMeta(schema, table string, meta *model.TableMeta) string {
	var b strings.Builder
	b.WriteString("CREATE TABLE ")
	b.WriteString(quoteIdent(model.DriverSnowflake, schema))
	b.WriteString(".")
	b.WriteString(quoteIdent(model.DriverSnowflake, table))
	b.WriteString(" (\n")
	lines := make([]string, 0, len(meta.Columns)+1)
	for _, col := range meta.Columns {
		lines = append(lines, snowflakeColumnDDL(col))
	}
	for _, idx := range meta.Indexes {
		if !idx.Primary || len(idx.Columns) == 0 {
			continue
		}
		cols := make([]string, 0, len(idx.Columns))
		for _, c := range idx.Columns {
			cols = append(cols, quoteIdent(model.DriverSnowflake, c))
		}
		lines = append(lines, "  CONSTRAINT "+quoteIdent(model.DriverSnowflake, idx.Name)+" PRIMARY KEY ("+strings.Join(cols, ", ")+")")
		break
	}
	b.WriteString(strings.Join(lines, ",\n"))
	b.WriteString("\n);\n")
	return b.String()
}
