package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"navideck/backend/internal/model"
	"navideck/backend/internal/store"
)

func (s *Server) listConnections(c *gin.Context) {
	ownerID, all := s.scope(c)
	conns := s.Store.ListFor(ownerID, all)
	for i := range conns {
		conns[i].Connected = s.DB.Status(conns[i].ID)
	}
	c.JSON(http.StatusOK, gin.H{"connections": conns})
}

func (s *Server) createConnection(c *gin.Context) {
	var input model.ConnectionInput
	if !bindJSON(c, &input) {
		return
	}
	if !s.rateLimit(c, s.rateKey(c, "dbcreate"), 30, time.Minute) {
		return
	}
	ownerID, _ := s.scope(c)
	preview, err := s.Store.Prepare(input, model.Connection{})
	if err != nil {
		abortErr(c, http.StatusBadRequest, err)
		return
	}
	if !s.validateTarget(c, preview) {
		return
	}
	conn, err := s.Store.AddFor(input, ownerID)
	if err != nil {
		abortErr(c, http.StatusBadRequest, err)
		return
	}
	conn.Connected = false
	c.JSON(http.StatusCreated, conn)
}

func (s *Server) updateConnection(c *gin.Context) {
	var input model.ConnectionInput
	if !bindJSON(c, &input) {
		return
	}
	ownerID, all := s.scope(c)
	existing, err := s.Store.GetFor(c.Param("id"), ownerID, all)
	if err != nil {
		abortErr(c, http.StatusNotFound, fmt.Errorf("连接不存在"))
		return
	}
	preview, err := s.Store.Prepare(input, existing)
	if err != nil {
		abortErr(c, http.StatusBadRequest, err)
		return
	}
	if !s.validateTarget(c, preview) {
		return
	}
	conn, err := s.Store.UpdateFor(c.Param("id"), ownerID, all, input)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			abortErr(c, http.StatusNotFound, fmt.Errorf("连接不存在"))
		} else {
			abortErr(c, http.StatusBadRequest, err)
		}
		return
	}
	s.DB.Disconnect(conn.ID)
	conn.Connected = false
	c.JSON(http.StatusOK, conn)
}

func (s *Server) deleteConnection(c *gin.Context) {
	id := c.Param("id")
	ownerID, all := s.scope(c)
	if err := s.Store.DeleteFor(id, ownerID, all); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			abortErr(c, http.StatusNotFound, fmt.Errorf("连接不存在"))
		} else {
			abortErr(c, http.StatusInternalServerError, err)
		}
		return
	}
	s.DB.Disconnect(id)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (s *Server) testConnection(c *gin.Context) {
	if !s.rateLimit(c, s.rateKey(c, "dbtest"), 30, time.Minute) {
		return
	}
	var req model.TestConnectionRequest
	if !bindJSON(c, &req) {
		return
	}
	conn, err := connectionFromTestInput(req.ConnectionInput)
	if err != nil {
		abortErr(c, http.StatusBadRequest, err)
		return
	}
	password := ""
	if req.Password != nil {
		password = *req.Password
	} else if req.ID != "" {
		ownerID, all := s.scope(c)
		saved, err := s.Store.GetFor(req.ID, ownerID, all)
		if err != nil {
			abortErr(c, http.StatusNotFound, fmt.Errorf("连接不存在"))
			return
		}
		if !sameTarget(saved, conn) && conn.Driver != model.DriverChroma {
			abortErr(c, http.StatusBadRequest, fmt.Errorf("修改数据库目标后请重新输入密码再测试"))
			return
		}
		if pw, err := s.Store.Password(saved); err == nil {
			password = pw
		}
	}
	if !s.validateTarget(c, conn) {
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 25*time.Second)
	defer cancel()
	result := s.DB.TestInput(ctx, conn, password)
	c.JSON(http.StatusOK, result)
}

func (s *Server) connectConnection(c *gin.Context) {
	if !s.rateLimit(c, s.rateKey(c, "dbconnect"), 30, time.Minute) {
		return
	}
	conn, password, ok := s.loadConnection(c)
	if !ok {
		return
	}
	if s.Access != nil {
		if err := s.Access.ValidateConnection(c.Request.Context(), conn, s.accessUser(c)); err != nil {
			abortErr(c, http.StatusForbidden, err)
			return
		}
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()
	if err := s.DB.Connect(ctx, conn, password); err != nil {
		abortErr(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"connected": true})
}

func (s *Server) disconnectConnection(c *gin.Context) {
	conn, _, ok := s.loadConnection(c)
	if !ok {
		return
	}
	s.DB.Disconnect(conn.ID)
	c.JSON(http.StatusOK, gin.H{"connected": false})
}

func connectionFromTestInput(input model.ConnectionInput) (model.Connection, error) {
	driver := strings.ToLower(strings.TrimSpace(input.Driver))
	switch driver {
	case model.DriverMySQL, model.DriverMariaDB, model.DriverPostgres, model.DriverSQLite,
		model.DriverSQLServer, model.DriverOracle, model.DriverSnowflake, model.DriverMongo, model.DriverRedis,
		model.DriverChroma:
	default:
		return model.Connection{}, fmt.Errorf("请选择数据库类型")
	}
	conn := model.Connection{
		ID:            "test",
		Name:          input.Name,
		Driver:        driver,
		Host:          strings.TrimSpace(input.Host),
		Port:          input.Port,
		Username:      strings.TrimSpace(input.Username),
		Database:      strings.TrimSpace(input.Database),
		SSLMode:       strings.TrimSpace(input.SSLMode),
		SQLitePath:    strings.TrimSpace(input.SQLitePath),
		Instance:      strings.TrimSpace(input.Instance),
		OracleSID:     strings.TrimSpace(input.OracleSID),
		OracleWallet:  strings.TrimSpace(input.OracleWallet),
		Account:       strings.TrimSpace(input.Account),
		Warehouse:     strings.TrimSpace(input.Warehouse),
		Role:          strings.TrimSpace(input.Role),
		DefaultSchema: strings.TrimSpace(input.DefaultSchema),
		AuthSource:    strings.TrimSpace(input.AuthSource),
		Tenant:        strings.TrimSpace(input.Tenant),
		Template:      strings.TrimSpace(input.Template),
		ReadOnly:      input.ReadOnly,
	}
	if driver == model.DriverSQLite {
		if conn.SQLitePath == "" {
			return model.Connection{}, fmt.Errorf("请填写 SQLite 数据库文件路径")
		}
		conn.Database = "main"
	} else {
		if conn.Host == "" && driver != model.DriverSnowflake {
			conn.Host = "127.0.0.1"
		}
		if conn.Port == 0 {
			conn.Port = model.DefaultPort(driver)
		}
		if conn.SSLMode == "" {
			conn.SSLMode = "disable"
		}
		if driver == model.DriverOracle && conn.Database == "" && conn.OracleSID == "" {
			return model.Connection{}, fmt.Errorf("请填写 Oracle 服务名（Service Name / SID）")
		}
		if driver == model.DriverSnowflake {
			if conn.Account == "" {
				return model.Connection{}, fmt.Errorf("请填写 Snowflake 账户标识")
			}
			if conn.DefaultSchema == "" {
				conn.DefaultSchema = "PUBLIC"
			}
		}
		if driver == model.DriverMongo && conn.AuthSource == "" {
			conn.AuthSource = "admin"
		}
		if driver == model.DriverRedis && conn.Database == "" {
			conn.Database = "0"
		}
		if driver == model.DriverChroma {
			if conn.Tenant == "" {
				conn.Tenant = "default_tenant"
			}
			if conn.Database == "" {
				conn.Database = "default_database"
			}
			conn.SSLMode = ""
		}
	}
	return conn, nil
}
