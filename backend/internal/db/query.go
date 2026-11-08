package db

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"navideck/backend/internal/model"
)

func SplitStatementsForDriver(driver, input string) []string {
	switch driver {
	case model.DriverSQLServer:
		return SplitStatements(stripSQLServerBatchSeparators(input))
	case model.DriverOracle:
		trimmed := strings.TrimSpace(input)
		trimmed = strings.TrimSpace(strings.TrimSuffix(trimmed, "/"))
		keyword := leadingKeyword(trimmed)
		if keyword == "BEGIN" || keyword == "DECLARE" {
			return []string{trimmed}
		}
		return SplitStatements(input)
	default:
		return SplitStatements(input)
	}
}

func stripSQLServerBatchSeparators(input string) string {
	lines := strings.Split(input, "\n")
	out := make([]string, 0, len(lines))
	for _, line := range lines {
		if strings.EqualFold(strings.TrimSpace(line), "GO") {
			continue
		}
		out = append(out, line)
	}
	return strings.Join(out, "\n")
}

func SplitStatements(input string) []string {
	var out []string
	var b strings.Builder
	var single, double, backtick, lineComment, blockComment bool
	dollarTag := ""

	for i := 0; i < len(input); i++ {
		ch := input[i]
		if lineComment {
			b.WriteByte(ch)
			if ch == '\n' {
				lineComment = false
			}
			continue
		}
		if blockComment {
			b.WriteByte(ch)
			if ch == '*' && i+1 < len(input) && input[i+1] == '/' {
				b.WriteByte('/')
				i++
				blockComment = false
			}
			continue
		}
		if single {
			b.WriteByte(ch)
			if ch == '\\' && i+1 < len(input) {
				b.WriteByte(input[i+1])
				i++
				continue
			}
			if ch == '\'' {
				if i+1 < len(input) && input[i+1] == '\'' {
					b.WriteByte('\'')
					i++
					continue
				}
				single = false
			}
			continue
		}
		if double {
			b.WriteByte(ch)
			if ch == '"' {
				if i+1 < len(input) && input[i+1] == '"' {
					b.WriteByte('"')
					i++
					continue
				}
				double = false
			}
			continue
		}
		if backtick {
			b.WriteByte(ch)
			if ch == '`' {
				if i+1 < len(input) && input[i+1] == '`' {
					b.WriteByte('`')
					i++
					continue
				}
				backtick = false
			}
			continue
		}
		if dollarTag != "" {
			if strings.HasPrefix(input[i:], dollarTag) {
				b.WriteString(dollarTag)
				i += len(dollarTag) - 1
				dollarTag = ""
			} else {
				b.WriteByte(ch)
			}
			continue
		}

		switch {
		case ch == '-' && i+1 < len(input) && input[i+1] == '-':
			b.WriteString("--")
			i++
			lineComment = true
		case ch == '#':
			b.WriteByte(ch)
			lineComment = true
		case ch == '/' && i+1 < len(input) && input[i+1] == '*':
			b.WriteString("/*")
			i++
			blockComment = true
		case ch == '\'':
			b.WriteByte(ch)
			single = true
		case ch == '"':
			b.WriteByte(ch)
			double = true
		case ch == '`':
			b.WriteByte(ch)
			backtick = true
		case ch == '$':
			if tag := dollarTagAt(input, i); tag != "" {
				b.WriteString(tag)
				i += len(tag) - 1
				dollarTag = tag
			} else {
				b.WriteByte(ch)
			}
		case ch == ';':
			if stmt := strings.TrimSpace(b.String()); stmt != "" {
				out = append(out, stmt)
			}
			b.Reset()
		default:
			b.WriteByte(ch)
		}
	}
	if stmt := strings.TrimSpace(b.String()); stmt != "" {
		out = append(out, stmt)
	}
	return out
}

func dollarTagAt(s string, i int) string {
	j := i + 1
	for j < len(s) {
		c := s[j]
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' {
			j++
			continue
		}
		break
	}
	if j >= len(s) || s[j] != '$' {
		return ""
	}
	content := s[i+1 : j]
	if content != "" {
		first := content[0]
		if !((first >= 'a' && first <= 'z') || (first >= 'A' && first <= 'Z') || first == '_') {
			return ""
		}
	}
	return s[i : j+1]
}

func leadingKeyword(stmt string) string {
	i := 0
	for i < len(stmt) {
		for i < len(stmt) && (stmt[i] == ' ' || stmt[i] == '\t' || stmt[i] == '\r' || stmt[i] == '\n') {
			i++
		}
		if i+1 < len(stmt) && stmt[i] == '-' && stmt[i+1] == '-' {
			for i < len(stmt) && stmt[i] != '\n' {
				i++
			}
			continue
		}
		if i < len(stmt) && stmt[i] == '#' {
			for i < len(stmt) && stmt[i] != '\n' {
				i++
			}
			continue
		}
		if i+1 < len(stmt) && stmt[i] == '/' && stmt[i+1] == '*' {
			i += 2
			for i+1 < len(stmt) && !(stmt[i] == '*' && stmt[i+1] == '/') {
				i++
			}
			i += 2
			continue
		}
		break
	}
	start := i
	for i < len(stmt) {
		c := stmt[i]
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '_' {
			i++
			continue
		}
		break
	}
	return strings.ToUpper(stmt[start:i])
}

func isRowStatement(keyword, stmt string) bool {
	switch keyword {
	case "SELECT", "SHOW", "DESCRIBE", "DESC", "EXPLAIN", "PRAGMA", "VALUES", "TABLE", "WITH":
		return true
	}
	upper := strings.ToUpper(stmt)
	return strings.Contains(upper, " RETURNING ")
}

func isReadOnlyKeyword(keyword string) bool {
	switch keyword {
	case "SELECT", "SHOW", "DESCRIBE", "DESC", "EXPLAIN", "PRAGMA", "VALUES", "TABLE":
		return true
	default:
		return false
	}
}

type queryExecutor interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

func (m *Manager) ExecuteQuery(ctx context.Context, conn model.Connection, password, database, schema, sqlText string, maxRows int, readOnly bool) ([]model.QueryResult, error) {
	if conn.Driver == model.DriverMongo || conn.Driver == model.DriverRedis {
		return nil, fmt.Errorf("%s 不使用 SQL 查询", driverDisplayName(conn.Driver))
	}
	statements := SplitStatementsForDriver(conn.Driver, sqlText)
	if len(statements) == 0 {
		return nil, fmt.Errorf("没有可执行的 SQL 语句")
	}
	if maxRows <= 0 {
		maxRows = 500
	}
	if maxRows > 5000 {
		maxRows = 5000
	}
	pool, err := m.DB(ctx, conn, password, database)
	if err != nil {
		return nil, err
	}
	if conn.ReadOnly {
		readOnly = true
	}

	var runner queryExecutor = pool
	var dedicated *sql.Conn
	if conn.Driver == model.DriverPostgres && schema != "" && schema != "public" {
		dedicated, err = pool.Conn(ctx)
		if err != nil {
			return nil, err
		}
		setPath := "SET search_path TO " + quoteIdent(conn.Driver, schema) + ", public"
		if _, err := dedicated.ExecContext(ctx, setPath); err != nil {
			_ = dedicated.Close()
			return nil, err
		}
		defer func() {
			resetCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			_, _ = dedicated.ExecContext(resetCtx, "RESET search_path")
			cancel()
			_ = dedicated.Close()
		}()
		runner = dedicated
	}

	var results []model.QueryResult
	for i, stmt := range statements {
		result := model.QueryResult{
			Index:     i,
			Statement: stmt,
			Kind:      "exec",
		}
		start := time.Now()
		keyword := leadingKeyword(stmt)
		blockedInReadOnly := !isReadOnlyKeyword(keyword) ||
			(keyword == "EXPLAIN" && strings.Contains(strings.ToUpper(stmt), "ANALYZE"))
		if readOnly && blockedInReadOnly {
			result.DurationMs = time.Since(start).Milliseconds()
			result.Error = "当前连接为只读模式，已阻止可能修改数据的语句"
			results = append(results, result)
			break
		}

		stmtCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
		if isRowStatement(keyword, stmt) {
			queryErr := executeRows(stmtCtx, runner, stmt, maxRows, &result)
			if queryErr != nil {
				result.Error = queryErr.Error()
			}
			result.Kind = "rows"
		} else {
			res, execErr := runner.ExecContext(stmtCtx, stmt)
			if execErr != nil {
				result.Error = execErr.Error()
			} else {
				result.AffectedRows, _ = res.RowsAffected()
				result.LastInsertID, _ = res.LastInsertId()
			}
		}
		cancel()
		result.DurationMs = time.Since(start).Milliseconds()
		results = append(results, result)
		if result.Error != "" {
			break
		}
	}
	return results, nil
}

func executeRows(ctx context.Context, pool queryExecutor, stmt string, maxRows int, result *model.QueryResult) error {
	rows, err := pool.QueryContext(ctx, stmt)
	if err != nil {
		return err
	}
	defer rows.Close()
	cols, err := rows.Columns()
	if err != nil {
		return err
	}
	types, _ := rows.ColumnTypes()
	result.Columns = make([]model.ResultColumn, len(cols))
	for i, name := range cols {
		rc := model.ResultColumn{Name: name}
		if i < len(types) {
			rc.DatabaseType = types[i].DatabaseTypeName()
			if st := types[i].ScanType(); st != nil {
				rc.ScanType = st.String()
			}
			if nullable, ok := types[i].Nullable(); ok {
				rc.Nullable = nullable
			}
		}
		result.Columns[i] = rc
	}
	result.Rows = make([][]any, 0, min(maxRows, 128))
	for rows.Next() {
		if len(result.Rows) >= maxRows {
			result.Truncated = true
			break
		}
		values := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range values {
			ptrs[i] = &values[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return err
		}
		line := make([]any, len(cols))
		for i, v := range values {
			typeName := ""
			if i < len(types) {
				typeName = types[i].DatabaseTypeName()
			}
			line[i] = normalizeValueForType(v, typeName)
		}
		result.Rows = append(result.Rows, line)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	result.RowCount = len(result.Rows)
	return nil
}
