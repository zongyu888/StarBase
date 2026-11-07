package db

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"navideck/backend/internal/model"
)

func (m *Manager) RedisInfo(ctx context.Context, conn model.Connection, password, database string) (*model.RedisInfo, error) {
	client, err := m.RedisClient(ctx, conn, password, database)
	if err != nil {
		return nil, err
	}
	text, err := client.Info(ctx).Result()
	if err != nil {
		return nil, err
	}
	raw := map[string]string{}
	keyspace := make([]model.RedisDBStats, 0, 16)
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if stats, ok := parseRedisKeyspaceLine(line); ok {
			keyspace = append(keyspace, stats)
			continue
		}
		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 {
			continue
		}
		raw[strings.TrimSpace(parts[0])] = strings.TrimSpace(parts[1])
	}
	sort.Slice(keyspace, func(i, j int) bool { return keyspace[i].DB < keyspace[j].DB })
	return &model.RedisInfo{Raw: raw, Keyspace: keyspace}, nil
}

func parseRedisKeyspaceLine(line string) (model.RedisDBStats, bool) {
	if !strings.HasPrefix(line, "db") {
		return model.RedisDBStats{}, false
	}
	parts := strings.SplitN(line, ":", 2)
	if len(parts) != 2 {
		return model.RedisDBStats{}, false
	}
	index, err := strconv.Atoi(strings.TrimPrefix(parts[0], "db"))
	if err != nil {
		return model.RedisDBStats{}, false
	}
	stats := model.RedisDBStats{DB: index}
	matched := false
	for _, field := range strings.Split(parts[1], ",") {
		key, value, ok := strings.Cut(field, "=")
		if !ok {
			continue
		}
		parsed, err := strconv.ParseInt(value, 10, 64)
		if err != nil {
			continue
		}
		switch key {
		case "keys":
			stats.Keys = parsed
			matched = true
		case "expires":
			stats.Expires = parsed
		case "avg_ttl":
			stats.AvgTTL = parsed
		}
	}
	return stats, matched
}

func (m *Manager) RedisKeys(ctx context.Context, conn model.Connection, password, database, pattern, keyType string, cursor uint64, count int64) (*model.RedisKeysPage, error) {
	client, err := m.RedisClient(ctx, conn, password, database)
	if err != nil {
		return nil, err
	}
	pattern = strings.TrimSpace(pattern)
	if pattern == "" {
		pattern = "*"
	}
	keyType = strings.ToLower(strings.TrimSpace(keyType))
	if keyType == "all" {
		keyType = ""
	}
	if count <= 0 {
		count = 200
	}
	if count > 1000 {
		count = 1000
	}
	keys := make([]model.RedisKeyMeta, 0, count)
	seen := map[string]struct{}{}
	scanned := 0
	// SCAN 的 COUNT 只是提示，带类型过滤时可能需要多轮才能凑满一页。
	for round := 0; round < 50; round++ {
		batch, next, err := client.Scan(ctx, cursor, pattern, count).Result()
		if err != nil {
			return nil, err
		}
		cursor = next
		scanned += len(batch)
		if len(batch) > 0 {
			pipe := client.Pipeline()
			typeCmds := make([]*redis.StatusCmd, len(batch))
			for index, key := range batch {
				typeCmds[index] = pipe.Type(ctx, key)
			}
			_, _ = pipe.Exec(ctx)
			for index, key := range batch {
				valueType := typeCmds[index].Val()
				if valueType == "" || valueType == "none" {
					continue
				}
				if keyType != "" && valueType != keyType {
					continue
				}
				if _, exists := seen[key]; exists {
					continue
				}
				seen[key] = struct{}{}
				keys = append(keys, model.RedisKeyMeta{Key: key, Type: valueType})
			}
		}
		if cursor == 0 || int64(len(keys)) >= count {
			break
		}
	}
	return &model.RedisKeysPage{
		Keys:    keys,
		Cursor:  cursor,
		Done:    cursor == 0,
		Scanned: scanned,
	}, nil
}

func (m *Manager) RedisDeleteKeys(ctx context.Context, conn model.Connection, password, database string, keys []string, pattern string, limit int, allowAll bool) (*model.RedisDeleteKeysResult, error) {
	if conn.ReadOnly {
		return nil, fmt.Errorf("当前连接为只读模式")
	}
	client, err := m.RedisClient(ctx, conn, password, database)
	if err != nil {
		return nil, err
	}
	pattern = strings.TrimSpace(pattern)
	if len(keys) == 0 && pattern == "" {
		return nil, fmt.Errorf("请提供要删除的键或匹配模式")
	}
	if pattern == "*" && !allowAll {
		return nil, fmt.Errorf("删除全部键需要显式确认")
	}
	if limit <= 0 {
		limit = 5000
	}
	if limit > 50000 {
		limit = 50000
	}
	result := &model.RedisDeleteKeysResult{}
	if len(keys) > 0 {
		unique := make([]string, 0, len(keys))
		seen := map[string]struct{}{}
		for _, key := range keys {
			key = strings.TrimSpace(key)
			if key == "" {
				continue
			}
			if _, exists := seen[key]; exists {
				continue
			}
			seen[key] = struct{}{}
			unique = append(unique, key)
		}
		result.Scanned = len(unique)
		deleted, err := redisUnlink(ctx, client, unique)
		if err != nil {
			return nil, err
		}
		result.Deleted = deleted
		return result, nil
	}

	collected := make([]string, 0, limit)
	seen := map[string]struct{}{}
	cursor := uint64(0)
	for {
		batch, next, err := client.Scan(ctx, cursor, pattern, 500).Result()
		if err != nil {
			return nil, err
		}
		cursor = next
		result.Scanned += len(batch)
		for _, key := range batch {
			if _, exists := seen[key]; exists {
				continue
			}
			seen[key] = struct{}{}
			collected = append(collected, key)
		}
		if cursor == 0 || len(collected) >= limit {
			break
		}
	}
	if len(collected) > limit {
		collected = collected[:limit]
	}
	if cursor != 0 || len(collected) >= limit {
		result.Truncated = true
	}
	deleted, err := redisUnlink(ctx, client, collected)
	if err != nil {
		return nil, err
	}
	result.Deleted = deleted
	return result, nil
}

func redisUnlink(ctx context.Context, client *redis.Client, keys []string) (int64, error) {
	var total int64
	for start := 0; start < len(keys); start += 500 {
		end := start + 500
		if end > len(keys) {
			end = len(keys)
		}
		batch := keys[start:end]
		count, err := client.Unlink(ctx, batch...).Result()
		if err != nil {
			count, err = client.Del(ctx, batch...).Result()
		}
		if err != nil {
			return total, err
		}
		total += count
	}
	return total, nil
}

func (m *Manager) RedisRenameKey(ctx context.Context, conn model.Connection, password, database, key, newKey string) error {
	if conn.ReadOnly {
		return fmt.Errorf("当前连接为只读模式")
	}
	key = strings.TrimSpace(key)
	newKey = strings.TrimSpace(newKey)
	if key == "" || newKey == "" {
		return fmt.Errorf("键名不能为空")
	}
	if key == newKey {
		return nil
	}
	client, err := m.RedisClient(ctx, conn, password, database)
	if err != nil {
		return err
	}
	exists, err := client.Exists(ctx, key).Result()
	if err != nil {
		return err
	}
	if exists == 0 {
		return fmt.Errorf("键 %q 不存在", key)
	}
	renamed, err := client.RenameNX(ctx, key, newKey).Result()
	if err != nil {
		return err
	}
	if !renamed {
		return fmt.Errorf("目标键 %q 已存在", newKey)
	}
	return nil
}

func (m *Manager) RedisExpireKey(ctx context.Context, conn model.Connection, password, database, key string, ttl int64, persist bool) (int64, error) {
	if conn.ReadOnly {
		return 0, fmt.Errorf("当前连接为只读模式")
	}
	client, err := m.RedisClient(ctx, conn, password, database)
	if err != nil {
		return 0, err
	}
	exists, err := client.Exists(ctx, key).Result()
	if err != nil {
		return 0, err
	}
	if exists == 0 {
		return 0, fmt.Errorf("键 %q 不存在", key)
	}
	if persist {
		if err := client.Persist(ctx, key).Err(); err != nil {
			return 0, err
		}
		return -1, nil
	}
	if ttl <= 0 {
		return 0, fmt.Errorf("TTL 必须大于 0 秒")
	}
	if err := client.Expire(ctx, key, time.Duration(ttl)*time.Second).Err(); err != nil {
		return 0, err
	}
	return ttl, nil
}

func (m *Manager) RedisMutateEntry(ctx context.Context, conn model.Connection, password, database string, req model.RedisEntryRequest) (any, error) {
	if conn.ReadOnly {
		return nil, fmt.Errorf("当前连接为只读模式")
	}
	if strings.TrimSpace(req.Key) == "" {
		return nil, fmt.Errorf("键名不能为空")
	}
	client, err := m.RedisClient(ctx, conn, password, database)
	if err != nil {
		return nil, err
	}
	keyType, err := client.Type(ctx, req.Key).Result()
	if err != nil {
		return nil, err
	}
	if keyType == "none" {
		return nil, fmt.Errorf("键 %q 不存在", req.Key)
	}
	action := strings.ToLower(strings.TrimSpace(req.Action))
	switch keyType {
	case "string":
		if action != "set" {
			break
		}
		if err := client.SetArgs(ctx, req.Key, req.Value, redis.SetArgs{KeepTTL: true}).Err(); err != nil {
			return nil, err
		}
		return nil, nil
	case "hash":
		switch action {
		case "set":
			if req.Field == "" {
				return nil, fmt.Errorf("Hash 字段不能为空")
			}
			return nil, client.HSet(ctx, req.Key, req.Field, req.Value).Err()
		case "delete":
			if req.Field == "" {
				return nil, fmt.Errorf("Hash 字段不能为空")
			}
			_, err := client.HDel(ctx, req.Key, req.Field).Result()
			return nil, err
		}
	case "list":
		switch action {
		case "push":
			if req.Left {
				return nil, client.LPush(ctx, req.Key, req.Value).Err()
			}
			return nil, client.RPush(ctx, req.Key, req.Value).Err()
		case "set":
			return nil, client.LSet(ctx, req.Key, req.Index, req.Value).Err()
		case "delete":
			return redisDeleteListIndex(ctx, client, req.Key, req.Index)
		}
	case "set":
		switch action {
		case "add":
			if req.Member == "" {
				return nil, fmt.Errorf("Set 成员不能为空")
			}
			return nil, client.SAdd(ctx, req.Key, req.Member).Err()
		case "delete":
			if req.Member == "" {
				return nil, fmt.Errorf("Set 成员不能为空")
			}
			_, err := client.SRem(ctx, req.Key, req.Member).Result()
			return nil, err
		}
	case "zset":
		switch action {
		case "add":
			if req.Member == "" {
				return nil, fmt.Errorf("ZSet 成员不能为空")
			}
			return nil, client.ZAdd(ctx, req.Key, redis.Z{Score: req.Score, Member: req.Member}).Err()
		case "delete":
			if req.Member == "" {
				return nil, fmt.Errorf("ZSet 成员不能为空")
			}
			_, err := client.ZRem(ctx, req.Key, req.Member).Result()
			return nil, err
		}
	case "stream":
		switch action {
		case "add":
			if len(req.Fields) == 0 {
				return nil, fmt.Errorf("Stream 字段不能为空")
			}
			values := make(map[string]any, len(req.Fields))
			for field, value := range req.Fields {
				values[field] = fmt.Sprint(value)
			}
			id := strings.TrimSpace(req.ID)
			if id == "" {
				id = "*"
			}
			return client.XAdd(ctx, &redis.XAddArgs{Stream: req.Key, ID: id, Values: values}).Result()
		case "delete":
			if strings.TrimSpace(req.ID) == "" {
				return nil, fmt.Errorf("Stream 条目 ID 不能为空")
			}
			return client.XDel(ctx, req.Key, req.ID).Result()
		}
	}
	return nil, fmt.Errorf("不支持的 %s 操作 %q", keyType, action)
}

func redisDeleteListIndex(ctx context.Context, client *redis.Client, key string, index int64) (any, error) {
	script := redis.NewScript(`
local len = redis.call('LLEN', KEYS[1])
if len == 0 then return nil end
local idx = tonumber(ARGV[1])
if idx < 0 then idx = len + idx end
if idx < 0 or idx >= len then return nil end
local sentinel = ARGV[2]
local value = redis.call('LINDEX', KEYS[1], idx)
redis.call('LSET', KEYS[1], idx, sentinel)
redis.call('LREM', KEYS[1], 1, sentinel)
return value
`)
	sentinel := "__navideck_deleted_" + uuid.NewString() + "__"
	value, err := script.Run(ctx, client, []string{key}, index, sentinel).Result()
	if err == redis.Nil {
		return nil, fmt.Errorf("列表索引超出范围")
	}
	if err != nil {
		return nil, err
	}
	return value, nil
}
