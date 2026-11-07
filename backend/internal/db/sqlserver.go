package db

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"navideck/backend/internal/model"
)

func sqlServerColumns(ctx context.Context, pool *sql.DB, schema, table string) ([]model.ColumnInfo, error) {
	object := quoteIdent(model.DriverSQLServer, schema) + "." + quoteIdent(model.DriverSQLServer, table)
	const q = `
SELECT c.name,
       LOWER(t.name),
       LOWER(t.name) + CASE
         WHEN t.name IN ('varchar', 'char', 'varbinary', 'binary') AND c.max_length = -1 THEN '(max)'
         WHEN t.name IN ('varchar', 'char', 'varbinary', 'binary') THEN '(' + CAST(c.max_length AS VARCHAR(10)) + ')'
         WHEN t.name IN ('nvarchar', 'nchar') AND c.max_length = -1 THEN '(max)'
         WHEN t.name IN ('nvarchar', 'nchar') THEN '(' + CAST(c.max_length / 2 AS VARCHAR(10)) + ')'
         WHEN t.name IN ('decimal', 'numeric') THEN '(' + CAST(c.precision AS VARCHAR(10)) + ',' + CAST(c.scale AS VARCHAR(10)) + ')'
         WHEN t.name IN ('datetime2', 'time', 'datetimeoffset') THEN '(' + CAST(c.scale AS VARCHAR(10)) + ')'
         ELSE ''
       END,
       c.is_nullable,
       dc.definition,
       c.is_identity,
       c.is_computed,
       cc.definition,
       c.column_id,
       c.max_length,
       c.precision,
       c.scale,
       COALESCE(CAST(ep.value AS NVARCHAR(MAX)), '')
FROM sys.columns c
JOIN sys.types t ON t.user_type_id = c.user_type_id
LEFT JOIN sys.default_constraints dc ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
LEFT JOIN sys.computed_columns cc ON cc.object_id = c.object_id AND cc.column_id = c.column_id
LEFT JOIN sys.extended_properties ep ON ep.major_id = c.object_id AND ep.minor_id = c.column_id AND ep.name = 'MS_Description'
WHERE c.object_id = OBJECT_ID(@p1)
ORDER BY c.column_id`
	rows, err := pool.QueryContext(ctx, q, object)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.ColumnInfo
	for rows.Next() {
		var c model.ColumnInfo
		var def, computed sql.NullString
		var identity, isComputed bool
		if err := rows.Scan(
			&c.Name, &c.DataType, &c.ColumnType, &c.Nullable, &def,
			&identity, &isComputed, &computed, &c.Position, &c.Length, &c.Precision, &c.Scale, &c.Comment,
		); err != nil {
			return nil, err
		}
		if def.Valid {
			v := def.String
			c.DefaultValue = &v
		}
		if computed.Valid {
			v := computed.String
			c.DefaultValue = &v
		}
		c.Generated = isComputed
		switch {
		case isComputed:
			c.Extra = "generated"
		case identity:
			c.Extra = "identity"
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func sqlServerIndexes(ctx context.Context, pool *sql.DB, schema, table string) ([]model.IndexInfo, error) {
	object := quoteIdent(model.DriverSQLServer, schema) + "." + quoteIdent(model.DriverSQLServer, table)
	const q = `
SELECT i.name, i.is_unique, i.is_primary_key, i.type_desc, c.name
FROM sys.indexes i
JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0
JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
WHERE i.object_id = OBJECT_ID(@p1) AND i.name IS NOT NULL AND ic.key_ordinal > 0
ORDER BY i.is_primary_key DESC, i.name, ic.key_ordinal`
	rows, err := pool.QueryContext(ctx, q, object)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	indexes := map[string]*model.IndexInfo{}
	order := []string{}
	for rows.Next() {
		var name, typ, column string
		var unique, primary bool
		if err := rows.Scan(&name, &unique, &primary, &typ, &column); err != nil {
			return nil, err
		}
		idx, ok := indexes[name]
		if !ok {
			idx = &model.IndexInfo{Name: name, Unique: unique, Primary: primary, Type: strings.ToLower(typ)}
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

func sqlServerForeignKeys(ctx context.Context, pool *sql.DB, schema, table string) ([]model.ForeignKeyInfo, error) {
	object := quoteIdent(model.DriverSQLServer, schema) + "." + quoteIdent(model.DriverSQLServer, table)
	const q = `
SELECT fk.name, pc.name, rs.name, rt.name, rc.name,
       fk.delete_referential_action_desc, fk.update_referential_action_desc
FROM sys.foreign_keys fk
JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
JOIN sys.objects rt ON rt.object_id = fk.referenced_object_id
JOIN sys.schemas rs ON rs.schema_id = rt.schema_id
JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
WHERE fk.parent_object_id = OBJECT_ID(@p1)
ORDER BY fk.name, fkc.constraint_column_id`
	rows, err := pool.QueryContext(ctx, q, object)
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
			fk = &model.ForeignKeyInfo{
				Name:      name,
				RefSchema: refSchema,
				RefTable:  refTable,
				OnDelete:  strings.ReplaceAll(onDelete, "_", " "),
				OnUpdate:  strings.ReplaceAll(onUpdate, "_", " "),
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

func sqlServerDDL(schema, table string, meta *model.TableMeta) string {
	var b strings.Builder
	b.WriteString("CREATE TABLE ")
	b.WriteString(quoteIdent(model.DriverSQLServer, schema))
	b.WriteString(".")
	b.WriteString(quoteIdent(model.DriverSQLServer, table))
	b.WriteString(" (\n")
	lines := make([]string, 0, len(meta.Columns)+len(meta.ForeignKeys)+1)
	for _, col := range meta.Columns {
		var line strings.Builder
		line.WriteString("  ")
		line.WriteString(quoteIdent(model.DriverSQLServer, col.Name))
		line.WriteString(" ")
		line.WriteString(col.ColumnType)
		if col.Generated {
			expression := ""
			if col.DefaultValue != nil {
				expression = strings.TrimSpace(*col.DefaultValue)
			}
			if expression != "" {
				line.WriteString(" AS (")
				line.WriteString(expression)
				line.WriteString(")")
			}
		} else {
			if strings.Contains(strings.ToLower(col.Extra), "identity") {
				line.WriteString(" IDENTITY(1,1)")
			}
			if col.DefaultValue != nil && strings.TrimSpace(*col.DefaultValue) != "" {
				line.WriteString(" DEFAULT ")
				line.WriteString(strings.TrimSpace(*col.DefaultValue))
			}
			if col.Nullable {
				line.WriteString(" NULL")
			} else {
				line.WriteString(" NOT NULL")
			}
		}
		lines = append(lines, line.String())
	}
	for _, idx := range meta.Indexes {
		if !idx.Primary || len(idx.Columns) == 0 {
			continue
		}
		cols := make([]string, 0, len(idx.Columns))
		for _, c := range idx.Columns {
			cols = append(cols, quoteIdent(model.DriverSQLServer, c))
		}
		lines = append(lines, "  CONSTRAINT "+quoteIdent(model.DriverSQLServer, idx.Name)+" PRIMARY KEY ("+strings.Join(cols, ", ")+")")
		break
	}
	for _, fk := range meta.ForeignKeys {
		cols := make([]string, 0, len(fk.Columns))
		for _, c := range fk.Columns {
			cols = append(cols, quoteIdent(model.DriverSQLServer, c))
		}
		refCols := make([]string, 0, len(fk.RefColumns))
		for _, c := range fk.RefColumns {
			refCols = append(refCols, quoteIdent(model.DriverSQLServer, c))
		}
		refSchema := fk.RefSchema
		if refSchema == "" {
			refSchema = schema
		}
		lines = append(lines, "  CONSTRAINT "+quoteIdent(model.DriverSQLServer, fk.Name)+" FOREIGN KEY ("+strings.Join(cols, ", ")+") REFERENCES "+
			quoteIdent(model.DriverSQLServer, refSchema)+"."+quoteIdent(model.DriverSQLServer, fk.RefTable)+" ("+strings.Join(refCols, ", ")+")"+
			fkActionClause(fk.OnDelete, "ON DELETE")+fkActionClause(fk.OnUpdate, "ON UPDATE"))
	}
	b.WriteString(strings.Join(lines, ",\n"))
	b.WriteString("\n);\n")
	for _, idx := range meta.Indexes {
		if idx.Primary || len(idx.Columns) == 0 {
			continue
		}
		cols := make([]string, 0, len(idx.Columns))
		for _, c := range idx.Columns {
			cols = append(cols, quoteIdent(model.DriverSQLServer, c))
		}
		b.WriteString("CREATE ")
		if idx.Unique {
			b.WriteString("UNIQUE ")
		}
		b.WriteString("INDEX ")
		b.WriteString(quoteIdent(model.DriverSQLServer, idx.Name))
		b.WriteString(" ON ")
		b.WriteString(quoteIdent(model.DriverSQLServer, schema))
		b.WriteString(".")
		b.WriteString(quoteIdent(model.DriverSQLServer, table))
		b.WriteString(" (")
		b.WriteString(strings.Join(cols, ", "))
		b.WriteString(");\n")
	}
	if meta.Comment != "" {
		b.WriteString("EXEC sys.sp_addextendedproperty @name=N'MS_Description', @value=N'")
		b.WriteString(escapeSQLString(meta.Comment))
		b.WriteString("', @level0type=N'SCHEMA', @level0name=N'")
		b.WriteString(escapeSQLString(schema))
		b.WriteString("', @level1type=N'TABLE', @level1name=N'")
		b.WriteString(escapeSQLString(table))
		b.WriteString("';\n")
	}
	for _, col := range meta.Columns {
		if col.Comment == "" {
			continue
		}
		b.WriteString("EXEC sys.sp_addextendedproperty @name=N'MS_Description', @value=N'")
		b.WriteString(escapeSQLString(col.Comment))
		b.WriteString("', @level0type=N'SCHEMA', @level0name=N'")
		b.WriteString(escapeSQLString(schema))
		b.WriteString("', @level1type=N'TABLE', @level1name=N'")
		b.WriteString(escapeSQLString(table))
		b.WriteString("', @level2type=N'COLUMN', @level2name=N'")
		b.WriteString(escapeSQLString(col.Name))
		b.WriteString("';\n")
	}
	return b.String()
}

func escapeSQLString(value string) string {
	return strings.ReplaceAll(value, "'", "''")
}

func sqlServerCommentStatement(schema, table, column, comment string) string {
	stmt := "EXEC sys.sp_addextendedproperty @name=N'MS_Description', @value=N'" + escapeSQLString(comment) +
		"', @level0type=N'SCHEMA', @level0name=N'" + escapeSQLString(schema) +
		"', @level1type=N'TABLE', @level1name=N'" + escapeSQLString(table) + "'"
	if column != "" {
		stmt += ", @level2type=N'COLUMN', @level2name=N'" + escapeSQLString(column) + "'"
	}
	return stmt + ";"
}

func (m *Manager) setSQLServerComment(ctx context.Context, pool *sql.DB, schema, table, column, comment string) (string, error) {
	existsQuery := `
SELECT COUNT(*) FROM sys.extended_properties ep
JOIN sys.objects o ON o.object_id = ep.major_id
JOIN sys.schemas s ON s.schema_id = o.schema_id
WHERE ep.name = 'MS_Description' AND ep.minor_id = 0 AND s.name = @p1 AND o.name = @p2`
	args := []any{schema, table}
	if column != "" {
		existsQuery = `
SELECT COUNT(*) FROM sys.extended_properties ep
JOIN sys.objects o ON o.object_id = ep.major_id
JOIN sys.schemas s ON s.schema_id = o.schema_id
WHERE ep.name = 'MS_Description' AND ep.minor_id = COLUMNPROPERTY(o.object_id, @p3, 'ColumnId')
  AND s.name = @p1 AND o.name = @p2`
		args = append(args, column)
	}
	var count int
	if err := pool.QueryRowContext(ctx, existsQuery, args...).Scan(&count); err != nil {
		return "", err
	}

	var stmt string
	switch {
	case comment == "" && count > 0:
		stmt = "EXEC sys.sp_dropextendedproperty @name=N'MS_Description', @level0type=N'SCHEMA', @level0name=N'" +
			escapeSQLString(schema) + "', @level1type=N'TABLE', @level1name=N'" + escapeSQLString(table) + "'"
		if column != "" {
			stmt += ", @level2type=N'COLUMN', @level2name=N'" + escapeSQLString(column) + "'"
		}
		stmt += ";"
	case comment == "":
		return "", nil
	case count > 0:
		stmt = "EXEC sys.sp_updateextendedproperty @name=N'MS_Description', @value=N'" + escapeSQLString(comment) +
			"', @level0type=N'SCHEMA', @level0name=N'" + escapeSQLString(schema) +
			"', @level1type=N'TABLE', @level1name=N'" + escapeSQLString(table) + "'"
		if column != "" {
			stmt += ", @level2type=N'COLUMN', @level2name=N'" + escapeSQLString(column) + "'"
		}
		stmt += ";"
	default:
		stmt = sqlServerCommentStatement(schema, table, column, comment)
	}
	if _, err := pool.ExecContext(ctx, stmt); err != nil {
		return "", err
	}
	return stmt, nil
}

func sqlServerQuotedObject(schema, table string) string {
	return fmt.Sprintf("%s.%s", quoteIdent(model.DriverSQLServer, schema), quoteIdent(model.DriverSQLServer, table))
}
