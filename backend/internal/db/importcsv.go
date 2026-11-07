package db

import (
	"context"
	"database/sql"
	"encoding/csv"
	"fmt"
	"io"
	"strings"

	"navideck/backend/internal/model"
)

const maxImportRows = 50000

type importSource struct {
	csvIndex int
	column   model.ColumnInfo
	identity bool
}

func (m *Manager) ImportCSV(ctx context.Context, conn model.Connection, password, database, schema, table, csvText string, options model.CSVImportOptions) (int, error) {
	if conn.Driver == model.DriverMongo || conn.Driver == model.DriverRedis {
		return 0, fmt.Errorf("%s 不支持 CSV 导入", driverDisplayName(conn.Driver))
	}
	if conn.ReadOnly {
		return 0, fmt.Errorf("当前连接为只读模式")
	}
	meta, err := m.TableMeta(ctx, conn, password, database, schema, table)
	if err != nil {
		return 0, err
	}
	if meta.Type != "table" {
		return 0, fmt.Errorf("视图不支持导入数据")
	}

	reader := csv.NewReader(strings.NewReader(strings.TrimPrefix(csvText, "\uFEFF")))
	reader.TrimLeadingSpace = true
	reader.FieldsPerRecord = -1
	if options.Delimiter != "" {
		runes := []rune(options.Delimiter)
		if len(runes) != 1 {
			return 0, fmt.Errorf("分隔符必须是单个字符")
		}
		switch runes[0] {
		case '"', '\r', '\n', 0:
			return 0, fmt.Errorf("分隔符不能是引号或换行符")
		}
		reader.Comma = runes[0]
	}

	header, err := reader.Read()
	if err == io.EOF {
		return 0, fmt.Errorf("CSV 文件为空")
	}
	if err != nil {
		return 0, fmt.Errorf("解析 CSV 表头失败: %w", err)
	}
	for i := range header {
		header[i] = strings.TrimSpace(strings.TrimPrefix(header[i], "\uFEFF"))
	}
	if len(header) == 0 {
		return 0, fmt.Errorf("CSV 缺少表头")
	}
	reader.FieldsPerRecord = len(header)

	byName := make(map[string]model.ColumnInfo, len(meta.Columns))
	for _, col := range meta.Columns {
		byName[strings.ToLower(col.Name)] = col
	}
	seenHeader := make(map[string]bool, len(header))
	for _, name := range header {
		if name == "" {
			return 0, fmt.Errorf("CSV 中存在空列名")
		}
		key := strings.ToLower(name)
		if seenHeader[key] {
			return 0, fmt.Errorf("CSV 表头中的列 %q 重复", name)
		}
		seenHeader[key] = true
	}

	sources, err := resolveImportSources(header, byName, options.Mapping)
	if err != nil {
		return 0, err
	}

	quotedCols := make([]string, 0, len(sources))
	marks := make([]string, 0, len(sources))
	defaultCols := make([]string, 0, len(sources))
	defaultMarks := make([]string, 0, len(sources))
	for _, source := range sources {
		quoted := quoteIdent(conn.Driver, source.column.Name)
		quotedCols = append(quotedCols, quoted)
		marks = append(marks, placeholder(conn.Driver, source.column, len(marks)+1))
		if source.identity {
			continue
		}
		defaultCols = append(defaultCols, quoted)
		defaultMarks = append(defaultMarks, placeholder(conn.Driver, source.column, len(defaultMarks)+1))
	}
	target := qualifiedTable(conn.Driver, database, schema, table)
	fullQuery := "INSERT INTO " + target + " (" + strings.Join(quotedCols, ", ") + ") VALUES (" + strings.Join(marks, ", ") + ")"
	defaultQuery := ""
	if len(defaultCols) == 0 {
		switch {
		case isMySQLFamily(conn.Driver):
			defaultQuery = "INSERT INTO " + target + " () VALUES ()"
		case conn.Driver == model.DriverOracle, conn.Driver == model.DriverSnowflake:
			if len(meta.Columns) == 0 {
				return 0, fmt.Errorf("表没有可插入的列")
			}
			defaultQuery = "INSERT INTO " + target + " (" + quoteIdent(conn.Driver, meta.Columns[0].Name) + ") VALUES (DEFAULT)"
		default:
			defaultQuery = "INSERT INTO " + target + " DEFAULT VALUES"
		}
	} else {
		defaultQuery = "INSERT INTO " + target + " (" + strings.Join(defaultCols, ", ") + ") VALUES (" + strings.Join(defaultMarks, ", ") + ")"
	}

	pool, err := m.DB(ctx, conn, password, database)
	if err != nil {
		return 0, err
	}
	tx, err := pool.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	fullStmt, err := tx.PrepareContext(ctx, fullQuery)
	if err != nil {
		return 0, err
	}
	defer fullStmt.Close()
	var defaultStmt *sql.Stmt
	if len(sources) > 0 {
		defaultStmt, err = tx.PrepareContext(ctx, defaultQuery)
		if err != nil {
			return 0, err
		}
		defer defaultStmt.Close()
	}

	imported := 0
	for {
		record, readErr := reader.Read()
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return 0, fmt.Errorf("读取第 %d 行失败: %w", imported+2, readErr)
		}
		if imported >= maxImportRows {
			return 0, fmt.Errorf("单次最多导入 %d 行，已回滚全部数据", maxImportRows)
		}
		fullArgs := make([]any, 0, len(sources))
		defaultArgs := make([]any, 0, len(sources))
		omitIdentity := false
		for _, source := range sources {
			value := importCellValue(record[source.csvIndex], options)
			if source.identity && value == nil {
				omitIdentity = true
				continue
			}
			fullArgs = append(fullArgs, value)
			if !source.identity {
				defaultArgs = append(defaultArgs, value)
			}
		}
		var execErr error
		if omitIdentity && defaultStmt != nil {
			_, execErr = defaultStmt.ExecContext(ctx, defaultArgs...)
		} else {
			_, execErr = fullStmt.ExecContext(ctx, fullArgs...)
		}
		if execErr != nil {
			return 0, fmt.Errorf("导入第 %d 行失败: %w", imported+2, execErr)
		}
		imported++
	}
	if imported == 0 {
		return 0, fmt.Errorf("CSV 中没有数据行")
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return imported, nil
}

func resolveImportSources(header []string, byName map[string]model.ColumnInfo, mapping []model.ImportMapping) ([]importSource, error) {
	seenTarget := make(map[string]bool)
	sources := make([]importSource, 0, len(header))

	if len(mapping) == 0 {
		for index, name := range header {
			column, ok := byName[strings.ToLower(name)]
			if !ok {
				return nil, fmt.Errorf("CSV 列 %q 在表中不存在，请为它选择目标列或忽略", name)
			}
			source, err := newImportSource(index, column, seenTarget)
			if err != nil {
				return nil, err
			}
			sources = append(sources, source)
		}
		if len(sources) == 0 {
			return nil, fmt.Errorf("CSV 中没有可导入的列")
		}
		return sources, nil
	}

	headerIndex := make(map[string]int, len(header))
	for index, name := range header {
		headerIndex[strings.ToLower(name)] = index
	}
	byCSV := make(map[string]model.ImportMapping, len(mapping))
	for _, item := range mapping {
		key := strings.ToLower(strings.TrimSpace(item.CSVColumn))
		if key == "" {
			return nil, fmt.Errorf("列映射中存在空的 CSV 列名")
		}
		if _, ok := headerIndex[key]; !ok {
			return nil, fmt.Errorf("列映射引用了不存在的 CSV 列 %q", item.CSVColumn)
		}
		byCSV[key] = item
	}
	for _, name := range header {
		item, ok := byCSV[strings.ToLower(name)]
		if !ok {
			continue
		}
		target := strings.TrimSpace(item.TableColumn)
		if target == "" || target == "-" {
			continue
		}
		column, ok := byName[strings.ToLower(target)]
		if !ok {
			return nil, fmt.Errorf("CSV 列 %q 映射到的表列 %q 不存在", name, target)
		}
		source, err := newImportSource(headerIndex[strings.ToLower(name)], column, seenTarget)
		if err != nil {
			return nil, err
		}
		sources = append(sources, source)
	}
	if len(sources) == 0 {
		return nil, fmt.Errorf("请至少为 CSV 选择一列目标列")
	}
	return sources, nil
}

func newImportSource(csvIndex int, column model.ColumnInfo, seen map[string]bool) (importSource, error) {
	if column.Generated {
		return importSource{}, fmt.Errorf("列 %q 为生成列，不能导入", column.Name)
	}
	if seen[column.Name] {
		return importSource{}, fmt.Errorf("表列 %q 被多个 CSV 列映射", column.Name)
	}
	seen[column.Name] = true
	extra := strings.ToLower(column.Extra)
	return importSource{
		csvIndex: csvIndex,
		column:   column,
		identity: strings.Contains(extra, "auto_increment") || strings.Contains(extra, "identity"),
	}, nil
}

func importCellValue(cell string, options model.CSVImportOptions) any {
	if options.EmptyAsNull && cell == "" {
		return nil
	}
	if options.NullValue != "" && cell == options.NullValue {
		return nil
	}
	return cell
}
