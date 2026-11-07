package db

import (
	"context"
	"database/sql"
	"fmt"
	"regexp"
	"strings"

	"navideck/backend/internal/model"
)

var safeToken = regexp.MustCompile(`^[A-Za-z0-9_]+$`)

func validateIdentifier(kind, name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return fmt.Errorf("%s不能为空", kind)
	}
	if strings.ContainsRune(name, 0) {
		return fmt.Errorf("%s包含非法字符", kind)
	}
	return nil
}

func validateSQLFragment(kind, fragment string) error {
	if strings.Contains(fragment, ";") || strings.Contains(fragment, "--") || strings.Contains(fragment, "/*") || strings.ContainsRune(fragment, 0) {
		return fmt.Errorf("%s包含不允许的字符", kind)
	}
	return nil
}

func sqlQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "''") + "'"
}

func (m *Manager) CreateTable(ctx context.Context, conn model.Connection, password string, req model.CreateTableRequest) (model.MutationResult, error) {
	if conn.ReadOnly {
		return model.MutationResult{}, fmt.Errorf("当前连接为只读模式")
	}
	if err := validateIdentifier("表名", req.Name); err != nil {
		return model.MutationResult{}, err
	}
	if len(req.Columns) == 0 {
		return model.MutationResult{}, fmt.Errorf("至少需要定义一列")
	}
	names := map[string]bool{}
	pkCount := 0
	var pkCols []string
	var autoCol *model.NewColumn
	for i := range req.Columns {
		col := &req.Columns[i]
		col.Name = strings.TrimSpace(col.Name)
		col.Type = strings.TrimSpace(col.Type)
		if err := validateIdentifier("列名", col.Name); err != nil {
			return model.MutationResult{}, err
		}
		if names[col.Name] {
			return model.MutationResult{}, fmt.Errorf("列名 %q 重复", col.Name)
		}
		names[col.Name] = true
		if col.Type == "" {
			return model.MutationResult{}, fmt.Errorf("列 %q 缺少数据类型", col.Name)
		}
		if err := validateSQLFragment("数据类型", col.Type); err != nil {
			return model.MutationResult{}, err
		}
		if col.DefaultValue != nil {
			if err := validateSQLFragment("默认值", *col.DefaultValue); err != nil {
				return model.MutationResult{}, err
			}
		}
		if col.PrimaryKey {
			pkCount++
			pkCols = append(pkCols, col.Name)
		}
		if col.AutoIncrement {
			if autoCol != nil {
				return model.MutationResult{}, fmt.Errorf("只能有一列自增")
			}
			lowerType := strings.ToLower(col.Type)
			if !strings.Contains(lowerType, "int") && !strings.Contains(lowerType, "number") && !strings.Contains(lowerType, "numeric") {
				return model.MutationResult{}, fmt.Errorf("自增列必须是整数类型")
			}
			if col.DefaultValue != nil && *col.DefaultValue != "" {
				return model.MutationResult{}, fmt.Errorf("自增列不能设置默认值")
			}
			autoCol = col
		}
	}
	if autoCol != nil && !autoCol.PrimaryKey {
		autoCol.PrimaryKey = true
		pkCount++
		pkCols = append(pkCols, autoCol.Name)
	}
	if conn.Driver == model.DriverSQLite && autoCol != nil && pkCount > 1 {
		return model.MutationResult{}, fmt.Errorf("SQLite 自增列不能作为联合主键的一部分")
	}

	target := qualifiedTable(conn.Driver, req.Database, req.Schema, req.Name)
	var lines []string
	for _, col := range req.Columns {
		if conn.Driver == model.DriverSQLite && autoCol != nil && col.Name == autoCol.Name {
			lines = append(lines, quoteIdent(conn.Driver, col.Name)+" INTEGER PRIMARY KEY AUTOINCREMENT")
			continue
		}
		line, err := columnDefinition(conn.Driver, col, false)
		if err != nil {
			return model.MutationResult{}, err
		}
		lines = append(lines, line)
	}
	inlineSQLitePK := conn.Driver == model.DriverSQLite && autoCol != nil
	if !inlineSQLitePK && len(pkCols) > 0 {
		quoted := make([]string, 0, len(pkCols))
		for _, name := range pkCols {
			quoted = append(quoted, quoteIdent(conn.Driver, name))
		}
		lines = append(lines, "PRIMARY KEY ("+strings.Join(quoted, ", ")+")")
	}

	var ddl strings.Builder
	ddl.WriteString("CREATE TABLE ")
	ddl.WriteString(target)
	ddl.WriteString(" (\n  ")
	ddl.WriteString(strings.Join(lines, ",\n  "))
	ddl.WriteString("\n)")
	if isMySQLFamily(conn.Driver) {
		ddl.WriteString(" ENGINE=InnoDB DEFAULT CHARSET=utf8mb4")
		if req.Comment != "" {
			ddl.WriteString(" COMMENT=")
			ddl.WriteString(sqlQuote(req.Comment))
		}
	}
	ddl.WriteString(";")

	pool, err := m.DB(ctx, conn, password, req.Database)
	if err != nil {
		return model.MutationResult{}, err
	}
	if _, err := pool.ExecContext(ctx, ddl.String()); err != nil {
		return model.MutationResult{}, err
	}
	statements := []string{ddl.String()}
	switch conn.Driver {
	case model.DriverPostgres, model.DriverOracle, model.DriverSnowflake:
		if req.Comment != "" {
			stmt := "COMMENT ON TABLE " + target + " IS " + sqlQuote(req.Comment) + ";"
			if _, err := pool.ExecContext(ctx, stmt); err != nil {
				return model.MutationResult{}, err
			}
			statements = append(statements, stmt)
		}
		for _, col := range req.Columns {
			if strings.TrimSpace(col.Comment) == "" {
				continue
			}
			stmt := "COMMENT ON COLUMN " + target + "." + quoteIdent(conn.Driver, col.Name) + " IS " + sqlQuote(col.Comment) + ";"
			if _, err := pool.ExecContext(ctx, stmt); err != nil {
				return model.MutationResult{}, err
			}
			statements = append(statements, stmt)
		}
	case model.DriverSQLServer:
		schema := effectiveSchema(conn.Driver, req.Database, req.Schema)
		if req.Comment != "" {
			stmt := sqlServerCommentStatement(schema, req.Name, "", req.Comment)
			if _, err := pool.ExecContext(ctx, stmt); err != nil {
				return model.MutationResult{}, err
			}
			statements = append(statements, stmt)
		}
		for _, col := range req.Columns {
			if strings.TrimSpace(col.Comment) == "" {
				continue
			}
			stmt := sqlServerCommentStatement(schema, req.Name, col.Name, col.Comment)
			if _, err := pool.ExecContext(ctx, stmt); err != nil {
				return model.MutationResult{}, err
			}
			statements = append(statements, stmt)
		}
	}
	return model.MutationResult{DDL: strings.Join(statements, "\n")}, nil
}

func columnDefinition(driver string, col model.NewColumn, forAlter bool) (string, error) {
	var b strings.Builder
	b.WriteString(quoteIdent(driver, col.Name))
	b.WriteString(" ")
	b.WriteString(col.Type)
	if col.AutoIncrement {
		switch driver {
		case model.DriverMySQL, model.DriverMariaDB:
			b.WriteString(" AUTO_INCREMENT")
		case model.DriverPostgres:
			b.WriteString(" GENERATED BY DEFAULT AS IDENTITY")
		case model.DriverSQLServer:
			b.WriteString(" IDENTITY(1,1)")
		case model.DriverOracle:
			b.WriteString(" GENERATED BY DEFAULT AS IDENTITY")
		case model.DriverSnowflake:
			b.WriteString(" AUTOINCREMENT")
		case model.DriverSQLite:
			return "", fmt.Errorf("SQLite 自增列必须在创建表时定义")
		}
	}
	if col.DefaultValue != nil && strings.TrimSpace(*col.DefaultValue) != "" {
		if col.AutoIncrement {
			return "", fmt.Errorf("自增列不能设置默认值")
		}
		b.WriteString(" DEFAULT ")
		b.WriteString(strings.TrimSpace(*col.DefaultValue))
	}
	if !col.Nullable || col.PrimaryKey {
		b.WriteString(" NOT NULL")
	} else if driver == model.DriverSQLServer || driver == model.DriverOracle || driver == model.DriverSnowflake {
		b.WriteString(" NULL")
	}
	if isMySQLFamily(driver) && strings.TrimSpace(col.Comment) != "" {
		b.WriteString(" COMMENT ")
		b.WriteString(sqlQuote(col.Comment))
	}
	return b.String(), nil
}

func (m *Manager) DropObject(ctx context.Context, conn model.Connection, password, database, schema, table, objectType string) (model.MutationResult, error) {
	if conn.ReadOnly {
		return model.MutationResult{}, fmt.Errorf("当前连接为只读模式")
	}
	if err := validateIdentifier("对象名", table); err != nil {
		return model.MutationResult{}, err
	}
	if conn.Driver == model.DriverMongo {
		return m.mongoDropCollection(ctx, conn, password, database, table)
	}
	meta, err := m.TableMeta(ctx, conn, password, database, schema, table)
	if err != nil {
		return model.MutationResult{}, err
	}
	if objectType == "" {
		objectType = meta.Type
	}
	kind := "TABLE"
	if objectType == "view" {
		kind = "VIEW"
	}
	stmt := "DROP " + kind + " " + qualifiedTable(conn.Driver, database, schema, table)
	pool, err := m.DB(ctx, conn, password, database)
	if err != nil {
		return model.MutationResult{}, err
	}
	if _, err := pool.ExecContext(ctx, stmt); err != nil {
		return model.MutationResult{}, err
	}
	return model.MutationResult{DDL: stmt + ";"}, nil
}

func (m *Manager) TruncateTable(ctx context.Context, conn model.Connection, password, database, schema, table string) (model.MutationResult, error) {
	if conn.ReadOnly {
		return model.MutationResult{}, fmt.Errorf("当前连接为只读模式")
	}
	meta, err := m.TableMeta(ctx, conn, password, database, schema, table)
	if err != nil {
		return model.MutationResult{}, err
	}
	if meta.Type != "table" {
		return model.MutationResult{}, fmt.Errorf("只能清空数据表")
	}
	pool, err := m.DB(ctx, conn, password, database)
	if err != nil {
		return model.MutationResult{}, err
	}
	stmt := "TRUNCATE TABLE " + qualifiedTable(conn.Driver, database, schema, table)
	if conn.Driver == model.DriverSQLite {
		stmt = "DELETE FROM " + qualifiedTable(conn.Driver, database, schema, table)
	}
	res, err := pool.ExecContext(ctx, stmt)
	if err != nil {
		return model.MutationResult{}, err
	}
	affected, _ := res.RowsAffected()
	return model.MutationResult{AffectedRows: affected, DDL: stmt + ";"}, nil
}

func (m *Manager) AlterTable(ctx context.Context, conn model.Connection, password string, req model.AlterTableRequest) (model.MutationResult, error) {
	if conn.ReadOnly {
		return model.MutationResult{}, fmt.Errorf("当前连接为只读模式")
	}
	meta, err := m.TableMeta(ctx, conn, password, req.Database, req.Schema, req.Table)
	if err != nil {
		return model.MutationResult{}, err
	}
	pool, err := m.DB(ctx, conn, password, req.Database)
	if err != nil {
		return model.MutationResult{}, err
	}
	target := qualifiedTable(conn.Driver, req.Database, req.Schema, req.Table)
	columnMap := map[string]model.ColumnInfo{}
	for _, col := range meta.Columns {
		columnMap[col.Name] = col
	}

	switch req.Action {
	case "add_column":
		if req.Column == nil {
			return model.MutationResult{}, fmt.Errorf("缺少列定义")
		}
		col := *req.Column
		col.Name = strings.TrimSpace(col.Name)
		col.Type = strings.TrimSpace(col.Type)
		if err := validateIdentifier("列名", col.Name); err != nil {
			return model.MutationResult{}, err
		}
		if columnMap[col.Name].Name != "" {
			return model.MutationResult{}, fmt.Errorf("列 %q 已存在", col.Name)
		}
		if col.Type == "" {
			return model.MutationResult{}, fmt.Errorf("缺少数据类型")
		}
		if err := validateSQLFragment("数据类型", col.Type); err != nil {
			return model.MutationResult{}, err
		}
		if col.DefaultValue != nil {
			if err := validateSQLFragment("默认值", *col.DefaultValue); err != nil {
				return model.MutationResult{}, err
			}
		}
		if col.PrimaryKey || col.AutoIncrement {
			return model.MutationResult{}, fmt.Errorf("修改表时暂不支持添加主键或自增列")
		}
		def, err := columnDefinition(conn.Driver, col, true)
		if err != nil {
			return model.MutationResult{}, err
		}
		var stmt string
		switch conn.Driver {
		case model.DriverMySQL, model.DriverMariaDB, model.DriverPostgres, model.DriverSQLite:
			stmt = "ALTER TABLE " + target + " ADD COLUMN " + def
		case model.DriverOracle:
			stmt = "ALTER TABLE " + target + " ADD (" + def + ")"
		default:
			stmt = "ALTER TABLE " + target + " ADD " + def
		}
		if _, err := pool.ExecContext(ctx, stmt); err != nil {
			return model.MutationResult{}, err
		}
		statements := []string{stmt + ";"}
		if strings.TrimSpace(col.Comment) != "" {
			switch conn.Driver {
			case model.DriverPostgres, model.DriverOracle, model.DriverSnowflake:
				commentStmt := "COMMENT ON COLUMN " + target + "." + quoteIdent(conn.Driver, col.Name) + " IS " + sqlQuote(col.Comment) + ";"
				if _, err := pool.ExecContext(ctx, commentStmt); err != nil {
					return model.MutationResult{}, err
				}
				statements = append(statements, commentStmt)
			case model.DriverSQLServer:
				schema := effectiveSchema(conn.Driver, req.Database, req.Schema)
				commentStmt, err := m.setSQLServerComment(ctx, pool, schema, req.Table, col.Name, col.Comment)
				if err != nil {
					return model.MutationResult{}, err
				}
				if commentStmt != "" {
					statements = append(statements, commentStmt)
				}
			}
		}
		return model.MutationResult{DDL: strings.Join(statements, "\n")}, nil

	case "drop_column":
		name := strings.TrimSpace(req.Name)
		if err := validateIdentifier("列名", name); err != nil {
			return model.MutationResult{}, err
		}
		if _, ok := columnMap[name]; !ok {
			return model.MutationResult{}, fmt.Errorf("列 %q 不存在", name)
		}
		stmt := "ALTER TABLE " + target + " DROP COLUMN " + quoteIdent(conn.Driver, name)
		if _, err := pool.ExecContext(ctx, stmt); err != nil {
			return model.MutationResult{}, err
		}
		return model.MutationResult{DDL: stmt + ";"}, nil

	case "rename_column":
		oldName := strings.TrimSpace(req.Name)
		if req.Column == nil {
			return model.MutationResult{}, fmt.Errorf("缺少列定义")
		}
		newName := strings.TrimSpace(req.Column.Name)
		if err := validateIdentifier("原列名", oldName); err != nil {
			return model.MutationResult{}, err
		}
		if err := validateIdentifier("新列名", newName); err != nil {
			return model.MutationResult{}, err
		}
		if _, ok := columnMap[oldName]; !ok {
			return model.MutationResult{}, fmt.Errorf("列 %q 不存在", oldName)
		}
		if _, ok := columnMap[newName]; ok {
			return model.MutationResult{}, fmt.Errorf("列 %q 已存在", newName)
		}
		var stmt string
		if conn.Driver == model.DriverSQLServer {
			schema := effectiveSchema(conn.Driver, req.Database, req.Schema)
			qualified := sqlServerQuotedObject(schema, req.Table) + "." + quoteIdent(conn.Driver, oldName)
			stmt = "EXEC sp_rename N'" + escapeSQLString(qualified) + "', N'" + escapeSQLString(newName) + "', N'COLUMN'"
		} else {
			stmt = "ALTER TABLE " + target + " RENAME COLUMN " + quoteIdent(conn.Driver, oldName) + " TO " + quoteIdent(conn.Driver, newName)
		}
		if _, err := pool.ExecContext(ctx, stmt); err != nil {
			return model.MutationResult{}, err
		}
		return model.MutationResult{DDL: stmt + ";"}, nil

	case "modify_column":
		return m.modifyColumn(ctx, conn, pool, target, meta, columnMap, req)

	case "rename_table":
		return m.renameTable(ctx, conn, pool, req)

	case "set_table_comment":
		if conn.Driver == model.DriverSQLite {
			return model.MutationResult{}, fmt.Errorf("SQLite 不支持表注释")
		}
		comment := ""
		if req.Comment != nil {
			comment = strings.TrimSpace(*req.Comment)
		}
		var stmt string
		switch conn.Driver {
		case model.DriverMySQL, model.DriverMariaDB:
			stmt = "ALTER TABLE " + target + " COMMENT = " + sqlQuote(comment)
		case model.DriverSQLServer:
			schema := effectiveSchema(conn.Driver, req.Database, req.Schema)
			commentStmt, err := m.setSQLServerComment(ctx, pool, schema, req.Table, "", comment)
			if err != nil {
				return model.MutationResult{}, err
			}
			if commentStmt == "" {
				return model.MutationResult{}, nil
			}
			return model.MutationResult{DDL: commentStmt}, nil
		default:
			value := "NULL"
			if comment != "" {
				value = sqlQuote(comment)
			}
			stmt = "COMMENT ON TABLE " + target + " IS " + value
		}
		if _, err := pool.ExecContext(ctx, stmt); err != nil {
			return model.MutationResult{}, err
		}
		return model.MutationResult{DDL: stmt + ";"}, nil

	case "add_foreign_key":
		return m.addForeignKey(ctx, conn, pool, req, columnMap, meta)

	case "drop_foreign_key":
		return m.dropForeignKey(ctx, conn, pool, target, meta, req)

	case "add_index":
		name := strings.TrimSpace(req.Name)
		if err := validateIdentifier("索引名", name); err != nil {
			return model.MutationResult{}, err
		}
		if len(req.Columns) == 0 {
			return model.MutationResult{}, fmt.Errorf("至少选择一个索引列")
		}
		var cols []string
		for _, c := range req.Columns {
			if _, ok := columnMap[c]; !ok {
				return model.MutationResult{}, fmt.Errorf("列 %q 不存在", c)
			}
			cols = append(cols, quoteIdent(conn.Driver, c))
		}
		var stmt string
		schema := effectiveSchema(conn.Driver, req.Database, req.Schema)
		if conn.Driver == model.DriverOracle {
			schema = oracleSchema(conn, req.Schema)
		}
		switch conn.Driver {
		case model.DriverMySQL, model.DriverMariaDB:
			stmt = "CREATE " + uniqueWord(req.Unique) + "INDEX " + quoteIdent(conn.Driver, name) + " ON " + target + " (" + strings.Join(cols, ", ") + ")"
		case model.DriverPostgres:
			stmt = "CREATE " + uniqueWord(req.Unique) + "INDEX " + quoteIdent(conn.Driver, name) + " ON " +
				quoteIdent(conn.Driver, schema) + "." + quoteIdent(conn.Driver, req.Table) + " (" + strings.Join(cols, ", ") + ")"
		case model.DriverSQLServer:
			stmt = "CREATE " + uniqueWord(req.Unique) + "INDEX " + quoteIdent(conn.Driver, name) + " ON " +
				quoteIdent(conn.Driver, schema) + "." + quoteIdent(conn.Driver, req.Table) + " (" + strings.Join(cols, ", ") + ")"
		case model.DriverOracle:
			stmt = "CREATE " + uniqueWord(req.Unique) + "INDEX " + quoteIdent(conn.Driver, name) + " ON " +
				quoteIdent(conn.Driver, schema) + "." + quoteIdent(conn.Driver, req.Table) + " (" + strings.Join(cols, ", ") + ")"
		case model.DriverSnowflake:
			return model.MutationResult{}, fmt.Errorf("Snowflake 不支持传统索引")
		default:
			stmt = "CREATE " + uniqueWord(req.Unique) + "INDEX " + quoteIdent(conn.Driver, name) + " ON " +
				quoteIdent(conn.Driver, req.Table) + " (" + strings.Join(cols, ", ") + ")"
		}
		if _, err := pool.ExecContext(ctx, stmt); err != nil {
			return model.MutationResult{}, err
		}
		return model.MutationResult{DDL: stmt + ";"}, nil

	case "drop_index":
		name := strings.TrimSpace(req.Name)
		if err := validateIdentifier("索引名", name); err != nil {
			return model.MutationResult{}, err
		}
		var found *model.IndexInfo
		for i := range meta.Indexes {
			if meta.Indexes[i].Name == name {
				found = &meta.Indexes[i]
				break
			}
		}
		if found == nil {
			return model.MutationResult{}, fmt.Errorf("索引 %q 不存在", name)
		}
		if found.Primary {
			return model.MutationResult{}, fmt.Errorf("不能通过此操作删除主键索引")
		}
		if conn.Driver == model.DriverSQLite && strings.HasPrefix(strings.ToLower(name), "sqlite_autoindex") {
			return model.MutationResult{}, fmt.Errorf("SQLite 自动索引由约束管理，不能直接删除")
		}
		var stmt string
		schema := effectiveSchema(conn.Driver, req.Database, req.Schema)
		if conn.Driver == model.DriverOracle {
			schema = oracleSchema(conn, req.Schema)
		}
		switch conn.Driver {
		case model.DriverMySQL, model.DriverMariaDB:
			stmt = "ALTER TABLE " + target + " DROP INDEX " + quoteIdent(conn.Driver, name)
		case model.DriverPostgres:
			stmt = "DROP INDEX " + quoteIdent(conn.Driver, schema) + "." + quoteIdent(conn.Driver, name)
		case model.DriverSQLServer:
			stmt = "DROP INDEX " + quoteIdent(conn.Driver, name) + " ON " + quoteIdent(conn.Driver, schema) + "." + quoteIdent(conn.Driver, req.Table)
		case model.DriverOracle:
			stmt = "DROP INDEX " + quoteIdent(conn.Driver, schema) + "." + quoteIdent(conn.Driver, name)
		case model.DriverSnowflake:
			return model.MutationResult{}, fmt.Errorf("Snowflake 不支持传统索引")
		default:
			stmt = "DROP INDEX " + quoteIdent(conn.Driver, "main") + "." + quoteIdent(conn.Driver, name)
		}
		if _, err := pool.ExecContext(ctx, stmt); err != nil {
			return model.MutationResult{}, err
		}
		return model.MutationResult{DDL: stmt + ";"}, nil
	}
	return model.MutationResult{}, fmt.Errorf("不支持的表结构操作 %q", req.Action)
}

func (m *Manager) modifyColumn(ctx context.Context, conn model.Connection, pool *sql.DB, target string, meta *model.TableMeta, columnMap map[string]model.ColumnInfo, req model.AlterTableRequest) (model.MutationResult, error) {
	if req.Column == nil {
		return model.MutationResult{}, fmt.Errorf("缺少列定义")
	}
	oldName := strings.TrimSpace(req.Name)
	if oldName == "" {
		oldName = strings.TrimSpace(req.Column.Name)
	}
	if err := validateIdentifier("列名", oldName); err != nil {
		return model.MutationResult{}, err
	}
	oldCol, ok := columnMap[oldName]
	if !ok {
		return model.MutationResult{}, fmt.Errorf("列 %q 不存在", oldName)
	}
	if oldCol.Generated {
		return model.MutationResult{}, fmt.Errorf("生成列 %q 不支持直接修改，请通过 SQL 重建列", oldName)
	}
	if conn.Driver == model.DriverSQLite {
		return model.MutationResult{}, fmt.Errorf("SQLite 不支持直接修改列定义；可重命名列，或先在查询窗口重建表")
	}

	col := *req.Column
	col.Name = strings.TrimSpace(col.Name)
	if col.Name == "" {
		col.Name = oldName
	}
	if err := validateIdentifier("列名", col.Name); err != nil {
		return model.MutationResult{}, err
	}
	if col.Name != oldName {
		if _, exists := columnMap[col.Name]; exists {
			return model.MutationResult{}, fmt.Errorf("列 %q 已存在", col.Name)
		}
	}
	col.Type = strings.TrimSpace(col.Type)
	if col.Type == "" {
		return model.MutationResult{}, fmt.Errorf("缺少数据类型")
	}
	if err := validateSQLFragment("数据类型", col.Type); err != nil {
		return model.MutationResult{}, err
	}
	if col.DefaultValue != nil {
		if err := validateSQLFragment("默认值", *col.DefaultValue); err != nil {
			return model.MutationResult{}, err
		}
	}
	extra := strings.ToLower(oldCol.Extra)
	autoIncrement := strings.Contains(extra, "auto_increment") || strings.Contains(extra, "identity")
	if autoIncrement && !isIntegerType(col.Type) {
		return model.MutationResult{}, fmt.Errorf("自增列必须保持整数类型")
	}
	if col.AutoIncrement && !autoIncrement {
		if !isMySQLFamily(conn.Driver) {
			return model.MutationResult{}, fmt.Errorf("暂不支持通过修改列添加自增/identity，请使用 SQL 操作")
		}
		if !isIntegerType(col.Type) {
			return model.MutationResult{}, fmt.Errorf("自增列必须是整数类型")
		}
		autoIncrement = true
	}

	switch conn.Driver {
	case model.DriverMySQL, model.DriverMariaDB:
		definition := mysqlModifyColumnDefinition(col, autoIncrement)
		if onUpdate := mysqlOnUpdateClause(oldCol.Extra); onUpdate != "" {
			definition += " ON UPDATE " + onUpdate
		}
		var stmt string
		if col.Name != oldName {
			stmt = "ALTER TABLE " + target + " CHANGE COLUMN " + quoteIdent(conn.Driver, oldName) + " " + definition
		} else {
			stmt = "ALTER TABLE " + target + " MODIFY COLUMN " + definition
		}
		if _, err := pool.ExecContext(ctx, stmt); err != nil {
			return model.MutationResult{}, err
		}
		return model.MutationResult{DDL: stmt + ";"}, nil

	case model.DriverPostgres:
		return m.modifyPostgresColumn(ctx, pool, target, oldCol, col)

	case model.DriverSQLServer:
		return m.modifySQLServerColumn(ctx, conn, pool, req, target, oldCol, col)

	case model.DriverOracle:
		return m.modifyOracleColumn(ctx, pool, target, oldCol, col)

	case model.DriverSnowflake:
		return m.modifySnowflakeColumn(ctx, pool, target, oldCol, col)

	default:
		return model.MutationResult{}, fmt.Errorf("当前数据库不支持修改列")
	}
}

func isIntegerType(value string) bool {
	lower := strings.ToLower(strings.TrimSpace(value))
	return strings.Contains(lower, "int") ||
		strings.HasPrefix(lower, "number") ||
		strings.HasPrefix(lower, "numeric") ||
		strings.Contains(lower, "serial")
}

func (m *Manager) modifySQLServerColumn(ctx context.Context, conn model.Connection, pool *sql.DB, req model.AlterTableRequest, target string, oldCol model.ColumnInfo, col model.NewColumn) (model.MutationResult, error) {
	statements := make([]string, 0, 4)
	run := func(stmt string) error {
		if _, err := pool.ExecContext(ctx, stmt); err != nil {
			return err
		}
		statements = append(statements, stmt+";")
		return nil
	}
	schema := effectiveSchema(conn.Driver, req.Database, req.Schema)
	current := oldCol.Name
	if col.Name != oldCol.Name {
		qualified := sqlServerQuotedObject(schema, req.Table) + "." + quoteIdent(model.DriverSQLServer, current)
		stmt := "EXEC sp_rename N'" + escapeSQLString(qualified) + "', N'" + escapeSQLString(col.Name) + "', N'COLUMN'"
		if err := run(stmt); err != nil {
			return model.MutationResult{}, err
		}
		current = col.Name
	}

	object := sqlServerQuotedObject(schema, req.Table)
	var defaultName string
	err := pool.QueryRowContext(ctx, `
SELECT dc.name
FROM sys.default_constraints dc
JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
WHERE dc.parent_object_id = OBJECT_ID(@p1) AND c.name = @p2`, object, current).Scan(&defaultName)
	if err != nil && err != sql.ErrNoRows {
		return model.MutationResult{}, err
	}

	typeChanged := !strings.EqualFold(strings.TrimSpace(oldCol.ColumnType), strings.TrimSpace(col.Type))
	nullableChanged := col.Nullable != oldCol.Nullable
	wantDefault := ""
	if col.DefaultValue != nil {
		wantDefault = strings.TrimSpace(*col.DefaultValue)
	}
	oldDefault := ""
	if oldCol.DefaultValue != nil {
		oldDefault = strings.TrimSpace(*oldCol.DefaultValue)
	}
	defaultChanged := wantDefault != oldDefault
	droppedDefault := false
	if defaultName != "" && (typeChanged || defaultChanged) {
		if err := run("ALTER TABLE " + target + " DROP CONSTRAINT " + quoteIdent(model.DriverSQLServer, defaultName)); err != nil {
			return model.MutationResult{}, err
		}
		droppedDefault = true
	}
	if typeChanged || nullableChanged {
		definition := quoteIdent(model.DriverSQLServer, current) + " " + col.Type
		if col.Nullable {
			definition += " NULL"
		} else {
			definition += " NOT NULL"
		}
		if err := run("ALTER TABLE " + target + " ALTER COLUMN " + definition); err != nil {
			return model.MutationResult{}, err
		}
	}
	if wantDefault != "" && (defaultChanged || droppedDefault) {
		if err := run("ALTER TABLE " + target + " ADD DEFAULT " + wantDefault + " FOR " + quoteIdent(model.DriverSQLServer, current)); err != nil {
			return model.MutationResult{}, err
		}
	}
	comment := strings.TrimSpace(col.Comment)
	if comment != strings.TrimSpace(oldCol.Comment) {
		stmt, err := m.setSQLServerComment(ctx, pool, schema, req.Table, current, comment)
		if err != nil {
			return model.MutationResult{}, err
		}
		if stmt != "" {
			statements = append(statements, stmt)
		}
	}
	if len(statements) == 0 {
		return model.MutationResult{}, fmt.Errorf("没有检测到需要修改的内容")
	}
	return model.MutationResult{DDL: strings.Join(statements, "\n")}, nil
}

func (m *Manager) modifyOracleColumn(ctx context.Context, pool *sql.DB, target string, oldCol model.ColumnInfo, col model.NewColumn) (model.MutationResult, error) {
	statements := make([]string, 0, 3)
	run := func(stmt string) error {
		if _, err := pool.ExecContext(ctx, stmt); err != nil {
			return err
		}
		statements = append(statements, stmt+";")
		return nil
	}
	current := oldCol.Name
	if col.Name != oldCol.Name {
		stmt := "ALTER TABLE " + target + " RENAME COLUMN " + quoteIdent(model.DriverOracle, current) + " TO " + quoteIdent(model.DriverOracle, col.Name)
		if err := run(stmt); err != nil {
			return model.MutationResult{}, err
		}
		current = col.Name
	}
	typeChanged := !strings.EqualFold(strings.TrimSpace(oldCol.ColumnType), strings.TrimSpace(col.Type))
	nullableChanged := col.Nullable != oldCol.Nullable
	wantDefault := ""
	if col.DefaultValue != nil {
		wantDefault = strings.TrimSpace(*col.DefaultValue)
	}
	oldDefault := ""
	if oldCol.DefaultValue != nil {
		oldDefault = strings.TrimSpace(*oldCol.DefaultValue)
	}
	defaultChanged := wantDefault != oldDefault
	isIdentity := strings.Contains(strings.ToLower(oldCol.Extra), "identity")
	if isIdentity && (typeChanged || nullableChanged || defaultChanged) {
		return model.MutationResult{}, fmt.Errorf("Oracle identity 列请使用 SQL 修改类型或默认值")
	}
	if typeChanged || nullableChanged || defaultChanged {
		definition := quoteIdent(model.DriverOracle, current) + " " + col.Type
		if wantDefault != "" {
			definition += " DEFAULT " + wantDefault
		} else if oldDefault != "" {
			definition += " DEFAULT NULL"
		}
		if col.Nullable {
			definition += " NULL"
		} else {
			definition += " NOT NULL"
		}
		if err := run("ALTER TABLE " + target + " MODIFY (" + definition + ")"); err != nil {
			return model.MutationResult{}, err
		}
	}
	comment := strings.TrimSpace(col.Comment)
	if comment != strings.TrimSpace(oldCol.Comment) {
		stmt := "COMMENT ON COLUMN " + target + "." + quoteIdent(model.DriverOracle, current) + " IS " + sqlQuote(comment)
		if err := run(stmt); err != nil {
			return model.MutationResult{}, err
		}
	}
	if len(statements) == 0 {
		return model.MutationResult{}, fmt.Errorf("没有检测到需要修改的内容")
	}
	return model.MutationResult{DDL: strings.Join(statements, "\n")}, nil
}

func (m *Manager) modifySnowflakeColumn(ctx context.Context, pool *sql.DB, target string, oldCol model.ColumnInfo, col model.NewColumn) (model.MutationResult, error) {
	statements := make([]string, 0, 4)
	run := func(stmt string) error {
		if _, err := pool.ExecContext(ctx, stmt); err != nil {
			return err
		}
		statements = append(statements, stmt+";")
		return nil
	}
	current := oldCol.Name
	if col.Name != oldCol.Name {
		if err := run("ALTER TABLE " + target + " RENAME COLUMN " + quoteIdent(model.DriverSnowflake, current) + " TO " + quoteIdent(model.DriverSnowflake, col.Name)); err != nil {
			return model.MutationResult{}, err
		}
		current = col.Name
	}
	typeChanged := !strings.EqualFold(strings.TrimSpace(oldCol.ColumnType), strings.TrimSpace(col.Type))
	nullableChanged := col.Nullable != oldCol.Nullable
	wantDefault := ""
	if col.DefaultValue != nil {
		wantDefault = strings.TrimSpace(*col.DefaultValue)
	}
	oldDefault := ""
	if oldCol.DefaultValue != nil {
		oldDefault = strings.TrimSpace(*oldCol.DefaultValue)
	}
	if strings.Contains(strings.ToLower(oldCol.Extra), "identity") && (typeChanged || nullableChanged || wantDefault != oldDefault) {
		return model.MutationResult{}, fmt.Errorf("Snowflake identity 列请使用 SQL 修改")
	}
	if typeChanged {
		if err := run("ALTER TABLE " + target + " ALTER COLUMN " + quoteIdent(model.DriverSnowflake, current) + " SET DATA TYPE " + col.Type); err != nil {
			return model.MutationResult{}, err
		}
	}
	if nullableChanged {
		action := " SET NOT NULL"
		if col.Nullable {
			action = " DROP NOT NULL"
		}
		if err := run("ALTER TABLE " + target + " ALTER COLUMN " + quoteIdent(model.DriverSnowflake, current) + action); err != nil {
			return model.MutationResult{}, err
		}
	}
	if wantDefault != oldDefault {
		if wantDefault == "" {
			if err := run("ALTER TABLE " + target + " ALTER COLUMN " + quoteIdent(model.DriverSnowflake, current) + " DROP DEFAULT"); err != nil {
				return model.MutationResult{}, err
			}
		} else if err := run("ALTER TABLE " + target + " ALTER COLUMN " + quoteIdent(model.DriverSnowflake, current) + " SET DEFAULT " + wantDefault); err != nil {
			return model.MutationResult{}, err
		}
	}
	comment := strings.TrimSpace(col.Comment)
	if comment != strings.TrimSpace(oldCol.Comment) {
		if err := run("COMMENT ON COLUMN " + target + "." + quoteIdent(model.DriverSnowflake, current) + " IS " + sqlQuote(comment)); err != nil {
			return model.MutationResult{}, err
		}
	}
	if len(statements) == 0 {
		return model.MutationResult{}, fmt.Errorf("没有检测到需要修改的内容")
	}
	return model.MutationResult{DDL: strings.Join(statements, "\n")}, nil
}

func mysqlModifyColumnDefinition(col model.NewColumn, autoIncrement bool) string {
	var b strings.Builder
	b.WriteString(quoteIdent(model.DriverMySQL, col.Name))
	b.WriteString(" ")
	b.WriteString(col.Type)
	if autoIncrement {
		b.WriteString(" AUTO_INCREMENT")
	}
	if col.DefaultValue != nil && strings.TrimSpace(*col.DefaultValue) != "" {
		b.WriteString(" DEFAULT ")
		b.WriteString(strings.TrimSpace(*col.DefaultValue))
	}
	if !col.Nullable || col.PrimaryKey {
		b.WriteString(" NOT NULL")
	} else {
		b.WriteString(" NULL")
	}
	if strings.TrimSpace(col.Comment) != "" {
		b.WriteString(" COMMENT ")
		b.WriteString(sqlQuote(col.Comment))
	}
	return b.String()
}

func mysqlOnUpdateClause(extra string) string {
	lower := strings.ToLower(extra)
	index := strings.Index(lower, "on update ")
	if index < 0 {
		return ""
	}
	return strings.TrimSpace(extra[index+len("on update "):])
}

func (m *Manager) modifyPostgresColumn(ctx context.Context, pool *sql.DB, target string, oldCol model.ColumnInfo, col model.NewColumn) (model.MutationResult, error) {
	statements := make([]string, 0, 5)
	run := func(stmt string) error {
		if _, err := pool.ExecContext(ctx, stmt); err != nil {
			return err
		}
		statements = append(statements, stmt)
		return nil
	}

	current := oldCol.Name
	if col.Name != oldCol.Name {
		if err := run("ALTER TABLE " + target + " RENAME COLUMN " + quoteIdent(model.DriverPostgres, current) + " TO " + quoteIdent(model.DriverPostgres, col.Name)); err != nil {
			return model.MutationResult{}, err
		}
		current = col.Name
	}
	columnRef := quoteIdent(model.DriverPostgres, current)

	if !strings.EqualFold(strings.TrimSpace(oldCol.ColumnType), strings.TrimSpace(col.Type)) {
		if err := run("ALTER TABLE " + target + " ALTER COLUMN " + columnRef + " TYPE " + col.Type); err != nil {
			return model.MutationResult{}, err
		}
	}
	if col.Nullable != oldCol.Nullable {
		action := " SET NOT NULL"
		if col.Nullable {
			action = " DROP NOT NULL"
		}
		if err := run("ALTER TABLE " + target + " ALTER COLUMN " + columnRef + action); err != nil {
			return model.MutationResult{}, err
		}
	}

	wantDefault := ""
	if col.DefaultValue != nil {
		wantDefault = strings.TrimSpace(*col.DefaultValue)
	}
	oldDefault := ""
	if oldCol.DefaultValue != nil {
		oldDefault = strings.TrimSpace(*oldCol.DefaultValue)
	}
	if wantDefault != oldDefault {
		if wantDefault == "" {
			if err := run("ALTER TABLE " + target + " ALTER COLUMN " + columnRef + " DROP DEFAULT"); err != nil {
				return model.MutationResult{}, err
			}
		} else if err := run("ALTER TABLE " + target + " ALTER COLUMN " + columnRef + " SET DEFAULT " + wantDefault); err != nil {
			return model.MutationResult{}, err
		}
	}

	comment := strings.TrimSpace(col.Comment)
	if comment != strings.TrimSpace(oldCol.Comment) {
		value := "NULL"
		if comment != "" {
			value = sqlQuote(comment)
		}
		if err := run("COMMENT ON COLUMN " + target + "." + columnRef + " IS " + value); err != nil {
			return model.MutationResult{}, err
		}
	}
	if len(statements) == 0 {
		return model.MutationResult{}, fmt.Errorf("没有检测到需要修改的内容")
	}
	for i := range statements {
		statements[i] += ";"
	}
	return model.MutationResult{DDL: strings.Join(statements, "\n")}, nil
}

func (m *Manager) renameTable(ctx context.Context, conn model.Connection, pool *sql.DB, req model.AlterTableRequest) (model.MutationResult, error) {
	oldName := strings.TrimSpace(req.Table)
	newName := strings.TrimSpace(req.NewName)
	if err := validateIdentifier("原表名", oldName); err != nil {
		return model.MutationResult{}, err
	}
	if err := validateIdentifier("新表名", newName); err != nil {
		return model.MutationResult{}, err
	}
	if oldName == newName {
		return model.MutationResult{}, fmt.Errorf("新表名与原表名相同")
	}
	oldTarget := qualifiedTable(conn.Driver, req.Database, req.Schema, oldName)
	var stmt string
	switch conn.Driver {
	case model.DriverMySQL, model.DriverMariaDB:
		if strings.TrimSpace(req.Database) == "" {
			return model.MutationResult{}, fmt.Errorf("缺少数据库名")
		}
		stmt = "RENAME TABLE " + oldTarget + " TO " + quoteIdent(conn.Driver, req.Database) + "." + quoteIdent(conn.Driver, newName)
	case model.DriverSQLServer:
		schema := effectiveSchema(conn.Driver, req.Database, req.Schema)
		qualified := sqlServerQuotedObject(schema, oldName)
		stmt = "EXEC sp_rename N'" + escapeSQLString(qualified) + "', N'" + escapeSQLString(newName) + "'"
	default:
		stmt = "ALTER TABLE " + oldTarget + " RENAME TO " + quoteIdent(conn.Driver, newName)
	}
	if _, err := pool.ExecContext(ctx, stmt); err != nil {
		return model.MutationResult{}, err
	}
	return model.MutationResult{DDL: stmt + ";"}, nil
}

func (m *Manager) addForeignKey(ctx context.Context, conn model.Connection, pool *sql.DB, req model.AlterTableRequest, columnMap map[string]model.ColumnInfo, meta *model.TableMeta) (model.MutationResult, error) {
	if conn.Driver == model.DriverSQLite {
		return model.MutationResult{}, fmt.Errorf("SQLite 不支持通过 ALTER TABLE 添加外键；需要重建表")
	}
	fk := req.ForeignKey
	if fk == nil {
		return model.MutationResult{}, fmt.Errorf("缺少外键定义")
	}
	if len(fk.Columns) == 0 {
		return model.MutationResult{}, fmt.Errorf("至少选择一个本表列")
	}
	if len(fk.Columns) != len(fk.RefColumns) {
		return model.MutationResult{}, fmt.Errorf("本表列与引用列的数量必须一致")
	}
	name := strings.TrimSpace(fk.Name)
	if name == "" {
		name = "fk_" + req.Table + "_" + strings.Join(fk.Columns, "_")
		if runes := []rune(name); len(runes) > 60 {
			name = string(runes[:60])
		}
	}
	if err := validateIdentifier("外键名", name); err != nil {
		return model.MutationResult{}, err
	}
	for _, existing := range meta.ForeignKeys {
		if strings.EqualFold(existing.Name, name) {
			return model.MutationResult{}, fmt.Errorf("外键 %q 已存在", name)
		}
	}
	refTable := strings.TrimSpace(fk.RefTable)
	if err := validateIdentifier("引用表名", refTable); err != nil {
		return model.MutationResult{}, err
	}
	refSchema := strings.TrimSpace(fk.RefSchema)
	if refSchema == "" {
		if conn.Driver == model.DriverOracle {
			refSchema = oracleSchema(conn, req.Schema)
		} else {
			refSchema = effectiveSchema(conn.Driver, req.Database, req.Schema)
		}
	}
	if err := validateIdentifier("引用 Schema", refSchema); err != nil {
		return model.MutationResult{}, err
	}
	columns := make([]string, 0, len(fk.Columns))
	for _, column := range fk.Columns {
		column = strings.TrimSpace(column)
		if _, ok := columnMap[column]; !ok {
			return model.MutationResult{}, fmt.Errorf("本表列 %q 不存在", column)
		}
		columns = append(columns, quoteIdent(conn.Driver, column))
	}
	refColumns := make([]string, 0, len(fk.RefColumns))
	for _, column := range fk.RefColumns {
		column = strings.TrimSpace(column)
		if err := validateIdentifier("引用列名", column); err != nil {
			return model.MutationResult{}, err
		}
		refColumns = append(refColumns, quoteIdent(conn.Driver, column))
	}
	onDelete, err := normalizeForeignKeyAction(fk.OnDelete)
	if err != nil {
		return model.MutationResult{}, err
	}
	onUpdate, err := normalizeForeignKeyAction(fk.OnUpdate)
	if err != nil {
		return model.MutationResult{}, err
	}
	target := qualifiedTable(conn.Driver, req.Database, req.Schema, req.Table)
	ref := quoteIdent(conn.Driver, refSchema) + "." + quoteIdent(conn.Driver, refTable)
	stmt := "ALTER TABLE " + target + " ADD CONSTRAINT " + quoteIdent(conn.Driver, name) +
		" FOREIGN KEY (" + strings.Join(columns, ", ") + ") REFERENCES " + ref +
		" (" + strings.Join(refColumns, ", ") + ")"
	if conn.Driver != model.DriverSnowflake {
		stmt += " ON DELETE " + onDelete
		if conn.Driver != model.DriverOracle {
			stmt += " ON UPDATE " + onUpdate
		}
	}
	if _, err := pool.ExecContext(ctx, stmt); err != nil {
		return model.MutationResult{}, err
	}
	return model.MutationResult{DDL: stmt + ";"}, nil
}

func (m *Manager) dropForeignKey(ctx context.Context, conn model.Connection, pool *sql.DB, target string, meta *model.TableMeta, req model.AlterTableRequest) (model.MutationResult, error) {
	if conn.Driver == model.DriverSQLite {
		return model.MutationResult{}, fmt.Errorf("SQLite 不支持通过 ALTER TABLE 删除外键；需要重建表")
	}
	name := strings.TrimSpace(req.Name)
	if err := validateIdentifier("外键名", name); err != nil {
		return model.MutationResult{}, err
	}
	found := false
	for _, fk := range meta.ForeignKeys {
		if fk.Name == name {
			found = true
			break
		}
	}
	if !found {
		return model.MutationResult{}, fmt.Errorf("外键 %q 不存在", name)
	}
	var stmt string
	if conn.Driver == model.DriverMySQL {
		stmt = "ALTER TABLE " + target + " DROP FOREIGN KEY " + quoteIdent(conn.Driver, name)
	} else {
		stmt = "ALTER TABLE " + target + " DROP CONSTRAINT " + quoteIdent(conn.Driver, name)
	}
	if _, err := pool.ExecContext(ctx, stmt); err != nil {
		return model.MutationResult{}, err
	}
	return model.MutationResult{DDL: stmt + ";"}, nil
}

func normalizeForeignKeyAction(action string) (string, error) {
	normalized := strings.ToUpper(strings.Join(strings.Fields(action), " "))
	switch normalized {
	case "", "NO ACTION":
		return "NO ACTION", nil
	case "RESTRICT", "CASCADE", "SET NULL", "SET DEFAULT":
		return normalized, nil
	default:
		return "", fmt.Errorf("不支持的外键规则 %q", action)
	}
}

func uniqueWord(unique bool) string {
	if unique {
		return "UNIQUE "
	}
	return ""
}

func (m *Manager) CreateDatabase(ctx context.Context, conn model.Connection, password string, req model.CreateDatabaseRequest) (model.MutationResult, error) {
	if conn.ReadOnly {
		return model.MutationResult{}, fmt.Errorf("当前连接为只读模式")
	}
	if err := validateIdentifier("数据库名", req.Name); err != nil {
		return model.MutationResult{}, err
	}
	if req.Charset != "" && !safeToken.MatchString(req.Charset) {
		return model.MutationResult{}, fmt.Errorf("字符集格式不正确")
	}
	if req.Collation != "" && !safeToken.MatchString(req.Collation) {
		return model.MutationResult{}, fmt.Errorf("排序规则格式不正确")
	}
	switch conn.Driver {
	case model.DriverMySQL, model.DriverMariaDB:
		stmt := "CREATE DATABASE " + quoteIdent(conn.Driver, req.Name)
		if req.Charset != "" {
			stmt += " CHARACTER SET " + req.Charset
		}
		if req.Collation != "" {
			stmt += " COLLATE " + req.Collation
		}
		pool, err := m.serverPool(ctx, conn, password)
		if err != nil {
			return model.MutationResult{}, err
		}
		if _, err := pool.ExecContext(ctx, stmt); err != nil {
			return model.MutationResult{}, err
		}
		return model.MutationResult{DDL: stmt + ";"}, nil
	case model.DriverSQLServer:
		stmt := "CREATE DATABASE " + quoteIdent(conn.Driver, req.Name)
		if req.Collation != "" {
			stmt += " COLLATE " + req.Collation
		}
		pool, err := m.serverPool(ctx, conn, password)
		if err != nil {
			return model.MutationResult{}, err
		}
		if _, err := pool.ExecContext(ctx, stmt); err != nil {
			return model.MutationResult{}, err
		}
		return model.MutationResult{DDL: stmt + ";"}, nil
	case model.DriverSnowflake:
		stmt := "CREATE DATABASE " + quoteIdent(conn.Driver, req.Name)
		pool, err := m.serverPool(ctx, conn, password)
		if err != nil {
			return model.MutationResult{}, err
		}
		if _, err := pool.ExecContext(ctx, stmt); err != nil {
			return model.MutationResult{}, err
		}
		return model.MutationResult{DDL: stmt + ";"}, nil
	case model.DriverPostgres:
		pool, err := m.DB(ctx, conn, password, "postgres")
		if err != nil {
			pool, err = m.DB(ctx, conn, password, "template1")
			if err != nil {
				return model.MutationResult{}, err
			}
		}
		stmt := "CREATE DATABASE " + quoteIdent(conn.Driver, req.Name)
		if req.Charset != "" {
			stmt += " ENCODING " + sqlQuote(req.Charset)
		}
		if _, err := pool.ExecContext(ctx, stmt); err != nil {
			return model.MutationResult{}, err
		}
		return model.MutationResult{DDL: stmt + ";"}, nil
	default:
		return model.MutationResult{}, fmt.Errorf("当前数据库不支持通过此接口创建数据库（Oracle 请使用 DBA 工具）")
	}
}

func (m *Manager) DropDatabase(ctx context.Context, conn model.Connection, password, database string) (model.MutationResult, error) {
	if conn.ReadOnly {
		return model.MutationResult{}, fmt.Errorf("当前连接为只读模式")
	}
	if err := validateIdentifier("数据库名", database); err != nil {
		return model.MutationResult{}, err
	}
	switch conn.Driver {
	case model.DriverMySQL, model.DriverMariaDB:
		pool, err := m.serverPool(ctx, conn, password)
		if err != nil {
			return model.MutationResult{}, err
		}
		stmt := "DROP DATABASE " + quoteIdent(conn.Driver, database)
		if _, err := pool.ExecContext(ctx, stmt); err != nil {
			return model.MutationResult{}, err
		}
		m.CloseDatabasePools(conn.ID, database)
		return model.MutationResult{DDL: stmt + ";"}, nil
	case model.DriverSQLServer:
		m.CloseDatabasePools(conn.ID, database)
		pool, err := m.DB(ctx, conn, password, "master")
		if err != nil {
			return model.MutationResult{}, err
		}
		stmt := "DROP DATABASE " + quoteIdent(conn.Driver, database)
		if _, err := pool.ExecContext(ctx, stmt); err != nil {
			return model.MutationResult{}, err
		}
		return model.MutationResult{DDL: stmt + ";"}, nil
	case model.DriverSnowflake:
		m.CloseDatabasePools(conn.ID, database)
		pool, err := m.serverPool(ctx, conn, password)
		if err != nil {
			return model.MutationResult{}, err
		}
		stmt := "DROP DATABASE " + quoteIdent(conn.Driver, database)
		if _, err := pool.ExecContext(ctx, stmt); err != nil {
			return model.MutationResult{}, err
		}
		return model.MutationResult{DDL: stmt + ";"}, nil
	case model.DriverPostgres:
		adminDB := "postgres"
		if database == "postgres" {
			adminDB = "template1"
		}
		m.CloseDatabasePools(conn.ID, database)
		pool, err := m.DB(ctx, conn, password, adminDB)
		if err != nil {
			return model.MutationResult{}, err
		}
		stmt := "DROP DATABASE " + quoteIdent(conn.Driver, database)
		if _, err := pool.ExecContext(ctx, stmt); err != nil {
			return model.MutationResult{}, err
		}
		return model.MutationResult{DDL: stmt + ";"}, nil
	default:
		return model.MutationResult{}, fmt.Errorf("当前数据库不支持通过此接口删除数据库（Oracle 请使用 DBA 工具）")
	}
}

func (m *Manager) CloseDatabasePools(connID, database string) {
	key := poolKey(connID, database)
	m.mu.Lock()
	defer m.mu.Unlock()
	if pool, ok := m.pools[key]; ok {
		_ = pool.Close()
		delete(m.pools, key)
	}
}
