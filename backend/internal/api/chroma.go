package api

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"navideck/backend/internal/model"
)

type chromaCreateCollectionRequest struct {
	Name  string `json:"name"`
	Space string `json:"space"`
}

func (s *Server) loadChromaConnection(c *gin.Context) (model.Connection, string, bool) {
	conn, password, ok := s.loadConnection(c)
	if !ok {
		return model.Connection{}, "", false
	}
	if conn.Driver != model.DriverChroma {
		abortErr(c, http.StatusBadRequest, fmt.Errorf("该连接不是 Chroma"))
		return model.Connection{}, "", false
	}
	return conn, password, true
}

func (s *Server) chromaInfo(c *gin.Context) {
	conn, password, ok := s.loadChromaConnection(c)
	if !ok {
		return
	}
	info, err := s.DB.ChromaInfo(c.Request.Context(), conn, password)
	if err != nil {
		abortErr(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, info)
}

func (s *Server) chromaCollections(c *gin.Context) {
	conn, password, ok := s.loadChromaConnection(c)
	if !ok {
		return
	}
	collections, err := s.DB.ChromaCollections(c.Request.Context(), conn, password)
	if err != nil {
		abortErr(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"collections": collections})
}

func (s *Server) chromaCollection(c *gin.Context) {
	conn, password, ok := s.loadChromaConnection(c)
	if !ok {
		return
	}
	collectionID := strings.TrimSpace(c.Param("collection"))
	if collectionID == "" {
		abortErr(c, http.StatusBadRequest, fmt.Errorf("缺少集合参数"))
		return
	}
	collection, err := s.DB.ChromaCollection(c.Request.Context(), conn, password, collectionID)
	if err != nil {
		abortErr(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, collection)
}

func (s *Server) chromaCreateCollection(c *gin.Context) {
	conn, password, ok := s.loadChromaConnection(c)
	if !ok {
		return
	}
	if !s.rateLimit(c, s.rateKey(c, "chromawrite"), 120, time.Minute) {
		return
	}
	var req chromaCreateCollectionRequest
	if !bindJSON(c, &req) {
		return
	}
	collection, err := s.DB.ChromaCreateCollection(c.Request.Context(), conn, password, req.Name, req.Space)
	if err != nil {
		abortErr(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusCreated, collection)
}

func (s *Server) chromaDeleteCollection(c *gin.Context) {
	conn, password, ok := s.loadChromaConnection(c)
	if !ok {
		return
	}
	if !s.rateLimit(c, s.rateKey(c, "chromawrite"), 120, time.Minute) {
		return
	}
	collectionID := strings.TrimSpace(c.Param("collection"))
	if collectionID == "" {
		abortErr(c, http.StatusBadRequest, fmt.Errorf("缺少集合参数"))
		return
	}
	if err := s.DB.ChromaDeleteCollection(c.Request.Context(), conn, password, collectionID); err != nil {
		abortErr(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (s *Server) chromaDocuments(c *gin.Context) {
	conn, password, ok := s.loadChromaConnection(c)
	if !ok {
		return
	}
	collectionID := strings.TrimSpace(c.Param("collection"))
	if collectionID == "" {
		abortErr(c, http.StatusBadRequest, fmt.Errorf("缺少集合参数"))
		return
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	page, err := s.DB.ChromaDocuments(c.Request.Context(), conn, password, collectionID, limit, offset)
	if err != nil {
		abortErr(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, page)
}

func (s *Server) chromaAddDocument(c *gin.Context) {
	conn, password, ok := s.loadChromaConnection(c)
	if !ok {
		return
	}
	if !s.rateLimit(c, s.rateKey(c, "chromawrite"), 120, time.Minute) {
		return
	}
	var input model.ChromaDocumentInput
	if !bindJSON(c, &input) {
		return
	}
	document, err := s.DB.ChromaAddDocument(c.Request.Context(), conn, password, c.Param("collection"), input)
	if err != nil {
		abortErr(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusCreated, document)
}

func (s *Server) chromaUpdateDocument(c *gin.Context) {
	conn, password, ok := s.loadChromaConnection(c)
	if !ok {
		return
	}
	if !s.rateLimit(c, s.rateKey(c, "chromawrite"), 120, time.Minute) {
		return
	}
	var input model.ChromaDocumentInput
	if !bindJSON(c, &input) {
		return
	}
	document, err := s.DB.ChromaUpdateDocument(
		c.Request.Context(), conn, password, c.Param("collection"), c.Param("doc"), input,
	)
	if err != nil {
		abortErr(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, document)
}

func (s *Server) chromaDeleteDocument(c *gin.Context) {
	conn, password, ok := s.loadChromaConnection(c)
	if !ok {
		return
	}
	if !s.rateLimit(c, s.rateKey(c, "chromawrite"), 120, time.Minute) {
		return
	}
	documentID := strings.TrimSpace(c.Param("doc"))
	if documentID == "" {
		abortErr(c, http.StatusBadRequest, fmt.Errorf("缺少文档 ID"))
		return
	}
	if err := s.DB.ChromaDeleteDocuments(
		c.Request.Context(), conn, password, c.Param("collection"), []string{documentID},
	); err != nil {
		abortErr(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (s *Server) chromaQuery(c *gin.Context) {
	conn, password, ok := s.loadChromaConnection(c)
	if !ok {
		return
	}
	var req model.ChromaQueryRequest
	if !bindJSON(c, &req) {
		return
	}
	result, err := s.DB.ChromaQuery(c.Request.Context(), conn, password, c.Param("collection"), req)
	if err != nil {
		abortErr(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (s *Server) chromaFilter(c *gin.Context) {
	conn, password, ok := s.loadChromaConnection(c)
	if !ok {
		return
	}
	var req model.ChromaFilterRequest
	if !bindJSON(c, &req) {
		return
	}
	result, err := s.DB.ChromaFilter(c.Request.Context(), conn, password, c.Param("collection"), req)
	if err != nil {
		abortErr(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, result)
}
