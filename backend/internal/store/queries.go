package store

import (
	"encoding/json"
	"errors"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"

	"navideck/backend/internal/model"
)

type queryFileData struct {
	Version int                `json:"version"`
	Queries []model.SavedQuery `json:"queries"`
}

func (s *Store) ListSavedQueriesFor(ownerID string, all bool, connectionID string) []model.SavedQuery {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]model.SavedQuery, 0, len(s.queries))
	for _, item := range s.queries {
		if !all && item.OwnerID != ownerID {
			continue
		}
		if connectionID == "" || item.ConnectionID == connectionID {
			out = append(out, item)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		return out[i].UpdatedAt.After(out[j].UpdatedAt)
	})
	return out
}

func (s *Store) AddSavedQueryFor(input model.SavedQueryInput, ownerID string) (model.SavedQuery, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	item, err := normalizeSavedQuery(input)
	if err != nil {
		return model.SavedQuery{}, err
	}
	now := time.Now().UTC()
	item.ID = uuid.NewString()
	item.OwnerID = ownerID
	item.CreatedAt = now
	item.UpdatedAt = now
	s.queries = append(s.queries, item)
	if err := s.persistQueriesLocked(); err != nil {
		s.queries = s.queries[:len(s.queries)-1]
		return model.SavedQuery{}, err
	}
	return item, nil
}

func (s *Store) UpdateSavedQueryFor(id, ownerID string, all bool, input model.SavedQueryInput) (model.SavedQuery, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.queries {
		if s.queries[i].ID != id || (!all && s.queries[i].OwnerID != ownerID) {
			continue
		}
		item, err := normalizeSavedQuery(input)
		if err != nil {
			return model.SavedQuery{}, err
		}
		item.ID = id
		item.OwnerID = s.queries[i].OwnerID
		item.CreatedAt = s.queries[i].CreatedAt
		item.UpdatedAt = time.Now().UTC()
		old := s.queries[i]
		s.queries[i] = item
		if err := s.persistQueriesLocked(); err != nil {
			s.queries[i] = old
			return model.SavedQuery{}, err
		}
		return item, nil
	}
	return model.SavedQuery{}, ErrNotFound
}

func (s *Store) DeleteSavedQueryFor(id, ownerID string, all bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.queries {
		if s.queries[i].ID != id || (!all && s.queries[i].OwnerID != ownerID) {
			continue
		}
		removed := s.queries[i]
		s.queries = append(s.queries[:i], s.queries[i+1:]...)
		if err := s.persistQueriesLocked(); err != nil {
			restored := append([]model.SavedQuery{removed}, s.queries[i:]...)
			s.queries = append(s.queries[:i], restored...)
			return err
		}
		return nil
	}
	return ErrNotFound
}

func normalizeSavedQuery(input model.SavedQueryInput) (model.SavedQuery, error) {
	name := strings.TrimSpace(input.Name)
	if name == "" {
		return model.SavedQuery{}, errors.New("收藏名称不能为空")
	}
	if len([]rune(name)) > 120 {
		return model.SavedQuery{}, errors.New("收藏名称不能超过 120 个字符")
	}
	sqlText := strings.TrimSpace(input.SQL)
	if sqlText == "" {
		return model.SavedQuery{}, errors.New("SQL 不能为空")
	}
	if strings.TrimSpace(input.ConnectionID) == "" {
		return model.SavedQuery{}, errors.New("缺少连接信息")
	}
	return model.SavedQuery{
		Name:         name,
		ConnectionID: strings.TrimSpace(input.ConnectionID),
		Database:     strings.TrimSpace(input.Database),
		Schema:       strings.TrimSpace(input.Schema),
		SQL:          sqlText,
	}, nil
}

func (s *Store) persistQueriesLocked() error {
	data := queryFileData{Version: 1, Queries: s.queries}
	if data.Queries == nil {
		data.Queries = []model.SavedQuery{}
	}
	raw, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.queriesPath + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.queriesPath)
}
