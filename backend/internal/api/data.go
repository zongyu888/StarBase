package api

import (
	"bytes"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"navideck/backend/internal/model"
)

func (s *Server) listDatabases(c *gin.Context) {
	conn, password, ok := s.loadConnection(c)
	if !ok {
		return
	}
	items, err := s.DB.Databases(c.Request.Context(), conn, password)
	if err != nil {
		abortErr(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"databases": items})
}

func (s *Server) listSchemas(c *gin.Context) {
	conn, password, ok := s.loadConnection(c)
	if !ok {
		return
	}
	items, err := s.DB.Schemas(c.Request.Context(), conn, password, c.Query("database"))
	if err != nil {
		abortErr(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"schemas": items})
}

func (s *Server) listObjects(c *gin.Context) {
	conn, password, ok := s.loadConnection(c)
	if !ok {
		return
	}
	items, err := s.DB.Objects(c.Request.Context(), conn, password, c.Query("database"), c.Query("schema"))
	if err != nil {
		abortErr(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"objects": items})
}

func (s *Server) tableMeta(c *gin.Context) {
	conn, password, ok := s.loadConnection(c)
	if !ok {
		return
	}
	table := c.Query("table")
	if table == "" {
		abortErr(c, http.StatusBadRequest, fmt.Errorf("缺少 table 参数"))
		return
	}
	meta, err := s.DB.TableMeta(c.Request.Context(), conn, password, c.Query("database"), c.Query("schema"), table)
	if err != nil {
		abortErr(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, meta)
}

func (s *Server) tableRows(c *gin.Context) {
	conn, password, ok := s.loadConnection(c)
	if !ok {
		return
	}
	table := c.Query("table")
	if table == "" {
		abortErr(c, http.StatusBadRequest, fmt.Errorf("缺少 table 参数"))
		return
	}
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("pageSize", "100"))
	var filters []model.Filter
	if raw := c.Query("filters"); raw != "" {
		if err := json.Unmarshal([]byte(raw), &filters); err != nil {
			abortErr(c, http.StatusBadRequest, fmt.Errorf("筛选条件格式错误: %w", err))
			return
		}
	}
	result, err := s.DB.TableRows(c.Request.Context(), conn, password, c.Query("database"), c.Query("schema"), table,
		page, pageSize, c.Query("sortColumn"), c.Query("sortDir"), filters)
	if err != nil {
		abortErr(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

type tableTarget struct {
	Database string `json:"database"`
	Schema   string `json:"schema"`
	Table    string `json:"table"`
}

type insertRowRequest struct {
	tableTarget
	Values map[string]any `json:"values"`
}

type updateRowRequest struct {
	tableTarget
	Keys    map[string]any `json:"keys"`
	Changes map[string]any `json:"changes"`
}

type deleteRowRequest struct {
	tableTarget
	Keys map[string]any `json:"keys"`
}

func (s *Server) insertRow(c *gin.Context) {
	conn, password, ok := s.loadConnection(c)
	if !ok {
		return
	}
	var req insertRowRequest
	if !bindJSON(c, &req) {
		return
	}
	if req.Table == "" {
		abortErr(c, http.StatusBadRequest, fmt.Errorf("缺少表名"))
		return
	}
	result, err := s.DB.InsertRow(c.Request.Context(), conn, password, req.Database, req.Schema, req.Table, req.Values)
	if err != nil {
		abortErr(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (s *Server) updateRow(c *gin.Context) {
	conn, password, ok := s.loadConnection(c)
	if !ok {
		return
	}
	var req updateRowRequest
	if !bindJSON(c, &req) {
		return
	}
	if req.Table == "" {
		abortErr(c, http.StatusBadRequest, fmt.Errorf("缺少表名"))
		return
	}
	if len(req.Keys) == 0 {
		abortErr(c, http.StatusBadRequest, fmt.Errorf("缺少主键信息"))
		return
	}
	result, err := s.DB.UpdateRow(c.Request.Context(), conn, password, req.Database, req.Schema, req.Table, req.Keys, req.Changes)
	if err != nil {
		abortErr(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (s *Server) deleteRow(c *gin.Context) {
	conn, password, ok := s.loadConnection(c)
	if !ok {
		return
	}
	var req deleteRowRequest
	if !bindJSON(c, &req) {
		return
	}
	if req.Table == "" {
		abortErr(c, http.StatusBadRequest, fmt.Errorf("缺少表名"))
		return
	}
	if len(req.Keys) == 0 {
		abortErr(c, http.StatusBadRequest, fmt.Errorf("缺少主键信息"))
		return
	}
	result, err := s.DB.DeleteRow(c.Request.Context(), conn, password, req.Database, req.Schema, req.Table, req.Keys)
	if err != nil {
		abortErr(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (s *Server) batchRows(c *gin.Context) {
	conn, password, ok := s.loadConnection(c)
	if !ok {
		return
	}
	var req model.BatchRowsRequest
	if !bindJSON(c, &req) {
		return
	}
	if req.Table == "" {
		abortErr(c, http.StatusBadRequest, fmt.Errorf("缺少表名"))
		return
	}
	result, err := s.DB.MutateTableRows(c.Request.Context(), conn, password, req.Database, req.Schema, req.Table, req)
	if err != nil {
		abortErr(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

type queryRequest struct {
	Database string `json:"database"`
	Schema   string `json:"schema"`
	SQL      string `json:"sql"`
	MaxRows  int    `json:"maxRows"`
}

func (s *Server) executeQuery(c *gin.Context) {
	conn, password, ok := s.loadConnection(c)
	if !ok {
		return
	}
	var req queryRequest
	if !bindJSON(c, &req) {
		return
	}
	if strings.TrimSpace(req.SQL) == "" {
		abortErr(c, http.StatusBadRequest, fmt.Errorf("SQL 不能为空"))
		return
	}
	start := time.Now()
	results, err := s.DB.ExecuteQuery(c.Request.Context(), conn, password, req.Database, req.Schema, req.SQL, req.MaxRows, false)
	if err != nil {
		abortErr(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, model.QueryResponse{
		Results:    results,
		DurationMs: time.Since(start).Milliseconds(),
		Database:   req.Database,
	})
}

func (s *Server) createTable(c *gin.Context) {
	conn, password, ok := s.loadConnection(c)
	if !ok {
		return
	}
	var req model.CreateTableRequest
	if !bindJSON(c, &req) {
		return
	}
	result, err := s.DB.CreateTable(c.Request.Context(), conn, password, req)
	if err != nil {
		abortErr(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

type dropTableRequest struct {
	Database string `json:"database"`
	Schema   string `json:"schema"`
	Table    string `json:"table"`
	Type     string `json:"type"`
}

func (s *Server) dropTable(c *gin.Context) {
	conn, password, ok := s.loadConnection(c)
	if !ok {
		return
	}
	var req dropTableRequest
	if !bindJSON(c, &req) {
		return
	}
	if req.Table == "" {
		abortErr(c, http.StatusBadRequest, fmt.Errorf("缺少表名"))
		return
	}
	result, err := s.DB.DropObject(c.Request.Context(), conn, password, req.Database, req.Schema, req.Table, req.Type)
	if err != nil {
		abortErr(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (s *Server) truncateTable(c *gin.Context) {
	conn, password, ok := s.loadConnection(c)
	if !ok {
		return
	}
	var req tableTarget
	if !bindJSON(c, &req) {
		return
	}
	if req.Table == "" {
		abortErr(c, http.StatusBadRequest, fmt.Errorf("缺少表名"))
		return
	}
	result, err := s.DB.TruncateTable(c.Request.Context(), conn, password, req.Database, req.Schema, req.Table)
	if err != nil {
		abortErr(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (s *Server) alterTable(c *gin.Context) {
	conn, password, ok := s.loadConnection(c)
	if !ok {
		return
	}
	var req model.AlterTableRequest
	if !bindJSON(c, &req) {
		return
	}
	result, err := s.DB.AlterTable(c.Request.Context(), conn, password, req)
	if err != nil {
		abortErr(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (s *Server) createDatabase(c *gin.Context) {
	conn, password, ok := s.loadConnection(c)
	if !ok {
		return
	}
	var req model.CreateDatabaseRequest
	if !bindJSON(c, &req) {
		return
	}
	result, err := s.DB.CreateDatabase(c.Request.Context(), conn, password, req)
	if err != nil {
		abortErr(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (s *Server) dropDatabase(c *gin.Context) {
	conn, password, ok := s.loadConnection(c)
	if !ok {
		return
	}
	database := c.Param("database")
	result, err := s.DB.DropDatabase(c.Request.Context(), conn, password, database)
	if err != nil {
		abortErr(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

type importCSVRequest struct {
	tableTarget
	CSV         string                `json:"csv"`
	Delimiter   string                `json:"delimiter,omitempty"`
	EmptyAsNull *bool                 `json:"emptyAsNull,omitempty"`
	NullValue   string                `json:"nullValue,omitempty"`
	Mapping     []model.ImportMapping `json:"mapping,omitempty"`
}

func (s *Server) importCSV(c *gin.Context) {
	conn, password, ok := s.loadConnection(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 20<<20)
	var req importCSVRequest
	if !bindJSON(c, &req) {
		return
	}
	if req.Table == "" {
		abortErr(c, http.StatusBadRequest, fmt.Errorf("缺少表名"))
		return
	}
	if strings.TrimSpace(req.CSV) == "" {
		abortErr(c, http.StatusBadRequest, fmt.Errorf("CSV 内容为空"))
		return
	}
	emptyAsNull := true
	if req.EmptyAsNull != nil {
		emptyAsNull = *req.EmptyAsNull
	}
	options := model.CSVImportOptions{
		Delimiter:   req.Delimiter,
		EmptyAsNull: emptyAsNull,
		NullValue:   req.NullValue,
		Mapping:     req.Mapping,
	}
	count, err := s.DB.ImportCSV(c.Request.Context(), conn, password, req.Database, req.Schema, req.Table, req.CSV, options)
	if err != nil {
		abortErr(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, model.MutationResult{AffectedRows: int64(count)})
}

func (s *Server) exportTable(c *gin.Context) {
	conn, password, ok := s.loadConnection(c)
	if !ok {
		return
	}
	table := c.Query("table")
	if table == "" {
		abortErr(c, http.StatusBadRequest, fmt.Errorf("缺少 table 参数"))
		return
	}
	format := strings.ToLower(c.DefaultQuery("format", "csv"))
	if format != "csv" && format != "json" {
		abortErr(c, http.StatusBadRequest, fmt.Errorf("仅支持 csv 或 json 格式"))
		return
	}
	var filters []model.Filter
	if raw := c.Query("filters"); raw != "" {
		if err := json.Unmarshal([]byte(raw), &filters); err != nil {
			abortErr(c, http.StatusBadRequest, fmt.Errorf("筛选条件格式错误: %w", err))
			return
		}
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "200000"))
	columns, rows, err := s.DB.ExportTableRows(
		c.Request.Context(), conn, password,
		c.Query("database"), c.Query("schema"), table,
		limit, c.Query("sortColumn"), c.Query("sortDir"), filters,
	)
	if err != nil {
		abortErr(c, http.StatusBadRequest, err)
		return
	}
	filename := exportFilename(table, format)
	c.Header("Content-Disposition", contentDisposition(filename))

	if format == "json" {
		objects := make([]map[string]any, 0, len(rows))
		for _, row := range rows {
			obj := make(map[string]any, len(columns))
			for i, name := range columns {
				if i < len(row) {
					obj[name] = row[i]
				}
			}
			objects = append(objects, obj)
		}
		var buf bytes.Buffer
		enc := json.NewEncoder(&buf)
		enc.SetEscapeHTML(false)
		enc.SetIndent("", "  ")
		if err := enc.Encode(objects); err != nil {
			abortErr(c, http.StatusInternalServerError, err)
			return
		}
		c.Data(http.StatusOK, "application/json; charset=utf-8", buf.Bytes())
		return
	}

	var buf bytes.Buffer
	buf.WriteString("\uFEFF")
	w := csv.NewWriter(&buf)
	if err := w.Write(columns); err != nil {
		abortErr(c, http.StatusInternalServerError, err)
		return
	}
	record := make([]string, len(columns))
	for _, row := range rows {
		for i := range columns {
			if i < len(row) {
				record[i] = exportCell(row[i])
			} else {
				record[i] = ""
			}
		}
		if err := w.Write(record); err != nil {
			abortErr(c, http.StatusInternalServerError, err)
			return
		}
	}
	w.Flush()
	if err := w.Error(); err != nil {
		abortErr(c, http.StatusInternalServerError, err)
		return
	}
	c.Data(http.StatusOK, "text/csv; charset=utf-8", buf.Bytes())
}

func exportCell(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case []byte:
		return string(x)
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(x)
	case fmt.Stringer:
		return x.String()
	default:
		return fmt.Sprint(x)
	}
}

func exportFilename(table, format string) string {
	safe := strings.Map(func(r rune) rune {
		switch r {
		case '\\', '/', ':', '*', '?', '"', '<', '>', '|':
			return '_'
		}
		return r
	}, table)
	if strings.TrimSpace(safe) == "" {
		safe = "export"
	}
	return safe + "." + format
}

func contentDisposition(filename string) string {
	return fmt.Sprintf(`attachment; filename="%s"; filename*=UTF-8''%s`, filename, url.PathEscape(filename))
}
