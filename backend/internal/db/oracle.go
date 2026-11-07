package db

import (
	"context"
	"database/sql"
	"strings"

	"navideck/backend/internal/model"
)

func oracleColumns(ctx context.Context, pool *sql.DB, schema, table string) ([]model.ColumnInfo, error) {
	const q = `
SELECT c.COLUMN_NAME,
       LOWER(c.DATA_TYPE),
       CASE
         WHEN c.DATA_TYPE IN ('VARCHAR2', 'NVARCHAR2', 'CHAR', 'NCHAR', 'RAW') THEN c.DATA_TYPE || '(' || c.DATA_LENGTH || ')'
         WHEN c.DATA_TYPE = 'NUMBER' AND c.DATA_PRECISION IS NOT NULL AND c.DATA_SCALE IS NOT NULL THEN 'NUMBER(' || c.DATA_PRECISION || ',' || c.DATA_SCALE || ')'
         WHEN c.DATA_TYPE = 'NUMBER' AND c.DATA_PRECISION IS NOT NULL THEN 'NUMBER(' || c.DATA_PRECISION || ')'
         WHEN c.DATA_TYPE IN ('FLOAT') AND c.DATA_PRECISION IS NOT NULL THEN 'FLOAT(' || c.DATA_PRECISION || ')'
         ELSE c.DATA_TYPE
       END,
       CASE WHEN c.NULLABLE = 'Y' THEN 1 ELSE 0 END,
       c.DATA_DEFAULT,
       c.COLUMN_ID,
       CASE WHEN c.IDENTITY_COLUMN = 'YES' THEN 1 ELSE 0 END,
       CASE WHEN c.VIRTUAL_COLUMN = 'YES' THEN 1 ELSE 0 END,
       NVL(cmt.COMMENTS, '')
FROM all_tab_columns c
LEFT JOIN all_col_comments cmt ON cmt.OWNER = c.OWNER AND cmt.TABLE_NAME = c.TABLE_NAME AND cmt.COLUMN_NAME = c.COLUMN_NAME
WHERE c.OWNER = :1 AND c.TABLE_NAME = :2
ORDER BY c.COLUMN_ID`
	rows, err := pool.QueryContext(ctx, q, schema, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.ColumnInfo
	for rows.Next() {
		var c model.ColumnInfo
		var defaultValue sql.NullString
		var nullable, identity, virtual int
		if err := rows.Scan(&c.Name, &c.DataType, &c.ColumnType, &nullable, &defaultValue, &c.Position, &identity, &virtual, &c.Comment); err != nil {
			return nil, err
		}
		c.Nullable = nullable == 1
		if defaultValue.Valid {
			value := strings.TrimSpace(defaultValue.String)
			c.DefaultValue = &value
		}
		c.Generated = virtual == 1
		switch {
		case c.Generated:
			c.Extra = "generated"
		case identity == 1:
			c.Extra = "identity"
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func oracleIndexes(ctx context.Context, pool *sql.DB, schema, table string) ([]model.IndexInfo, error) {
	const q = `
SELECT i.INDEX_NAME,
       i.UNIQUENESS,
       i.INDEX_TYPE,
       COALESCE(c.COLUMN_NAME, '(表达式)'),
       CASE WHEN i.INDEX_NAME = (
         SELECT k.CONSTRAINT_NAME FROM all_constraints k
         WHERE k.OWNER = i.TABLE_OWNER AND k.TABLE_NAME = i.TABLE_NAME
           AND k.CONSTRAINT_TYPE = 'P' AND ROWNUM = 1
       ) THEN 1 ELSE 0 END AS is_primary
FROM all_indexes i
JOIN all_ind_columns c ON c.INDEX_OWNER = i.OWNER AND c.INDEX_NAME = i.INDEX_NAME
WHERE i.TABLE_OWNER = :1 AND i.TABLE_NAME = :2
ORDER BY is_primary DESC, i.INDEX_NAME, c.COLUMN_POSITION`
	rows, err := pool.QueryContext(ctx, q, schema, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	indexes := map[string]*model.IndexInfo{}
	order := []string{}
	for rows.Next() {
		var name, unique, typ, column string
		var primary int
		if err := rows.Scan(&name, &unique, &typ, &column, &primary); err != nil {
			return nil, err
		}
		idx, ok := indexes[name]
		if !ok {
			idx = &model.IndexInfo{
				Name:    name,
				Unique:  strings.EqualFold(unique, "UNIQUE"),
				Primary: primary == 1,
				Type:    strings.ToLower(typ),
			}
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

func oracleForeignKeys(ctx context.Context, pool *sql.DB, schema, table string) ([]model.ForeignKeyInfo, error) {
	const q = `
SELECT c.CONSTRAINT_NAME,
       cc.COLUMN_NAME,
       rc.OWNER,
       rc.TABLE_NAME,
       rcc.COLUMN_NAME,
       c.DELETE_RULE
FROM all_constraints c
JOIN all_cons_columns cc ON cc.OWNER = c.OWNER AND cc.CONSTRAINT_NAME = c.CONSTRAINT_NAME
JOIN all_constraints rc ON rc.OWNER = c.R_OWNER AND rc.CONSTRAINT_NAME = c.R_CONSTRAINT_NAME
JOIN all_cons_columns rcc ON rcc.OWNER = rc.OWNER AND rcc.CONSTRAINT_NAME = rc.CONSTRAINT_NAME AND rcc.POSITION = cc.POSITION
WHERE c.OWNER = :1 AND c.TABLE_NAME = :2 AND c.CONSTRAINT_TYPE = 'R'
ORDER BY c.CONSTRAINT_NAME, cc.POSITION`
	rows, err := pool.QueryContext(ctx, q, schema, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	fks := map[string]*model.ForeignKeyInfo{}
	order := []string{}
	for rows.Next() {
		var name, column, refSchema, refTable, refColumn, onDelete string
		if err := rows.Scan(&name, &column, &refSchema, &refTable, &refColumn, &onDelete); err != nil {
			return nil, err
		}
		fk, ok := fks[name]
		if !ok {
			fk = &model.ForeignKeyInfo{
				Name:      name,
				RefSchema: refSchema,
				RefTable:  refTable,
				OnDelete:  onDelete,
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

func oracleDDL(schema, table string, meta *model.TableMeta) string {
	var b strings.Builder
	b.WriteString("CREATE TABLE ")
	b.WriteString(quoteIdent(model.DriverOracle, schema))
	b.WriteString(".")
	b.WriteString(quoteIdent(model.DriverOracle, table))
	b.WriteString(" (\n")
	lines := make([]string, 0, len(meta.Columns)+len(meta.ForeignKeys)+1)
	for _, col := range meta.Columns {
		var line strings.Builder
		line.WriteString("  ")
		line.WriteString(quoteIdent(model.DriverOracle, col.Name))
		line.WriteString(" ")
		line.WriteString(col.ColumnType)
		if !col.Generated && strings.Contains(strings.ToLower(col.Extra), "identity") {
			line.WriteString(" GENERATED BY DEFAULT AS IDENTITY")
		} else if !col.Generated && col.DefaultValue != nil && strings.TrimSpace(*col.DefaultValue) != "" {
			line.WriteString(" DEFAULT ")
			line.WriteString(strings.TrimSpace(*col.DefaultValue))
		}
		if col.Nullable {
			line.WriteString(" NULL")
		} else {
			line.WriteString(" NOT NULL")
		}
		lines = append(lines, line.String())
	}
	for _, idx := range meta.Indexes {
		if !idx.Primary || len(idx.Columns) == 0 {
			continue
		}
		cols := make([]string, 0, len(idx.Columns))
		for _, c := range idx.Columns {
			cols = append(cols, quoteIdent(model.DriverOracle, c))
		}
		lines = append(lines, "  CONSTRAINT "+quoteIdent(model.DriverOracle, idx.Name)+" PRIMARY KEY ("+strings.Join(cols, ", ")+")")
		break
	}
	for _, fk := range meta.ForeignKeys {
		cols := make([]string, 0, len(fk.Columns))
		for _, c := range fk.Columns {
			cols = append(cols, quoteIdent(model.DriverOracle, c))
		}
		refCols := make([]string, 0, len(fk.RefColumns))
		for _, c := range fk.RefColumns {
			refCols = append(refCols, quoteIdent(model.DriverOracle, c))
		}
		refSchema := fk.RefSchema
		if refSchema == "" {
			refSchema = schema
		}
		lines = append(lines, "  CONSTRAINT "+quoteIdent(model.DriverOracle, fk.Name)+" FOREIGN KEY ("+strings.Join(cols, ", ")+") REFERENCES "+
			quoteIdent(model.DriverOracle, refSchema)+"."+quoteIdent(model.DriverOracle, fk.RefTable)+" ("+strings.Join(refCols, ", ")+")"+
			fkActionClause(fk.OnDelete, "ON DELETE"))
	}
	b.WriteString(strings.Join(lines, ",\n"))
	b.WriteString("\n);\n")
	for _, idx := range meta.Indexes {
		if idx.Primary || len(idx.Columns) == 0 {
			continue
		}
		cols := make([]string, 0, len(idx.Columns))
		for _, c := range idx.Columns {
			cols = append(cols, quoteIdent(model.DriverOracle, c))
		}
		b.WriteString("CREATE ")
		if idx.Unique {
			b.WriteString("UNIQUE ")
		}
		b.WriteString("INDEX ")
		b.WriteString(quoteIdent(model.DriverOracle, idx.Name))
		b.WriteString(" ON ")
		b.WriteString(quoteIdent(model.DriverOracle, schema))
		b.WriteString(".")
		b.WriteString(quoteIdent(model.DriverOracle, table))
		b.WriteString(" (")
		b.WriteString(strings.Join(cols, ", "))
		b.WriteString(");\n")
	}
	if meta.Comment != "" {
		b.WriteString("COMMENT ON TABLE ")
		b.WriteString(quoteIdent(model.DriverOracle, schema))
		b.WriteString(".")
		b.WriteString(quoteIdent(model.DriverOracle, table))
		b.WriteString(" IS '")
		b.WriteString(escapeSQLString(meta.Comment))
		b.WriteString("';\n")
	}
	for _, col := range meta.Columns {
		if col.Comment == "" {
			continue
		}
		b.WriteString("COMMENT ON COLUMN ")
		b.WriteString(quoteIdent(model.DriverOracle, schema))
		b.WriteString(".")
		b.WriteString(quoteIdent(model.DriverOracle, table))
		b.WriteString(".")
		b.WriteString(quoteIdent(model.DriverOracle, col.Name))
		b.WriteString(" IS '")
		b.WriteString(escapeSQLString(col.Comment))
		b.WriteString("';\n")
	}
	return b.String()
}
