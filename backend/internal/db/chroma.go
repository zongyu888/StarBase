package db

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"navideck/backend/internal/model"
)

const (
	chromaDefaultTenant   = "default_tenant"
	chromaDefaultDatabase = "default_database"
	chromaMaxErrorLength  = 600
	chromaMaxPageSize     = 1000
)

type chromaClient struct {
	baseURL  string
	tenant   string
	database string
	version  string
	http     *http.Client
}

type chromaRawCollection struct {
	ID                string         `json:"id"`
	Name              string         `json:"name"`
	Metadata          map[string]any `json:"metadata"`
	ConfigurationJSON map[string]any `json:"configuration_json"`
	Configuration     map[string]any `json:"configuration"`
	Dimension         int            `json:"dimension"`
	Version           int            `json:"version"`
	Tenant            string         `json:"tenant"`
	Database          string         `json:"database"`
}

type chromaRawGet struct {
	IDs        []string         `json:"ids"`
	Documents  []*string        `json:"documents"`
	Metadatas  []map[string]any `json:"metadatas"`
	Embeddings [][]float64      `json:"embeddings"`
	Distances  []float64        `json:"distances"`
}

type chromaRawQuery struct {
	IDs        [][]string         `json:"ids"`
	Documents  [][]*string        `json:"documents"`
	Metadatas  [][]map[string]any `json:"metadatas"`
	Embeddings [][][]float64      `json:"embeddings"`
	Distances  [][]float64        `json:"distances"`
}

func (m *Manager) newHTTPClient() *http.Client {
	transport := &http.Transport{
		Proxy:                 nil,
		ForceAttemptHTTP2:     false,
		MaxIdleConns:          16,
		MaxIdleConnsPerHost:   8,
		IdleConnTimeout:       60 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: time.Second,
	}
	if m.dial != nil {
		transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
			return m.dial(ctx, network, address)
		}
	}
	return &http.Client{Transport: transport}
}

func (m *Manager) chromaClient(ctx context.Context, conn model.Connection) (*chromaClient, error) {
	host := strings.TrimSpace(conn.Host)
	if host == "" {
		host = "127.0.0.1"
	}
	port := conn.Port
	if port <= 0 {
		port = model.DefaultPort(model.DriverChroma)
	}
	tenant := strings.TrimSpace(conn.Tenant)
	if tenant == "" {
		tenant = chromaDefaultTenant
	}
	database := strings.TrimSpace(conn.Database)
	if database == "" {
		database = chromaDefaultDatabase
	}
	client := &chromaClient{
		baseURL:  "http://" + net.JoinHostPort(host, strconv.Itoa(port)),
		tenant:   tenant,
		database: database,
		http:     m.httpClient,
	}
	if client.http == nil {
		client.http = m.newHTTPClient()
	}

	m.chromaMu.Lock()
	version := m.chromaVersions[conn.ID]
	m.chromaMu.Unlock()
	if version == "" {
		version = m.detectChromaVersion(ctx, client)
		if version == "" {
			return nil, fmt.Errorf("无法连接 Chroma 服务 %s：请确认 host/port 正确且 Chroma 已启动", client.baseURL)
		}
		m.chromaMu.Lock()
		m.chromaVersions[conn.ID] = version
		m.chromaMu.Unlock()
	}
	client.version = version
	return client, nil
}

func (m *Manager) detectChromaVersion(ctx context.Context, client *chromaClient) string {
	checkCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	for _, version := range []string{"v2", "v1"} {
		path := "/api/" + version + "/heartbeat"
		req, err := http.NewRequestWithContext(checkCtx, http.MethodGet, client.baseURL+path, nil)
		if err != nil {
			return ""
		}
		resp, err := client.http.Do(req)
		if err != nil {
			continue
		}
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
		resp.Body.Close()
		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			return version
		}
	}
	return ""
}

func (c *chromaClient) path(subpath string) string {
	if c.version == "v1" {
		return "/api/v1" + subpath
	}
	return "/api/v2/tenants/" + url.PathEscape(c.tenant) +
		"/databases/" + url.PathEscape(c.database) + subpath
}

func (c *chromaClient) apiPath(subpath string) string {
	if c.version == "v1" {
		return "/api/v1" + subpath
	}
	return "/api/v2" + subpath
}

func (c *chromaClient) collectionPath(collectionID, suffix string) string {
	return c.path("/collections/" + url.PathEscape(collectionID) + suffix)
}

func (c *chromaClient) do(ctx context.Context, method, path string, body, out any) (int, error) {
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return 0, err
		}
		reader = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reader)
	if err != nil {
		return 0, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	payload, readErr := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if readErr != nil {
		return resp.StatusCode, readErr
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return resp.StatusCode, fmt.Errorf("%s", chromaErrorMessage(resp.StatusCode, payload))
	}
	if out != nil && len(bytes.TrimSpace(payload)) > 0 && resp.StatusCode != http.StatusNoContent {
		if err := json.Unmarshal(payload, out); err != nil {
			return resp.StatusCode, fmt.Errorf("解析 Chroma 响应失败: %w", err)
		}
	}
	return resp.StatusCode, nil
}

func (c *chromaClient) text(ctx context.Context, path string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	payload, readErr := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	if readErr != nil {
		return "", readErr
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("%s", chromaErrorMessage(resp.StatusCode, payload))
	}
	text := strings.TrimSpace(string(payload))
	var quoted string
	if err := json.Unmarshal(payload, &quoted); err == nil {
		return strings.TrimSpace(quoted), nil
	}
	return strings.Trim(text, `"`), nil
}

func chromaErrorMessage(status int, payload []byte) string {
	text := strings.TrimSpace(string(payload))
	var structured map[string]any
	if err := json.Unmarshal(payload, &structured); err == nil {
		for _, key := range []string{"error", "detail", "message"} {
			if value, ok := structured[key]; ok {
				if rendered := strings.TrimSpace(fmt.Sprint(value)); rendered != "" {
					text = rendered
					break
				}
			}
		}
	}
	if text == "" {
		text = http.StatusText(status)
	}
	if len(text) > chromaMaxErrorLength {
		text = text[:chromaMaxErrorLength] + "…"
	}
	return fmt.Sprintf("Chroma 返回 %d: %s", status, text)
}

func (m *Manager) ChromaHeartbeat(ctx context.Context, conn model.Connection, password string) (bool, error) {
	_ = password
	client, err := m.chromaClient(ctx, conn)
	if err != nil {
		return false, err
	}
	reqCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	var result map[string]any
	if _, err := client.do(reqCtx, http.MethodGet, client.apiPath("/heartbeat"), nil, &result); err != nil {
		return false, err
	}
	return true, nil
}

func (m *Manager) ChromaVersion(ctx context.Context, conn model.Connection, password string) (string, error) {
	_ = password
	client, err := m.chromaClient(ctx, conn)
	if err != nil {
		return "", err
	}
	reqCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	version, err := client.text(reqCtx, client.apiPath("/version"))
	if err != nil {
		return "", err
	}
	return version, nil
}

func (m *Manager) ChromaInfo(ctx context.Context, conn model.Connection, password string) (*model.ChromaInfo, error) {
	_ = password
	client, err := m.chromaClient(ctx, conn)
	if err != nil {
		return nil, err
	}
	info := &model.ChromaInfo{
		Heartbeat: true,
		Tenant:    client.tenant,
		Database:  client.database,
		Server:    client.baseURL,
	}
	reqCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	if version, err := client.text(reqCtx, client.apiPath("/version")); err == nil {
		info.Version = version
	}
	return info, nil
}

func (m *Manager) ChromaCollections(ctx context.Context, conn model.Connection, password string) ([]model.ChromaCollection, error) {
	_ = password
	client, err := m.chromaClient(ctx, conn)
	if err != nil {
		return nil, err
	}
	reqCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	var raw []chromaRawCollection
	if _, err := client.do(reqCtx, http.MethodGet, client.path("/collections"), nil, &raw); err != nil {
		return nil, err
	}
	out := make([]model.ChromaCollection, 0, len(raw))
	for _, item := range raw {
		out = append(out, chromaCollectionFromRaw(client, item))
	}
	sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name) })

	sem := make(chan struct{}, 4)
	var wg sync.WaitGroup
	for index := range out {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			if count, err := m.chromaCollectionCount(ctx, client, out[index].ID); err == nil {
				out[index].Count = count
			}
		}(index)
	}
	wg.Wait()
	return out, nil
}

func (m *Manager) ChromaCollection(ctx context.Context, conn model.Connection, password, collectionID string) (*model.ChromaCollection, error) {
	_ = password
	client, err := m.chromaClient(ctx, conn)
	if err != nil {
		return nil, err
	}
	reqCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	var raw chromaRawCollection
	if _, err := client.do(reqCtx, http.MethodGet, client.collectionPath(collectionID, ""), nil, &raw); err != nil {
		return nil, err
	}
	collection := chromaCollectionFromRaw(client, raw)
	if collection.ID == "" {
		collection.ID = collectionID
	}
	if count, err := m.chromaCollectionCount(ctx, client, collection.ID); err == nil {
		collection.Count = count
	}
	return &collection, nil
}

func (m *Manager) ChromaCollectionCount(ctx context.Context, conn model.Connection, password, collectionID string) (int64, error) {
	_ = password
	client, err := m.chromaClient(ctx, conn)
	if err != nil {
		return 0, err
	}
	reqCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	return m.chromaCollectionCount(reqCtx, client, collectionID)
}

func (m *Manager) chromaCollectionCount(ctx context.Context, client *chromaClient, collectionID string) (int64, error) {
	var raw json.RawMessage
	if _, err := client.do(ctx, http.MethodGet, client.collectionPath(collectionID, "/count"), nil, &raw); err != nil {
		return 0, err
	}
	var count int64
	if err := json.Unmarshal(raw, &count); err == nil {
		return count, nil
	}
	var wrapped struct {
		Count int64 `json:"count"`
	}
	if err := json.Unmarshal(raw, &wrapped); err == nil {
		return wrapped.Count, nil
	}
	return 0, fmt.Errorf("无法解析集合数量")
}

func (m *Manager) ChromaCreateCollection(ctx context.Context, conn model.Connection, password, name, space string) (*model.ChromaCollection, error) {
	_ = password
	if conn.ReadOnly {
		return nil, fmt.Errorf("当前连接为只读模式")
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, fmt.Errorf("集合名称不能为空")
	}
	space = strings.ToLower(strings.TrimSpace(space))
	switch space {
	case "l2", "cosine", "ip":
	case "":
		space = "l2"
	default:
		return nil, fmt.Errorf("不支持的距离函数 %q，请选择 l2、cosine 或 ip", space)
	}
	client, err := m.chromaClient(ctx, conn)
	if err != nil {
		return nil, err
	}
	reqCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	body := map[string]any{
		"name":          name,
		"get_or_create": false,
		"metadata":      map[string]any{"hnsw:space": space},
	}
	var raw chromaRawCollection
	if _, err := client.do(reqCtx, http.MethodPost, client.path("/collections"), body, &raw); err != nil {
		return nil, err
	}
	collection := chromaCollectionFromRaw(client, raw)
	if collection.ID == "" {
		collection.ID = name
	}
	if collection.Name == "" {
		collection.Name = name
	}
	return &collection, nil
}

func (m *Manager) ChromaDeleteCollection(ctx context.Context, conn model.Connection, password, collectionID string) error {
	_ = password
	if conn.ReadOnly {
		return fmt.Errorf("当前连接为只读模式")
	}
	client, err := m.chromaClient(ctx, conn)
	if err != nil {
		return err
	}
	reqCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	_, err = client.do(reqCtx, http.MethodDelete, client.collectionPath(collectionID, ""), nil, nil)
	return err
}

func (m *Manager) ChromaDocuments(ctx context.Context, conn model.Connection, password, collectionID string, limit, offset int) (*model.ChromaDocumentsPage, error) {
	_ = password
	client, err := m.chromaClient(ctx, conn)
	if err != nil {
		return nil, err
	}
	if limit <= 0 {
		limit = 20
	}
	if limit > chromaMaxPageSize {
		limit = chromaMaxPageSize
	}
	if offset < 0 {
		offset = 0
	}
	reqCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	body := map[string]any{
		"limit":   limit,
		"offset":  offset,
		"include": []string{"documents", "metadatas", "embeddings"},
	}
	var raw chromaRawGet
	if _, err := client.do(reqCtx, http.MethodPost, client.collectionPath(collectionID, "/get"), body, &raw); err != nil {
		return nil, err
	}
	page := &model.ChromaDocumentsPage{
		Documents: chromaDocumentsFromGet(raw),
		Limit:     limit,
		Offset:    offset,
	}
	if count, err := m.chromaCollectionCount(reqCtx, client, collectionID); err == nil {
		page.Total = count
	} else {
		page.Total = int64(offset + len(page.Documents))
	}
	return page, nil
}

func (m *Manager) ChromaAddDocument(ctx context.Context, conn model.Connection, password, collectionID string, input model.ChromaDocumentInput) (*model.ChromaDocument, error) {
	_ = password
	if conn.ReadOnly {
		return nil, fmt.Errorf("当前连接为只读模式")
	}
	id := strings.TrimSpace(input.ID)
	if id == "" {
		return nil, fmt.Errorf("文档 ID 不能为空")
	}
	client, err := m.chromaClient(ctx, conn)
	if err != nil {
		return nil, err
	}
	body := map[string]any{"ids": []string{id}}
	if input.Document != nil {
		body["documents"] = []string{*input.Document}
	}
	if input.Metadata != nil {
		body["metadatas"] = []map[string]any{input.Metadata}
	}
	if len(input.Embedding) > 0 {
		body["embeddings"] = [][]float64{input.Embedding}
	}
	reqCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	if _, err := client.do(reqCtx, http.MethodPost, client.collectionPath(collectionID, "/add"), body, nil); err != nil {
		return nil, err
	}
	return &model.ChromaDocument{
		ID:        id,
		Document:  derefDocument(input.Document),
		Metadata:  input.Metadata,
		Embedding: input.Embedding,
	}, nil
}

func (m *Manager) ChromaUpdateDocument(ctx context.Context, conn model.Connection, password, collectionID, documentID string, input model.ChromaDocumentInput) (*model.ChromaDocument, error) {
	_ = password
	if conn.ReadOnly {
		return nil, fmt.Errorf("当前连接为只读模式")
	}
	documentID = strings.TrimSpace(documentID)
	if documentID == "" {
		documentID = strings.TrimSpace(input.ID)
	}
	if documentID == "" {
		return nil, fmt.Errorf("文档 ID 不能为空")
	}
	client, err := m.chromaClient(ctx, conn)
	if err != nil {
		return nil, err
	}
	body := map[string]any{"ids": []string{documentID}}
	if input.Document != nil {
		body["documents"] = []string{*input.Document}
	}
	if input.Metadata != nil {
		body["metadatas"] = []map[string]any{input.Metadata}
	}
	if len(input.Embedding) > 0 {
		body["embeddings"] = [][]float64{input.Embedding}
	}
	reqCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	if _, err := client.do(reqCtx, http.MethodPost, client.collectionPath(collectionID, "/update"), body, nil); err != nil {
		return nil, err
	}
	return &model.ChromaDocument{
		ID:        documentID,
		Document:  derefDocument(input.Document),
		Metadata:  input.Metadata,
		Embedding: input.Embedding,
	}, nil
}

func (m *Manager) ChromaDeleteDocuments(ctx context.Context, conn model.Connection, password, collectionID string, ids []string) error {
	_ = password
	if conn.ReadOnly {
		return fmt.Errorf("当前连接为只读模式")
	}
	cleaned := make([]string, 0, len(ids))
	for _, id := range ids {
		if trimmed := strings.TrimSpace(id); trimmed != "" {
			cleaned = append(cleaned, trimmed)
		}
	}
	if len(cleaned) == 0 {
		return fmt.Errorf("请选择要删除的文档")
	}
	client, err := m.chromaClient(ctx, conn)
	if err != nil {
		return err
	}
	reqCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	_, err = client.do(reqCtx, http.MethodPost, client.collectionPath(collectionID, "/delete"), map[string]any{"ids": cleaned}, nil)
	return err
}

func (m *Manager) ChromaQuery(ctx context.Context, conn model.Connection, password, collectionID string, req model.ChromaQueryRequest) (*model.ChromaQueryResult, error) {
	_ = password
	if len(req.Embedding) == 0 {
		return nil, fmt.Errorf("查询向量不能为空")
	}
	nResults := req.NResults
	if nResults <= 0 {
		nResults = 10
	}
	if nResults > chromaMaxPageSize {
		nResults = chromaMaxPageSize
	}
	client, err := m.chromaClient(ctx, conn)
	if err != nil {
		return nil, err
	}
	body := map[string]any{
		"query_embeddings": [][]float64{req.Embedding},
		"n_results":        nResults,
		"include":          []string{"documents", "metadatas", "embeddings", "distances"},
	}
	if len(req.Where) > 0 {
		body["where"] = req.Where
	}
	reqCtx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	var raw chromaRawQuery
	if _, err := client.do(reqCtx, http.MethodPost, client.collectionPath(collectionID, "/query"), body, &raw); err != nil {
		return nil, err
	}
	return &model.ChromaQueryResult{Documents: chromaDocumentsFromQuery(raw)}, nil
}

func (m *Manager) ChromaFilter(ctx context.Context, conn model.Connection, password, collectionID string, req model.ChromaFilterRequest) (*model.ChromaQueryResult, error) {
	_ = password
	if len(req.Where) == 0 {
		return nil, fmt.Errorf("过滤条件不能为空")
	}
	limit := req.Limit
	if limit <= 0 {
		limit = 20
	}
	if limit > chromaMaxPageSize {
		limit = chromaMaxPageSize
	}
	client, err := m.chromaClient(ctx, conn)
	if err != nil {
		return nil, err
	}
	body := map[string]any{
		"where":   req.Where,
		"limit":   limit,
		"include": []string{"documents", "metadatas", "embeddings"},
	}
	reqCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	var raw chromaRawGet
	if _, err := client.do(reqCtx, http.MethodPost, client.collectionPath(collectionID, "/get"), body, &raw); err != nil {
		return nil, err
	}
	return &model.ChromaQueryResult{Documents: chromaDocumentsFromGet(raw)}, nil
}

func (m *Manager) chromaDatabases(ctx context.Context, conn model.Connection, password string) ([]model.DatabaseInfo, error) {
	collections, err := m.ChromaCollections(ctx, conn, password)
	if err != nil {
		return nil, err
	}
	database := strings.TrimSpace(conn.Database)
	if database == "" {
		database = chromaDefaultDatabase
	}
	return []model.DatabaseInfo{{
		Name:       database,
		Charset:    "vector",
		Collation:  strings.TrimSpace(conn.Tenant),
		TableCount: int64(len(collections)),
	}}, nil
}

func (m *Manager) chromaObjects(ctx context.Context, conn model.Connection, password, database, schema string) ([]model.ObjectInfo, error) {
	_ = database
	_ = schema
	collections, err := m.ChromaCollections(ctx, conn, password)
	if err != nil {
		return nil, err
	}
	out := make([]model.ObjectInfo, 0, len(collections))
	for _, collection := range collections {
		out = append(out, model.ObjectInfo{
			ID:      collection.ID,
			Name:    collection.Name,
			Type:    "collection",
			Engine:  "Chroma",
			Rows:    collection.Count,
			Comment: collection.Distance,
		})
	}
	return out, nil
}

func chromaCollectionFromRaw(client *chromaClient, raw chromaRawCollection) model.ChromaCollection {
	config := raw.ConfigurationJSON
	if len(config) == 0 {
		config = raw.Configuration
	}
	hnsw := chromaHNSW(config)
	collection := model.ChromaCollection{
		ID:            raw.ID,
		Name:          raw.Name,
		Metadata:      raw.Metadata,
		HNSW:          hnsw,
		Dimension:     raw.Dimension,
		Version:       raw.Version,
		Tenant:        raw.Tenant,
		Database:      raw.Database,
		Configuration: config,
	}
	if collection.Tenant == "" {
		collection.Tenant = client.tenant
	}
	if collection.Database == "" {
		collection.Database = client.database
	}
	if space, ok := hnsw["space"]; ok {
		collection.Distance = strings.ToLower(strings.TrimSpace(fmt.Sprint(space)))
	}
	return collection
}

func chromaHNSW(config map[string]any) map[string]any {
	if len(config) == 0 {
		return map[string]any{}
	}
	value, ok := config["hnsw"]
	if !ok {
		return map[string]any{}
	}
	hnsw, ok := value.(map[string]any)
	if !ok {
		return map[string]any{}
	}
	out := make(map[string]any, len(hnsw))
	for key, item := range hnsw {
		if nested, ok := item.(map[string]any); ok {
			if unwrapped, exists := nested["value"]; exists {
				out[key] = unwrapped
				continue
			}
		}
		out[key] = item
	}
	return out
}

func chromaDocumentsFromGet(raw chromaRawGet) []model.ChromaDocument {
	out := make([]model.ChromaDocument, 0, len(raw.IDs))
	for index, id := range raw.IDs {
		document := model.ChromaDocument{ID: id}
		if index < len(raw.Documents) && raw.Documents[index] != nil {
			document.Document = *raw.Documents[index]
		}
		if index < len(raw.Metadatas) {
			document.Metadata = raw.Metadatas[index]
		}
		if index < len(raw.Embeddings) {
			document.Embedding = raw.Embeddings[index]
		}
		if index < len(raw.Distances) {
			distance := raw.Distances[index]
			document.Distance = &distance
		}
		out = append(out, document)
	}
	return out
}

func chromaDocumentsFromQuery(raw chromaRawQuery) []model.ChromaDocument {
	if len(raw.IDs) == 0 {
		return []model.ChromaDocument{}
	}
	ids := raw.IDs[0]
	out := make([]model.ChromaDocument, 0, len(ids))
	for index, id := range ids {
		document := model.ChromaDocument{ID: id}
		if len(raw.Documents) > 0 && index < len(raw.Documents[0]) && raw.Documents[0][index] != nil {
			document.Document = *raw.Documents[0][index]
		}
		if len(raw.Metadatas) > 0 && index < len(raw.Metadatas[0]) {
			document.Metadata = raw.Metadatas[0][index]
		}
		if len(raw.Embeddings) > 0 && index < len(raw.Embeddings[0]) {
			document.Embedding = raw.Embeddings[0][index]
		}
		if len(raw.Distances) > 0 && index < len(raw.Distances[0]) {
			distance := raw.Distances[0][index]
			document.Distance = &distance
		}
		out = append(out, document)
	}
	return out
}

func derefDocument(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
