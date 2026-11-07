package db

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"

	"navideck/backend/internal/model"
)

func (m *Manager) redisDatabases(ctx context.Context, conn model.Connection, password string) ([]model.DatabaseInfo, error) {
	client, err := m.RedisClient(ctx, conn, password, "0")
	if err != nil {
		return nil, err
	}
	count := 16
	if values, err := client.ConfigGet(ctx, "databases").Result(); err == nil {
		if parsed, err := strconv.Atoi(values["databases"]); err == nil && parsed > 0 && parsed <= 256 {
			count = parsed
		}
	}
	keyCounts := map[int]int64{}
	if info, err := client.Info(ctx, "keyspace").Result(); err == nil {
		for _, line := range strings.Split(info, "\n") {
			line = strings.TrimSpace(line)
			if !strings.HasPrefix(line, "db") {
				continue
			}
			parts := strings.SplitN(line, ":", 2)
			index, _ := strconv.Atoi(strings.TrimPrefix(parts[0], "db"))
			if len(parts) == 2 {
				for _, field := range strings.Split(parts[1], ",") {
					if strings.HasPrefix(field, "keys=") {
						keyCounts[index], _ = strconv.ParseInt(strings.TrimPrefix(field, "keys="), 10, 64)
					}
				}
			}
		}
	}
	out := make([]model.DatabaseInfo, 0, count)
	for index := 0; index < count; index++ {
		out = append(out, model.DatabaseInfo{
			Name:       strconv.Itoa(index),
			TableCount: keyCounts[index],
		})
	}
	return out, nil
}

func (m *Manager) redisObjects(ctx context.Context, conn model.Connection, password, database string) ([]model.ObjectInfo, error) {
	client, err := m.RedisClient(ctx, conn, password, database)
	if err != nil {
		return nil, err
	}
	keys := make([]string, 0, 200)
	cursor := uint64(0)
	for {
		batch, next, err := client.Scan(ctx, cursor, "*", 200).Result()
		if err != nil {
			return nil, err
		}
		keys = append(keys, batch...)
		cursor = next
		if cursor == 0 || len(keys) >= 500 {
			break
		}
	}
	sort.Strings(keys)
	if len(keys) > 500 {
		keys = keys[:500]
	}
	pipe := client.Pipeline()
	typeCmds := make([]*redis.StatusCmd, len(keys))
	ttlCmds := make([]*redis.DurationCmd, len(keys))
	for index, key := range keys {
		typeCmds[index] = pipe.Type(ctx, key)
		ttlCmds[index] = pipe.TTL(ctx, key)
	}
	_, _ = pipe.Exec(ctx)
	out := make([]model.ObjectInfo, 0, len(keys))
	for index, key := range keys {
		keyType := typeCmds[index].Val()
		if keyType == "" {
			keyType = "unknown"
		}
		comment := ""
		switch ttl := ttlCmds[index].Val(); {
		case ttl > 0:
			comment = "TTL " + ttl.Round(time.Second).String()
		case ttl == -1:
			comment = "永久"
		}
		out = append(out, model.ObjectInfo{
			Name:    key,
			Type:    "key",
			Engine:  keyType,
			Rows:    1,
			Comment: comment,
		})
	}
	return out, nil
}

func (m *Manager) RedisKeyInfo(ctx context.Context, conn model.Connection, password, database, key string, cursor uint64, count int64) (*model.RedisKeyInfo, error) {
	client, err := m.RedisClient(ctx, conn, password, database)
	if err != nil {
		return nil, err
	}
	keyType, err := client.Type(ctx, key).Result()
	if err != nil {
		return nil, err
	}
	if keyType == "none" {
		return nil, fmt.Errorf("键 %q 不存在", key)
	}
	if count <= 0 {
		count = 200
	}
	if count > 1000 {
		count = 1000
	}
	ttl, _ := client.TTL(ctx, key).Result()
	info := &model.RedisKeyInfo{Key: key, Type: keyType, TTL: -1}
	if ttl > 0 {
		info.TTL = int64(ttl / time.Second)
	}
	if encoding, err := client.ObjectEncoding(ctx, key).Result(); err == nil {
		info.Encoding = encoding
	}

	switch keyType {
	case "string":
		length, _ := client.StrLen(ctx, key).Result()
		info.Length = length
		const maxStringBytes = 4 << 20
		if length > maxStringBytes {
			info.Value, _ = client.GetRange(ctx, key, 0, maxStringBytes-1).Result()
			info.Truncated = true
		} else {
			info.Value, _ = client.Get(ctx, key).Result()
		}
	case "hash":
		info.Length, _ = client.HLen(ctx, key).Result()
		flat, next, err := client.HScan(ctx, key, cursor, "", count).Result()
		if err != nil {
			return nil, err
		}
		entries := make([]model.RedisHashEntry, 0, len(flat)/2)
		for index := 0; index+1 < len(flat); index += 2 {
			entries = append(entries, model.RedisHashEntry{Field: flat[index], Value: flat[index+1]})
		}
		sort.Slice(entries, func(i, j int) bool { return entries[i].Field < entries[j].Field })
		info.Value = entries
		info.Cursor = next
		info.More = next != 0
	case "list":
		info.Length, _ = client.LLen(ctx, key).Result()
		start := int64(cursor)
		items, err := client.LRange(ctx, key, start, start+count-1).Result()
		if err != nil {
			return nil, err
		}
		info.Value = items
		info.Cursor = uint64(start + int64(len(items)))
		info.More = start+int64(len(items)) < info.Length
	case "set":
		info.Length, _ = client.SCard(ctx, key).Result()
		values, next, err := client.SScan(ctx, key, cursor, "", count).Result()
		if err != nil {
			return nil, err
		}
		sort.Strings(values)
		info.Value = values
		info.Cursor = next
		info.More = next != 0
	case "zset":
		info.Length, _ = client.ZCard(ctx, key).Result()
		start := int64(cursor)
		items, err := client.ZRangeWithScores(ctx, key, start, start+count-1).Result()
		if err != nil {
			return nil, err
		}
		entries := make([]model.RedisZSetEntry, 0, len(items))
		for _, item := range items {
			entries = append(entries, model.RedisZSetEntry{Member: fmt.Sprint(item.Member), Score: item.Score})
		}
		info.Value = entries
		info.Cursor = uint64(start + int64(len(items)))
		info.More = start+int64(len(items)) < info.Length
	case "stream":
		info.Length, _ = client.XLen(ctx, key).Result()
		items, err := client.XRangeN(ctx, key, "-", "+", count).Result()
		if err != nil {
			return nil, err
		}
		entries := make([]model.RedisStreamEntry, 0, len(items))
		for _, item := range items {
			fields := make(map[string]string, len(item.Values))
			for field, value := range item.Values {
				fields[field] = fmt.Sprint(value)
			}
			entries = append(entries, model.RedisStreamEntry{ID: item.ID, Fields: fields})
		}
		info.Value = entries
	default:
		info.Value = nil
	}
	if size, err := client.MemoryUsage(ctx, key, 0).Result(); err == nil {
		info.Size = size
	}
	return info, nil
}

func redisStringValue(value any) string {
	return fmt.Sprint(value)
}

func (m *Manager) RedisSetKey(ctx context.Context, conn model.Connection, password, database, key, keyType string, value any, ttl int64, overwrite bool) error {
	if conn.ReadOnly {
		return fmt.Errorf("当前连接为只读模式")
	}
	if strings.TrimSpace(key) == "" {
		return fmt.Errorf("键名不能为空")
	}
	client, err := m.RedisClient(ctx, conn, password, database)
	if err != nil {
		return err
	}
	if !overwrite {
		exists, err := client.Exists(ctx, key).Result()
		if err != nil {
			return err
		}
		if exists > 0 {
			return fmt.Errorf("键 %q 已存在", key)
		}
	}
	switch keyType {
	case "string":
		if err := client.Set(ctx, key, redisStringValue(value), 0).Err(); err != nil {
			return err
		}
	case "hash":
		fields, ok := value.(map[string]any)
		if !ok {
			return fmt.Errorf("Hash 值必须是 JSON 对象")
		}
		_, err := client.TxPipelined(ctx, func(pipe redis.Pipeliner) error {
			pipe.Del(ctx, key)
			if len(fields) > 0 {
				values := make([]any, 0, len(fields)*2)
				for field, fieldValue := range fields {
					values = append(values, field, redisStringValue(fieldValue))
				}
				pipe.HSet(ctx, key, values...)
			}
			return nil
		})
		if err != nil {
			return err
		}
	case "list", "set":
		items, ok := value.([]any)
		if !ok {
			return fmt.Errorf("%s 值必须是 JSON 数组", keyType)
		}
		_, err := client.TxPipelined(ctx, func(pipe redis.Pipeliner) error {
			pipe.Del(ctx, key)
			if len(items) > 0 {
				if keyType == "list" {
					pipe.RPush(ctx, key, items...)
				} else {
					pipe.SAdd(ctx, key, items...)
				}
			}
			return nil
		})
		if err != nil {
			return err
		}
	case "zset":
		items, ok := value.([]any)
		if !ok {
			return fmt.Errorf("Sorted Set 值必须是 JSON 数组")
		}
		members := make([]redis.Z, 0, len(items))
		for _, item := range items {
			entry, ok := item.(map[string]any)
			if !ok {
				continue
			}
			score := 0.0
			switch typed := entry["score"].(type) {
			case float64:
				score = typed
			case string:
				score, _ = strconv.ParseFloat(typed, 64)
			}
			members = append(members, redis.Z{Score: score, Member: redisStringValue(entry["member"])})
		}
		_, err := client.TxPipelined(ctx, func(pipe redis.Pipeliner) error {
			pipe.Del(ctx, key)
			if len(members) > 0 {
				pipe.ZAdd(ctx, key, members...)
			}
			return nil
		})
		if err != nil {
			return err
		}
	default:
		return fmt.Errorf("暂不支持编辑 %s 类型的键", keyType)
	}
	if ttl > 0 {
		return client.Expire(ctx, key, time.Duration(ttl)*time.Second).Err()
	}
	if ttl == 0 {
		return client.Persist(ctx, key).Err()
	}
	return nil
}

func (m *Manager) RedisDeleteKey(ctx context.Context, conn model.Connection, password, database, key string) error {
	if conn.ReadOnly {
		return fmt.Errorf("当前连接为只读模式")
	}
	client, err := m.RedisClient(ctx, conn, password, database)
	if err != nil {
		return err
	}
	removed, err := client.Unlink(ctx, key).Result()
	if err != nil {
		removed, err = client.Del(ctx, key).Result()
	}
	if err != nil {
		return err
	}
	if removed == 0 {
		return fmt.Errorf("键 %q 不存在", key)
	}
	return nil
}

func splitRedisCommand(input string) ([]string, error) {
	var args []string
	var current strings.Builder
	var quote rune
	escaped := false
	for _, r := range input {
		if escaped {
			current.WriteRune(r)
			escaped = false
			continue
		}
		if r == '\\' {
			escaped = true
			continue
		}
		if quote != 0 {
			if r == quote {
				quote = 0
			} else {
				current.WriteRune(r)
			}
			continue
		}
		switch r {
		case '\'', '"':
			quote = r
		case ' ', '\t', '\n', '\r':
			if current.Len() > 0 {
				args = append(args, current.String())
				current.Reset()
			}
		default:
			current.WriteRune(r)
		}
	}
	if quote != 0 {
		return nil, fmt.Errorf("命令中的引号未闭合")
	}
	if current.Len() > 0 {
		args = append(args, current.String())
	}
	if len(args) == 0 {
		return nil, fmt.Errorf("命令不能为空")
	}
	return args, nil
}

func redisCommandResult(value any) any {
	switch typed := value.(type) {
	case []any:
		out := make([]any, 0, len(typed))
		for _, item := range typed {
			out = append(out, redisCommandResult(item))
		}
		return out
	case map[any]any:
		out := map[string]any{}
		for key, item := range typed {
			out[fmt.Sprint(key)] = redisCommandResult(item)
		}
		return out
	case nil, string, int64, float64, bool:
		return typed
	default:
		return fmt.Sprint(value)
	}
}

func (m *Manager) RedisCommand(ctx context.Context, conn model.Connection, password, database, command string) (*model.RedisCommandResult, error) {
	args, err := splitRedisCommand(command)
	if err != nil {
		return nil, err
	}
	if len(args) > 0 && strings.EqualFold(args[0], "select") {
		return nil, fmt.Errorf("请在界面顶部切换数据库；CLI 不支持 SELECT")
	}
	client, err := m.RedisClient(ctx, conn, password, database)
	if err != nil {
		return nil, err
	}
	values := make([]any, len(args))
	for index, arg := range args {
		values[index] = arg
	}
	result, err := client.Do(ctx, values...).Result()
	if err != nil {
		return nil, err
	}
	return &model.RedisCommandResult{Result: redisCommandResult(result)}, nil
}
