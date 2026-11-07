package api

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"navideck/backend/internal/model"
)

type redisKeyRequest struct {
	Database  string `json:"database"`
	Key       string `json:"key"`
	Type      string `json:"type"`
	Value     any    `json:"value"`
	TTL       int64  `json:"ttl"`
	Overwrite bool   `json:"overwrite"`
}

type redisCommandRequest struct {
	Database string `json:"database"`
	Command  string `json:"command"`
}

type redisDeleteKeysRequest struct {
	Database string   `json:"database"`
	Keys     []string `json:"keys"`
	Pattern  string   `json:"pattern"`
	Limit    int      `json:"limit"`
	AllowAll bool     `json:"allowAll"`
}

type redisRenameKeyRequest struct {
	Database string `json:"database"`
	Key      string `json:"key"`
	NewKey   string `json:"newKey"`
}

type redisExpireKeyRequest struct {
	Database string `json:"database"`
	Key      string `json:"key"`
	TTL      int64  `json:"ttl"`
	Persist  bool   `json:"persist"`
}

func (s *Server) loadRedisConnection(c *gin.Context) (model.Connection, string, bool) {
	conn, password, ok := s.loadConnection(c)
	if !ok {
		return model.Connection{}, "", false
	}
	if conn.Driver != model.DriverRedis {
		abortErr(c, http.StatusBadRequest, fmt.Errorf("该连接不是 Redis"))
		return model.Connection{}, "", false
	}
	return conn, password, true
}

func (s *Server) redisKey(c *gin.Context) {
	conn, password, ok := s.loadRedisConnection(c)
	if !ok {
		return
	}
	key := c.Query("key")
	if strings.TrimSpace(key) == "" {
		abortErr(c, http.StatusBadRequest, fmt.Errorf("缺少 key 参数"))
		return
	}
	cursor, _ := strconv.ParseUint(c.Query("cursor"), 10, 64)
	count, _ := strconv.ParseInt(c.Query("count"), 10, 64)
	info, err := s.DB.RedisKeyInfo(c.Request.Context(), conn, password, c.Query("database"), key, cursor, count)
	if err != nil {
		abortErr(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, info)
}

func (s *Server) redisInfo(c *gin.Context) {
	conn, password, ok := s.loadRedisConnection(c)
	if !ok {
		return
	}
	info, err := s.DB.RedisInfo(c.Request.Context(), conn, password, c.Query("database"))
	if err != nil {
		abortErr(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, info)
}

func (s *Server) redisKeys(c *gin.Context) {
	conn, password, ok := s.loadRedisConnection(c)
	if !ok {
		return
	}
	cursor, _ := strconv.ParseUint(c.Query("cursor"), 10, 64)
	count, _ := strconv.ParseInt(c.Query("count"), 10, 64)
	page, err := s.DB.RedisKeys(
		c.Request.Context(),
		conn,
		password,
		c.Query("database"),
		c.Query("pattern"),
		c.Query("type"),
		cursor,
		count,
	)
	if err != nil {
		abortErr(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, page)
}

func (s *Server) redisDeleteKeys(c *gin.Context) {
	conn, password, ok := s.loadRedisConnection(c)
	if !ok {
		return
	}
	var req redisDeleteKeysRequest
	if !bindJSON(c, &req) {
		return
	}
	result, err := s.DB.RedisDeleteKeys(
		c.Request.Context(),
		conn,
		password,
		req.Database,
		req.Keys,
		req.Pattern,
		req.Limit,
		req.AllowAll,
	)
	if err != nil {
		abortErr(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (s *Server) redisRenameKey(c *gin.Context) {
	conn, password, ok := s.loadRedisConnection(c)
	if !ok {
		return
	}
	var req redisRenameKeyRequest
	if !bindJSON(c, &req) {
		return
	}
	if err := s.DB.RedisRenameKey(c.Request.Context(), conn, password, req.Database, req.Key, req.NewKey); err != nil {
		abortErr(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (s *Server) redisExpireKey(c *gin.Context) {
	conn, password, ok := s.loadRedisConnection(c)
	if !ok {
		return
	}
	var req redisExpireKeyRequest
	if !bindJSON(c, &req) {
		return
	}
	ttl, err := s.DB.RedisExpireKey(c.Request.Context(), conn, password, req.Database, req.Key, req.TTL, req.Persist)
	if err != nil {
		abortErr(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "ttl": ttl})
}

func (s *Server) redisEntry(c *gin.Context) {
	conn, password, ok := s.loadRedisConnection(c)
	if !ok {
		return
	}
	var req model.RedisEntryRequest
	if !bindJSON(c, &req) {
		return
	}
	result, err := s.DB.RedisMutateEntry(c.Request.Context(), conn, password, req.Database, req)
	if err != nil {
		abortErr(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "result": result})
}

func (s *Server) redisSetKey(c *gin.Context) {
	conn, password, ok := s.loadRedisConnection(c)
	if !ok {
		return
	}
	var req redisKeyRequest
	if !bindJSON(c, &req) {
		return
	}
	if strings.TrimSpace(req.Key) == "" {
		abortErr(c, http.StatusBadRequest, fmt.Errorf("键名不能为空"))
		return
	}
	if err := s.DB.RedisSetKey(c.Request.Context(), conn, password, req.Database, req.Key, req.Type, req.Value, req.TTL, req.Overwrite); err != nil {
		abortErr(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (s *Server) redisDeleteKey(c *gin.Context) {
	conn, password, ok := s.loadRedisConnection(c)
	if !ok {
		return
	}
	key := c.Query("key")
	if strings.TrimSpace(key) == "" {
		abortErr(c, http.StatusBadRequest, fmt.Errorf("缺少 key 参数"))
		return
	}
	if err := s.DB.RedisDeleteKey(c.Request.Context(), conn, password, c.Query("database"), key); err != nil {
		abortErr(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (s *Server) redisCommand(c *gin.Context) {
	conn, password, ok := s.loadRedisConnection(c)
	if !ok {
		return
	}
	var req redisCommandRequest
	if !bindJSON(c, &req) {
		return
	}
	result, err := s.DB.RedisCommand(c.Request.Context(), conn, password, req.Database, req.Command)
	if err != nil {
		abortErr(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, result)
}
