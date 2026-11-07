package api

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"

	"navideck/backend/internal/model"
	"navideck/backend/internal/store"
)

func (s *Server) listSavedQueries(c *gin.Context) {
	ownerID, all := s.scope(c)
	items := s.Store.ListSavedQueriesFor(ownerID, all, c.Query("connectionId"))
	c.JSON(http.StatusOK, gin.H{"queries": items})
}

func (s *Server) createSavedQuery(c *gin.Context) {
	var input model.SavedQueryInput
	if !bindJSON(c, &input) {
		return
	}
	ownerID, all := s.scope(c)
	if _, err := s.Store.GetFor(input.ConnectionID, ownerID, all); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			abortErr(c, http.StatusBadRequest, fmt.Errorf("连接不存在"))
		} else {
			abortErr(c, http.StatusInternalServerError, err)
		}
		return
	}
	item, err := s.Store.AddSavedQueryFor(input, ownerID)
	if err != nil {
		abortErr(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusCreated, item)
}

func (s *Server) updateSavedQuery(c *gin.Context) {
	var input model.SavedQueryInput
	if !bindJSON(c, &input) {
		return
	}
	ownerID, all := s.scope(c)
	if _, err := s.Store.GetFor(input.ConnectionID, ownerID, all); err != nil {
		abortErr(c, http.StatusBadRequest, fmt.Errorf("连接不存在"))
		return
	}
	item, err := s.Store.UpdateSavedQueryFor(c.Param("id"), ownerID, all, input)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			abortErr(c, http.StatusNotFound, fmt.Errorf("收藏不存在"))
		} else {
			abortErr(c, http.StatusBadRequest, err)
		}
		return
	}
	c.JSON(http.StatusOK, item)
}

func (s *Server) deleteSavedQuery(c *gin.Context) {
	ownerID, all := s.scope(c)
	if err := s.Store.DeleteSavedQueryFor(c.Param("id"), ownerID, all); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			abortErr(c, http.StatusNotFound, fmt.Errorf("收藏不存在"))
		} else {
			abortErr(c, http.StatusInternalServerError, err)
		}
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
