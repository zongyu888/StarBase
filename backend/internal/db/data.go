package db

import (
	"context"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"navideck/backend/internal/model"
)

func (m *Manager) TableRows(ctx context.Context, conn model.Connection, password, database, schema, table string, page, pageSize int, sortColumn, sortDir string, filters []model.Filter) (*model.RowsResponse, error) {
	if conn.Driver == model.DriverMongo {
		return m.mongoTableRows(ctx, conn, password, database, table, page, pageSize, sortColumn, sortDir, filters)
	}
	if conn.Driver == model.DriverRedis {
		return nil, fmt.Errorf("Redis 请使用键浏览器查看数据")
	}
	if conn.Driver == model.DriverChroma {
		return nil, fmt.Errorf("Chroma 请使用向量工作台查看集合文档")
	}
	meta, err := m.TableMeta(ctx, conn, password, database, schema, table)
	if err != nil {
		return nil, err
	}
	pool, err := m.DB(ctx, conn, password, database)
	if err != nil {
		return nil, err
	}
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 100
	}
	if pageSize > 1000 {
		pageSize = 1000
	}

	columnMap := make(map[string]model.ColumnInfo, len(meta.Columns))
	selectCols := make([]string, 0, len(meta.Columns))
	columnTypes := make([]string, 0, len(meta.Columns))
	for _, col := range meta.Columns {
		columnMap[col.Name] = col
		selectCols = append(selectCols, quoteIdent(conn.Driver, col.Name))
		columnTypes = append(columnTypes, col.DataType)
	}
	if len(selectCols) == 0 {
		return nil, fmt.Errorf("表没有可读取的列")
	}

	whereSQL, args, err := buildWhere(conn.Driver, filters, columnMap)
	if err != nil {
		return nil, err
	}

	countQuery := "SELECT COUNT(*) FROM " + qualifiedTable(conn.Driver, database, schema, table) + whereSQL
	var total int64
	if err := pool.QueryRowContext(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, err
	}

	orderSQL := ""
	if sortColumn != "" {
		col, ok := columnMap[sortColumn]
		if !ok {
			return nil, fmt.Errorf("排序字段 %q 不存在", sortColumn)
		}
		dir := "ASC"
		if strings.EqualFold(sortDir, "desc") {
			dir = "DESC"
		}
		orderSQL = " ORDER BY " + quoteIdent(conn.Driver, col.Name) + " " + dir
	} else if len(meta.PrimaryKey) > 0 {
		pkCols := make([]string, 0, len(meta.PrimaryKey))
		for _, pk := range meta.PrimaryKey {
			if _, ok := columnMap[pk]; ok {
				pkCols = append(pkCols, quoteIdent(conn.Driver, pk))
			}
		}
		if len(pkCols) > 0 {
			orderSQL = " ORDER BY " + strings.Join(pkCols, ", ") + " ASC"
		}
	}

	offset := (page - 1) * pageSize
	base := "SELECT " + strings.Join(selectCols, ", ") + " FROM " + qualifiedTable(conn.Driver, database, schema, table) + whereSQL
	var query string
	switch conn.Driver {
	case model.DriverSQLServer:
		if orderSQL == "" {
			orderSQL = " ORDER BY (SELECT NULL)"
		}
		query = base + orderSQL + " OFFSET " + strconv.Itoa(offset) + " ROWS FETCH NEXT " + strconv.Itoa(pageSize) + " ROWS ONLY"
	case model.DriverOracle:
		query = base + orderSQL + " OFFSET " + strconv.Itoa(offset) + " ROWS FETCH NEXT " + strconv.Itoa(pageSize) + " ROWS ONLY"
	default:
		query = base + orderSQL + " LIMIT " + strconv.Itoa(pageSize) + " OFFSET " + strconv.Itoa(offset)
	}
	rows, err := pool.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	resultRows, err := scanRows(rows, columnTypes)
	if err != nil {
		return nil, err
	}
	return &model.RowsResponse{
		Columns:     meta.Columns,
		Rows:        resultRows,
		Total:       total,
		Page:        page,
		PageSize:    pageSize,
		PrimaryKeys: meta.PrimaryKey,
		Editable:    meta.Editable,
	}, nil
}

func (m *Manager) ExportTableRows(ctx context.Context, conn model.Connection, password, database, schema, table string, limit int, sortColumn, sortDir string, filters []model.Filter) ([]string, [][]any, error) {
	if conn.Driver == model.DriverMongo {
		return m.mongoExportRows(ctx, conn, password, database, table, limit, sortColumn, sortDir, filters)
	}
	if conn.Driver == model.DriverRedis {
		return nil, nil, fmt.Errorf("Redis 不支持表导出")
	}
	meta, err := m.TableMeta(ctx, conn, password, database, schema, table)
	if err != nil {
		return nil, nil, err
	}
	pool, err := m.DB(ctx, conn, password, database)
	if err != nil {
		return nil, nil, err
	}
	if limit <= 0 || limit > 100000 {
		limit = 100000
	}
	cols := make([]string, 0, len(meta.Columns))
	names := make([]string, 0, len(meta.Columns))
	columnTypes := make([]string, 0, len(meta.Columns))
	columnMap := make(map[string]model.ColumnInfo, len(meta.Columns))
	for _, col := range meta.Columns {
		cols = append(cols, quoteIdent(conn.Driver, col.Name))
		names = append(names, col.Name)
		columnTypes = append(columnTypes, col.DataType)
		columnMap[col.Name] = col
	}
	whereSQL, args, err := buildWhere(conn.Driver, filters, columnMap)
	if err != nil {
		return nil, nil, err
	}
	order := ""
	if sortColumn != "" {
		col, ok := columnMap[sortColumn]
		if !ok {
			return nil, nil, fmt.Errorf("排序字段 %q 不存在", sortColumn)
		}
		dir := "ASC"
		if strings.EqualFold(sortDir, "desc") {
			dir = "DESC"
		}
		order = " ORDER BY " + quoteIdent(conn.Driver, col.Name) + " " + dir
	} else if len(meta.PrimaryKey) > 0 {
		pk := make([]string, 0, len(meta.PrimaryKey))
		for _, c := range meta.PrimaryKey {
			pk = append(pk, quoteIdent(conn.Driver, c))
		}
		order = " ORDER BY " + strings.Join(pk, ", ") + " ASC"
	}
	prefix := "SELECT "
	suffix := ""
	switch conn.Driver {
	case model.DriverSQLServer:
		prefix = "SELECT TOP (" + strconv.Itoa(limit) + ") "
	case model.DriverOracle:
		suffix = " FETCH FIRST " + strconv.Itoa(limit) + " ROWS ONLY"
	default:
		suffix = " LIMIT " + strconv.Itoa(limit)
	}
	query := prefix + strings.Join(cols, ", ") + " FROM " + qualifiedTable(conn.Driver, database, schema, table) +
		whereSQL + order + suffix
	rows, err := pool.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	result, err := scanRows(rows, columnTypes)
	if err != nil {
		return nil, nil, err
	}
	return names, result, nil
}

func buildWhere(driver string, filters []model.Filter, columns map[string]model.ColumnInfo) (string, []any, error) {
	var clauses []string
	var args []any
	for _, f := range filters {
		if strings.TrimSpace(f.Column) == "" {
			continue
		}
		col, ok := columns[f.Column]
		if !ok {
			return "", nil, fmt.Errorf("筛选字段 %q 不存在", f.Column)
		}
		quoted := quoteIdent(driver, col.Name)
		op := strings.ToLower(strings.TrimSpace(f.Operator))
		switch op {
		case "eq", "=":
			args = append(args, bindValue(driver, col, f.Value))
			clauses = append(clauses, quoted+" = "+placeholder(driver, col, len(args)))
		case "neq", "!=", "<>":
			args = append(args, bindValue(driver, col, f.Value))
			clauses = append(clauses, quoted+" <> "+placeholder(driver, col, len(args)))
		case "gt", ">":
			args = append(args, bindValue(driver, col, f.Value))
			clauses = append(clauses, quoted+" > "+placeholder(driver, col, len(args)))
		case "gte", ">=":
			args = append(args, bindValue(driver, col, f.Value))
			clauses = append(clauses, quoted+" >= "+placeholder(driver, col, len(args)))
		case "lt", "<":
			args = append(args, bindValue(driver, col, f.Value))
			clauses = append(clauses, quoted+" < "+placeholder(driver, col, len(args)))
		case "lte", "<=":
			args = append(args, bindValue(driver, col, f.Value))
			clauses = append(clauses, quoted+" <= "+placeholder(driver, col, len(args)))
		case "contains", "like":
			args = append(args, "%"+f.Value+"%")
			clauses = append(clauses, likeExpression(driver, quoted)+" LIKE "+plainPlaceholder(driver, len(args)))
		case "not_contains":
			args = append(args, "%"+f.Value+"%")
			clauses = append(clauses, likeExpression(driver, quoted)+" NOT LIKE "+plainPlaceholder(driver, len(args)))
		case "starts_with":
			args = append(args, f.Value+"%")
			clauses = append(clauses, likeExpression(driver, quoted)+" LIKE "+plainPlaceholder(driver, len(args)))
		case "ends_with":
			args = append(args, "%"+f.Value)
			clauses = append(clauses, likeExpression(driver, quoted)+" LIKE "+plainPlaceholder(driver, len(args)))
		case "is_null", "isnull":
			clauses = append(clauses, quoted+" IS NULL")
		case "is_not_null", "isnotnull":
			clauses = append(clauses, quoted+" IS NOT NULL")
		default:
			return "", nil, fmt.Errorf("不支持的筛选操作符 %q", f.Operator)
		}
	}
	if len(clauses) == 0 {
		return "", nil, nil
	}
	return " WHERE " + strings.Join(clauses, " AND "), args, nil
}

func likeExpression(driver, quotedCol string) string {
	switch driver {
	case model.DriverMySQL, model.DriverMariaDB:
		return "CAST(" + quotedCol + " AS CHAR)"
	case model.DriverSQLServer:
		return "CAST(" + quotedCol + " AS NVARCHAR(MAX))"
	case model.DriverOracle:
		return "TO_CHAR(" + quotedCol + ")"
	case model.DriverSnowflake:
		return "CAST(" + quotedCol + " AS VARCHAR)"
	default:
		return "CAST(" + quotedCol + " AS TEXT)"
	}
}

func placeholder(driver string, col model.ColumnInfo, index int) string {
	switch driver {
	case model.DriverPostgres:
		if cast := pgCastType(col); cast != "" {
			return fmt.Sprintf("$%d::text::%s", index, cast)
		}
		return fmt.Sprintf("$%d", index)
	case model.DriverSQLServer:
		return fmt.Sprintf("@p%d", index)
	case model.DriverOracle:
		return fmt.Sprintf(":%d", index)
	default:
		return "?"
	}
}

func plainPlaceholder(driver string, index int) string {
	switch driver {
	case model.DriverPostgres:
		return fmt.Sprintf("$%d", index)
	case model.DriverSQLServer:
		return fmt.Sprintf("@p%d", index)
	case model.DriverOracle:
		return fmt.Sprintf(":%d", index)
	default:
		return "?"
	}
}

func pgCastType(col model.ColumnInfo) string {
	t := strings.ToLower(strings.TrimSpace(col.ColumnType))
	if t == "" {
		t = strings.ToLower(col.DataType)
	}
	switch {
	case strings.Contains(t, "int"), strings.Contains(t, "serial"), t == "oid":
		return "int8"
	case strings.Contains(t, "numeric"), strings.Contains(t, "decimal"), strings.Contains(t, "money"):
		return "numeric"
	case strings.Contains(t, "double"), strings.Contains(t, "real"), strings.Contains(t, "float"):
		return "float8"
	case strings.Contains(t, "bool"):
		return "boolean"
	case strings.Contains(t, "timestamp with time zone"), t == "timestamptz":
		return "timestamptz"
	case strings.Contains(t, "timestamp"):
		return "timestamp"
	case strings.HasPrefix(t, "date"):
		return "date"
	case strings.HasPrefix(t, "time"):
		return "time"
	case strings.Contains(t, "jsonb"):
		return "jsonb"
	case strings.Contains(t, "json"):
		return "json"
	case strings.Contains(t, "uuid"):
		return "uuid"
	case strings.Contains(t, "bytea"):
		return "bytea"
	default:
		return ""
	}
}

func bindValue(driver string, col model.ColumnInfo, raw any) any {
	if raw == nil {
		return nil
	}
	if driver == model.DriverPostgres {
		switch v := raw.(type) {
		case string:
			return v
		case []byte:
			return string(v)
		default:
			return fmt.Sprint(v)
		}
	}
	kind := strings.ToLower(col.ColumnType)
	if kind == "" {
		kind = strings.ToLower(col.DataType)
	}
	s := fmt.Sprint(raw)
	if strings.Contains(kind, "bool") || kind == "bit" {
		switch strings.ToLower(strings.TrimSpace(s)) {
		case "true", "1", "yes", "on":
			return int64(1)
		case "false", "0", "no", "off":
			return int64(0)
		}
	}
	if strings.Contains(kind, "int") {
		if i, err := strconv.ParseInt(strings.TrimSpace(s), 10, 64); err == nil {
			return i
		}
		if f, err := strconv.ParseFloat(strings.TrimSpace(s), 64); err == nil && math.Trunc(f) == f {
			return int64(f)
		}
	}
	return s
}

func numericString(v any) (float64, error) {
	switch n := v.(type) {
	case float64:
		return n, nil
	case float32:
		return float64(n), nil
	case int:
		return float64(n), nil
	case int64:
		return float64(n), nil
	case json.Number:
		return n.Float64()
	case string:
		return strconv.ParseFloat(strings.TrimSpace(n), 64)
	default:
		return 0, fmt.Errorf("not numeric")
	}
}

func (m *Manager) InsertRow(ctx context.Context, conn model.Connection, password, database, schema, table string, values map[string]any) (model.MutationResult, error) {
	if conn.Driver == model.DriverMongo {
		return m.mongoInsertRow(ctx, conn, password, database, table, values)
	}
	if conn.ReadOnly {
		return model.MutationResult{}, fmt.Errorf("当前连接为只读模式")
	}
	meta, err := m.TableMeta(ctx, conn, password, database, schema, table)
	if err != nil {
		return model.MutationResult{}, err
	}
	if meta.Type != "table" {
		return model.MutationResult{}, fmt.Errorf("视图不支持写入")
	}
	query, args, err := insertStatement(conn.Driver, qualifiedTable(conn.Driver, database, schema, table), meta.Columns, values)
	if err != nil {
		return model.MutationResult{}, err
	}
	pool, err := m.DB(ctx, conn, password, database)
	if err != nil {
		return model.MutationResult{}, err
	}
	res, err := pool.ExecContext(ctx, query, args...)
	if err != nil {
		return model.MutationResult{}, err
	}
	affected, _ := res.RowsAffected()
	lastID, _ := res.LastInsertId()
	return model.MutationResult{AffectedRows: affected, LastInsertID: lastID}, nil
}

func (m *Manager) UpdateRow(ctx context.Context, conn model.Connection, password, database, schema, table string, keys, changes map[string]any) (model.MutationResult, error) {
	if conn.Driver == model.DriverMongo {
		return m.mongoUpdateRow(ctx, conn, password, database, table, keys, changes)
	}
	if conn.ReadOnly {
		return model.MutationResult{}, fmt.Errorf("当前连接为只读模式")
	}
	meta, err := m.TableMeta(ctx, conn, password, database, schema, table)
	if err != nil {
		return model.MutationResult{}, err
	}
	if meta.Type != "table" {
		return model.MutationResult{}, fmt.Errorf("视图不支持写入")
	}
	query, args, err := updateStatement(conn.Driver, qualifiedTable(conn.Driver, database, schema, table), meta.Columns, meta.PrimaryKey, keys, changes)
	if err != nil {
		return model.MutationResult{}, err
	}
	pool, err := m.DB(ctx, conn, password, database)
	if err != nil {
		return model.MutationResult{}, err
	}
	res, err := pool.ExecContext(ctx, query, args...)
	if err != nil {
		return model.MutationResult{}, err
	}
	affected, _ := res.RowsAffected()
	return model.MutationResult{AffectedRows: affected}, nil
}

func (m *Manager) DeleteRow(ctx context.Context, conn model.Connection, password, database, schema, table string, keys map[string]any) (model.MutationResult, error) {
	if conn.Driver == model.DriverMongo {
		return m.mongoDeleteRow(ctx, conn, password, database, table, keys)
	}
	if conn.ReadOnly {
		return model.MutationResult{}, fmt.Errorf("当前连接为只读模式")
	}
	meta, err := m.TableMeta(ctx, conn, password, database, schema, table)
	if err != nil {
		return model.MutationResult{}, err
	}
	if meta.Type != "table" {
		return model.MutationResult{}, fmt.Errorf("视图不支持删除")
	}
	query, args, err := deleteStatement(conn.Driver, qualifiedTable(conn.Driver, database, schema, table), meta.Columns, meta.PrimaryKey, keys)
	if err != nil {
		return model.MutationResult{}, err
	}
	pool, err := m.DB(ctx, conn, password, database)
	if err != nil {
		return model.MutationResult{}, err
	}
	res, err := pool.ExecContext(ctx, query, args...)
	if err != nil {
		return model.MutationResult{}, err
	}
	affected, _ := res.RowsAffected()
	return model.MutationResult{AffectedRows: affected}, nil
}

func (m *Manager) MutateTableRows(ctx context.Context, conn model.Connection, password, database, schema, table string, req model.BatchRowsRequest) (model.BatchRowsResult, error) {
	result := model.BatchRowsResult{
		Updated:  len(req.Updates),
		Inserted: len(req.Inserts),
		Deleted:  len(req.Deletes),
	}
	total := len(req.Updates) + len(req.Inserts) + len(req.Deletes)
	if total == 0 {
		return result, fmt.Errorf("没有需要保存的修改")
	}
	if total > 5000 {
		return model.BatchRowsResult{}, fmt.Errorf("单次最多保存 5000 处修改，请分批保存")
	}
	if conn.ReadOnly {
		return model.BatchRowsResult{}, fmt.Errorf("当前连接为只读模式")
	}
	if conn.Driver == model.DriverRedis {
		return model.BatchRowsResult{}, fmt.Errorf("Redis 不支持批量行编辑")
	}
	if conn.Driver == model.DriverMongo {
		for index, values := range req.Inserts {
			if _, err := m.mongoInsertRow(ctx, conn, password, database, table, values); err != nil {
				return model.BatchRowsResult{}, fmt.Errorf("第 %d 行新增失败: %w", index+1, err)
			}
		}
		for index, update := range req.Updates {
			if len(update.Keys) == 0 {
				return model.BatchRowsResult{}, fmt.Errorf("第 %d 行缺少 _id，无法更新", index+1)
			}
			if _, err := m.mongoUpdateRow(ctx, conn, password, database, table, update.Keys, update.Changes); err != nil {
				return model.BatchRowsResult{}, fmt.Errorf("第 %d 行更新失败: %w", index+1, err)
			}
		}
		for index, keys := range req.Deletes {
			if len(keys) == 0 {
				return model.BatchRowsResult{}, fmt.Errorf("第 %d 行缺少 _id，无法删除", index+1)
			}
			if _, err := m.mongoDeleteRow(ctx, conn, password, database, table, keys); err != nil {
				return model.BatchRowsResult{}, fmt.Errorf("第 %d 行删除失败: %w", index+1, err)
			}
		}
		return result, nil
	}

	meta, err := m.TableMeta(ctx, conn, password, database, schema, table)
	if err != nil {
		return model.BatchRowsResult{}, err
	}
	if meta.Type != "table" {
		return model.BatchRowsResult{}, fmt.Errorf("视图不支持写入")
	}
	if len(meta.PrimaryKey) == 0 && (len(req.Updates) > 0 || len(req.Deletes) > 0) {
		return model.BatchRowsResult{}, fmt.Errorf("该表没有主键，无法安全定位要修改的行")
	}
	pool, err := m.DB(ctx, conn, password, database)
	if err != nil {
		return model.BatchRowsResult{}, err
	}
	tx, err := pool.BeginTx(ctx, nil)
	if err != nil {
		return model.BatchRowsResult{}, err
	}
	defer func() { _ = tx.Rollback() }()
	target := qualifiedTable(conn.Driver, database, schema, table)
	exec := func(index int, action string, query string, args []any) error {
		if _, err := tx.ExecContext(ctx, query, args...); err != nil {
			return fmt.Errorf("%s第 %d 行失败: %w", action, index+1, err)
		}
		return nil
	}
	for index, update := range req.Updates {
		if len(update.Keys) == 0 {
			return model.BatchRowsResult{}, fmt.Errorf("更新第 %d 行缺少主键值", index+1)
		}
		query, args, buildErr := updateStatement(conn.Driver, target, meta.Columns, meta.PrimaryKey, update.Keys, update.Changes)
		if buildErr != nil {
			return model.BatchRowsResult{}, fmt.Errorf("更新第 %d 行失败: %w", index+1, buildErr)
		}
		if err := exec(index, "更新", query, args); err != nil {
			return model.BatchRowsResult{}, err
		}
	}
	for index, values := range req.Inserts {
		query, args, buildErr := insertStatement(conn.Driver, target, meta.Columns, values)
		if buildErr != nil {
			return model.BatchRowsResult{}, fmt.Errorf("新增第 %d 行失败: %w", index+1, buildErr)
		}
		if err := exec(index, "新增", query, args); err != nil {
			return model.BatchRowsResult{}, err
		}
	}
	for index, keys := range req.Deletes {
		if len(keys) == 0 {
			return model.BatchRowsResult{}, fmt.Errorf("删除第 %d 行缺少主键值", index+1)
		}
		query, args, buildErr := deleteStatement(conn.Driver, target, meta.Columns, meta.PrimaryKey, keys)
		if buildErr != nil {
			return model.BatchRowsResult{}, fmt.Errorf("删除第 %d 行失败: %w", index+1, buildErr)
		}
		if err := exec(index, "删除", query, args); err != nil {
			return model.BatchRowsResult{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return model.BatchRowsResult{}, err
	}
	return result, nil
}

func isAutoIncrementColumn(col model.ColumnInfo) bool {
	extra := strings.ToLower(col.Extra)
	return strings.Contains(extra, "auto_increment") || strings.Contains(extra, "identity")
}

func insertStatement(driver, target string, columns []model.ColumnInfo, values map[string]any) (string, []any, error) {
	var cols []string
	var marks []string
	var args []any
	for _, col := range columns {
		value, ok := values[col.Name]
		if !ok {
			continue
		}
		if col.Generated {
			return "", nil, fmt.Errorf("列 %q 为生成列，不能写入", col.Name)
		}
		if value == nil {
			if col.Nullable {
				cols = append(cols, quoteIdent(driver, col.Name))
				marks = append(marks, "NULL")
			}
			continue
		}
		if isAutoIncrementColumn(col) {
			continue
		}
		cols = append(cols, quoteIdent(driver, col.Name))
		args = append(args, paramValue(driver, value))
		marks = append(marks, placeholder(driver, col, len(args)))
	}
	if len(cols) == 0 {
		switch {
		case isMySQLFamily(driver):
			return "INSERT INTO " + target + " () VALUES ()", nil, nil
		case driver == model.DriverOracle, driver == model.DriverSnowflake:
			if len(columns) == 0 {
				return "", nil, fmt.Errorf("表没有可插入的列")
			}
			return "INSERT INTO " + target + " (" + quoteIdent(driver, columns[0].Name) + ") VALUES (DEFAULT)", nil, nil
		default:
			return "INSERT INTO " + target + " DEFAULT VALUES", nil, nil
		}
	}
	return "INSERT INTO " + target + " (" + strings.Join(cols, ", ") + ") VALUES (" + strings.Join(marks, ", ") + ")", args, nil
}

func updateStatement(driver, target string, columns []model.ColumnInfo, primaryKey []string, keys, changes map[string]any) (string, []any, error) {
	if len(primaryKey) == 0 {
		return "", nil, fmt.Errorf("该表没有主键，无法安全定位行")
	}
	columnMap := make(map[string]model.ColumnInfo, len(columns))
	for _, col := range columns {
		columnMap[col.Name] = col
	}
	var args []any
	var sets []string
	for _, col := range columns {
		value, ok := changes[col.Name]
		if !ok {
			continue
		}
		if col.Generated {
			return "", nil, fmt.Errorf("列 %q 为生成列，不能修改", col.Name)
		}
		if value == nil {
			sets = append(sets, quoteIdent(driver, col.Name)+" = NULL")
			continue
		}
		args = append(args, paramValue(driver, value))
		sets = append(sets, quoteIdent(driver, col.Name)+" = "+placeholder(driver, col, len(args)))
	}
	if len(sets) == 0 {
		return "", nil, fmt.Errorf("没有需要更新的字段")
	}
	var where []string
	for _, pk := range primaryKey {
		col, ok := columnMap[pk]
		if !ok {
			return "", nil, fmt.Errorf("主键字段 %q 不存在", pk)
		}
		value, ok := keys[pk]
		if !ok || value == nil {
			return "", nil, fmt.Errorf("缺少主键字段 %q 的值", pk)
		}
		args = append(args, paramValue(driver, value))
		where = append(where, quoteIdent(driver, col.Name)+" = "+placeholder(driver, col, len(args)))
	}
	return "UPDATE " + target + " SET " + strings.Join(sets, ", ") + " WHERE " + strings.Join(where, " AND "), args, nil
}

func deleteStatement(driver, target string, columns []model.ColumnInfo, primaryKey []string, keys map[string]any) (string, []any, error) {
	if len(primaryKey) == 0 {
		return "", nil, fmt.Errorf("该表没有主键，无法安全删除行")
	}
	columnMap := make(map[string]model.ColumnInfo, len(columns))
	for _, col := range columns {
		columnMap[col.Name] = col
	}
	var args []any
	var where []string
	for _, pk := range primaryKey {
		col, ok := columnMap[pk]
		if !ok {
			return "", nil, fmt.Errorf("主键字段 %q 不存在", pk)
		}
		value, ok := keys[pk]
		if !ok || value == nil {
			return "", nil, fmt.Errorf("缺少主键字段 %q 的值", pk)
		}
		args = append(args, paramValue(driver, value))
		where = append(where, quoteIdent(driver, col.Name)+" = "+placeholder(driver, col, len(args)))
	}
	return "DELETE FROM " + target + " WHERE " + strings.Join(where, " AND "), args, nil
}

func paramValue(driver string, value any) any {
	normalized := normalizeInputValue(value)
	if driver == model.DriverPostgres && normalized != nil {
		if text, ok := normalized.(string); ok {
			return text
		}
		return fmt.Sprint(normalized)
	}
	return normalized
}

func normalizeInputValue(v any) any {
	switch x := v.(type) {
	case float64:
		if math.Trunc(x) == x && math.Abs(x) < 9e15 {
			return int64(x)
		}
		return x
	case json.Number:
		if i, err := x.Int64(); err == nil {
			return i
		}
		if f, err := x.Float64(); err == nil {
			return f
		}
		return x.String()
	case map[string]any, []any:
		b, err := json.Marshal(x)
		if err != nil {
			return fmt.Sprint(x)
		}
		return string(b)
	default:
		return v
	}
}

func scanRows(rows *sql.Rows, typeNames []string) ([][]any, error) {
	cols, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	var out [][]any
	for rows.Next() {
		values := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range values {
			ptrs[i] = &values[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		line := make([]any, len(cols))
		for i, v := range values {
			typeName := ""
			if i < len(typeNames) {
				typeName = typeNames[i]
			}
			line[i] = normalizeValueForType(v, typeName)
		}
		out = append(out, line)
	}
	return out, rows.Err()
}

func normalizeValueForType(v any, typeName string) any {
	if bytes, ok := v.([]byte); ok && len(bytes) == 16 && strings.Contains(strings.ToLower(typeName), "uniqueidentifier") {
		return strings.ToUpper(fmt.Sprintf("%X-%X-%X-%X-%X", bytes[0:4], bytes[4:6], bytes[6:8], bytes[8:10], bytes[10:16]))
	}
	return normalizeValue(v)
}

func normalizeValue(v any) any {
	switch x := v.(type) {
	case nil:
		return nil
	case []byte:
		if utf8.Valid(x) {
			return string(x)
		}
		return "0x" + hex.EncodeToString(x)
	case time.Time:
		if x.Nanosecond() == 0 {
			return x.Format("2006-01-02 15:04:05")
		}
		return x.Format("2006-01-02 15:04:05.999999")
	case fmt.Stringer:
		return x.String()
	default:
		return v
	}
}
