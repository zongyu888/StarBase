package db

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo/options"

	"navideck/backend/internal/model"
)

func mongoDatabaseName(conn model.Connection, database string) (string, error) {
	name := strings.TrimSpace(database)
	if name == "" {
		name = strings.TrimSpace(conn.Database)
	}
	if name == "" {
		return "", fmt.Errorf("请选择 MongoDB 数据库")
	}
	return name, nil
}

func (m *Manager) mongoDatabases(ctx context.Context, conn model.Connection, password string) ([]model.DatabaseInfo, error) {
	client, err := m.MongoClient(ctx, conn, password)
	if err != nil {
		return nil, err
	}
	names, err := client.ListDatabaseNames(ctx, bson.M{})
	if err != nil {
		return nil, err
	}
	sort.Strings(names)
	out := make([]model.DatabaseInfo, 0, len(names))
	for _, name := range names {
		collections, _ := client.Database(name).ListCollectionNames(ctx, bson.M{})
		out = append(out, model.DatabaseInfo{
			Name:       name,
			TableCount: int64(len(collections)),
			IsSystem:   name == "admin" || name == "local" || name == "config",
		})
	}
	return out, nil
}

func (m *Manager) mongoObjects(ctx context.Context, conn model.Connection, password, database string) ([]model.ObjectInfo, error) {
	client, err := m.MongoClient(ctx, conn, password)
	if err != nil {
		return nil, err
	}
	dbName, err := mongoDatabaseName(conn, database)
	if err != nil {
		return nil, err
	}
	names, err := client.Database(dbName).ListCollectionNames(ctx, bson.M{})
	if err != nil {
		return nil, err
	}
	sort.Strings(names)
	out := make([]model.ObjectInfo, 0, len(names))
	for _, name := range names {
		if strings.HasPrefix(name, "system.") {
			continue
		}
		count, _ := client.Database(dbName).Collection(name).EstimatedDocumentCount(ctx)
		out = append(out, model.ObjectInfo{
			Name:   name,
			Type:   "collection",
			Engine: "MongoDB",
			Rows:   count,
		})
	}
	return out, nil
}

func (m *Manager) mongoTableMeta(ctx context.Context, conn model.Connection, password, database, collection string) (*model.TableMeta, error) {
	client, err := m.MongoClient(ctx, conn, password)
	if err != nil {
		return nil, err
	}
	dbName, err := mongoDatabaseName(conn, database)
	if err != nil {
		return nil, err
	}
	coll := client.Database(dbName).Collection(collection)
	count, _ := coll.EstimatedDocumentCount(ctx)

	cursor, err := coll.Find(ctx, bson.M{}, options.Find().SetLimit(80))
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)
	var docs []bson.M
	if err := cursor.All(ctx, &docs); err != nil {
		return nil, err
	}

	fields := map[string]map[string]int{}
	for _, doc := range docs {
		for name, value := range doc {
			if fields[name] == nil {
				fields[name] = map[string]int{}
			}
			fields[name][mongoTypeName(value)]++
		}
	}
	names := make([]string, 0, len(fields))
	for name := range fields {
		if name != "_id" {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	names = append([]string{"_id"}, names...)
	columns := make([]model.ColumnInfo, 0, len(names))
	for index, name := range names {
		types := fields[name]
		dataType := "mixed"
		if len(types) == 0 {
			dataType = "objectId"
		} else if len(types) == 1 {
			for typ := range types {
				dataType = typ
			}
		}
		column := model.ColumnInfo{
			Name:       name,
			DataType:   dataType,
			ColumnType: dataType,
			Nullable:   true,
			Position:   index + 1,
		}
		if name == "_id" {
			column.Key = "PRI"
			column.Nullable = false
		}
		columns = append(columns, column)
	}
	meta := &model.TableMeta{
		Database:    dbName,
		Name:        collection,
		Type:        "collection",
		Engine:      "MongoDB",
		Rows:        count,
		Columns:     columns,
		Indexes:     []model.IndexInfo{{Name: "_id_", Columns: []string{"_id"}, Unique: true, Primary: true, Type: "btree"}},
		ForeignKeys: []model.ForeignKeyInfo{},
		PrimaryKey:  []string{"_id"},
		Editable:    !conn.ReadOnly,
	}
	meta.DDL = fmt.Sprintf("// MongoDB 集合：%s\n// 字段由前 %d 条文档推断；集合结构可变。", collection, len(docs))
	return meta, nil
}

func mongoTypeName(value any) string {
	switch value.(type) {
	case nil:
		return "null"
	case string:
		return "string"
	case bool:
		return "boolean"
	case int, int32, int64, float32, float64, primitive.Decimal128:
		return "number"
	case primitive.DateTime, time.Time:
		return "date"
	case primitive.ObjectID:
		return "objectId"
	case primitive.Binary:
		return "binary"
	case bson.M, bson.D, map[string]any:
		return "object"
	case bson.A, []any:
		return "array"
	default:
		return fmt.Sprintf("%T", value)
	}
}

func mongoJSONValue(value any) any {
	switch typed := value.(type) {
	case primitive.ObjectID:
		return typed.Hex()
	case primitive.DateTime:
		return typed.Time().Format("2006-01-02 15:04:05")
	case time.Time:
		return typed.Format("2006-01-02 15:04:05")
	case primitive.Decimal128:
		return typed.String()
	case primitive.Binary:
		return fmt.Sprintf("0x%x", typed.Data)
	case primitive.Timestamp:
		return typed.T
	case bson.M, bson.D, bson.A, map[string]any, []any:
		if raw, err := json.Marshal(typed); err == nil {
			return string(raw)
		}
		return fmt.Sprint(typed)
	default:
		return value
	}
}

func mongoDocumentRow(doc bson.M, columns []model.ColumnInfo) []any {
	row := make([]any, len(columns))
	for index, column := range columns {
		row[index] = mongoJSONValue(doc[column.Name])
	}
	return row
}

func mongoConvertValue(dataType, raw string) any {
	if raw == "" {
		return nil
	}
	switch dataType {
	case "number":
		if value, err := strconv.ParseInt(raw, 10, 64); err == nil {
			return value
		}
		if value, err := strconv.ParseFloat(raw, 64); err == nil {
			return value
		}
		return raw
	case "boolean":
		value, _ := strconv.ParseBool(raw)
		return value
	case "objectId":
		if id, err := primitive.ObjectIDFromHex(raw); err == nil {
			return id
		}
		return raw
	case "date":
		for _, layout := range []string{time.RFC3339, "2006-01-02 15:04:05", "2006-01-02"} {
			if value, err := time.ParseInLocation(layout, raw, time.Local); err == nil {
				return primitive.NewDateTimeFromTime(value)
			}
		}
		return raw
	case "object", "array":
		var parsed any
		if err := json.Unmarshal([]byte(raw), &parsed); err == nil {
			return parsed
		}
		return raw
	default:
		return raw
	}
}

func mongoID(value any) any {
	if text, ok := value.(string); ok {
		if id, err := primitive.ObjectIDFromHex(text); err == nil {
			return id
		}
	}
	return value
}

func mongoFilter(filters []model.Filter, columns []model.ColumnInfo) (bson.M, error) {
	if len(filters) == 0 {
		return bson.M{}, nil
	}
	columnMap := map[string]model.ColumnInfo{}
	for _, column := range columns {
		columnMap[column.Name] = column
	}
	clauses := make([]bson.M, 0, len(filters))
	for _, filter := range filters {
		column, ok := columnMap[filter.Column]
		if !ok {
			return nil, fmt.Errorf("筛选字段 %q 不存在", filter.Column)
		}
		op := strings.ToLower(strings.TrimSpace(filter.Operator))
		switch op {
		case "eq", "=":
			clauses = append(clauses, bson.M{column.Name: mongoConvertValue(column.DataType, filter.Value)})
		case "neq", "!=", "<>":
			clauses = append(clauses, bson.M{column.Name: bson.M{"$ne": mongoConvertValue(column.DataType, filter.Value)}})
		case "gt", ">":
			clauses = append(clauses, bson.M{column.Name: bson.M{"$gt": mongoConvertValue(column.DataType, filter.Value)}})
		case "gte", ">=":
			clauses = append(clauses, bson.M{column.Name: bson.M{"$gte": mongoConvertValue(column.DataType, filter.Value)}})
		case "lt", "<":
			clauses = append(clauses, bson.M{column.Name: bson.M{"$lt": mongoConvertValue(column.DataType, filter.Value)}})
		case "lte", "<=":
			clauses = append(clauses, bson.M{column.Name: bson.M{"$lte": mongoConvertValue(column.DataType, filter.Value)}})
		case "contains", "like":
			clauses = append(clauses, bson.M{column.Name: primitive.Regex{Pattern: regexp.QuoteMeta(filter.Value), Options: "i"}})
		case "starts_with":
			clauses = append(clauses, bson.M{column.Name: primitive.Regex{Pattern: "^" + regexp.QuoteMeta(filter.Value), Options: "i"}})
		case "ends_with":
			clauses = append(clauses, bson.M{column.Name: primitive.Regex{Pattern: regexp.QuoteMeta(filter.Value) + "$", Options: "i"}})
		case "is_null", "isnull":
			clauses = append(clauses, bson.M{column.Name: nil})
		case "is_not_null", "isnotnull":
			clauses = append(clauses, bson.M{column.Name: bson.M{"$ne": nil}})
		default:
			return nil, fmt.Errorf("不支持的筛选操作符 %q", filter.Operator)
		}
	}
	if len(clauses) == 1 {
		return clauses[0], nil
	}
	return bson.M{"$and": clauses}, nil
}

func (m *Manager) mongoTableRows(ctx context.Context, conn model.Connection, password, database, collection string, page, pageSize int, sortColumn, sortDir string, filters []model.Filter) (*model.RowsResponse, error) {
	meta, err := m.mongoTableMeta(ctx, conn, password, database, collection)
	if err != nil {
		return nil, err
	}
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 100
	}
	if pageSize > 1000 {
		pageSize = 1000
	}
	client, err := m.MongoClient(ctx, conn, password)
	if err != nil {
		return nil, err
	}
	dbName, err := mongoDatabaseName(conn, database)
	if err != nil {
		return nil, err
	}
	filter, err := mongoFilter(filters, meta.Columns)
	if err != nil {
		return nil, err
	}
	coll := client.Database(dbName).Collection(collection)
	total, err := coll.CountDocuments(ctx, filter)
	if err != nil {
		return nil, err
	}
	findOptions := options.Find().SetSkip(int64((page - 1) * pageSize)).SetLimit(int64(pageSize))
	if sortColumn != "" {
		direction := 1
		if strings.EqualFold(sortDir, "desc") {
			direction = -1
		}
		findOptions.SetSort(bson.D{{Key: sortColumn, Value: direction}})
	}
	cursor, err := coll.Find(ctx, filter, findOptions)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)
	var docs []bson.M
	if err := cursor.All(ctx, &docs); err != nil {
		return nil, err
	}
	rows := make([][]any, 0, len(docs))
	for _, doc := range docs {
		rows = append(rows, mongoDocumentRow(doc, meta.Columns))
	}
	return &model.RowsResponse{
		Columns:     meta.Columns,
		Rows:        rows,
		Total:       total,
		Page:        page,
		PageSize:    pageSize,
		PrimaryKeys: meta.PrimaryKey,
		Editable:    meta.Editable,
	}, nil
}

func (m *Manager) mongoInsertRow(ctx context.Context, conn model.Connection, password, database, collection string, values map[string]any) (model.MutationResult, error) {
	if conn.ReadOnly {
		return model.MutationResult{}, fmt.Errorf("当前连接为只读模式")
	}
	meta, err := m.mongoTableMeta(ctx, conn, password, database, collection)
	if err != nil {
		return model.MutationResult{}, err
	}
	columnMap := map[string]model.ColumnInfo{}
	for _, column := range meta.Columns {
		columnMap[column.Name] = column
	}
	doc := bson.M{}
	for name, value := range values {
		if name == "_id" && (value == nil || value == "") {
			continue
		}
		if name == "_id" {
			doc[name] = mongoID(value)
			continue
		}
		column, ok := columnMap[name]
		if !ok {
			continue
		}
		if text, ok := value.(string); ok {
			doc[name] = mongoConvertValue(column.DataType, text)
		} else {
			doc[name] = value
		}
	}
	client, err := m.MongoClient(ctx, conn, password)
	if err != nil {
		return model.MutationResult{}, err
	}
	dbName, err := mongoDatabaseName(conn, database)
	if err != nil {
		return model.MutationResult{}, err
	}
	if _, err := client.Database(dbName).Collection(collection).InsertOne(ctx, doc); err != nil {
		return model.MutationResult{}, err
	}
	return model.MutationResult{AffectedRows: 1}, nil
}

func (m *Manager) mongoUpdateRow(ctx context.Context, conn model.Connection, password, database, collection string, keys, changes map[string]any) (model.MutationResult, error) {
	if conn.ReadOnly {
		return model.MutationResult{}, fmt.Errorf("当前连接为只读模式")
	}
	id, ok := keys["_id"]
	if !ok {
		return model.MutationResult{}, fmt.Errorf("缺少 _id")
	}
	meta, err := m.mongoTableMeta(ctx, conn, password, database, collection)
	if err != nil {
		return model.MutationResult{}, err
	}
	columnMap := map[string]model.ColumnInfo{}
	for _, column := range meta.Columns {
		columnMap[column.Name] = column
	}
	set := bson.M{}
	for name, value := range changes {
		if name == "_id" {
			continue
		}
		column, ok := columnMap[name]
		if !ok {
			continue
		}
		if text, ok := value.(string); ok {
			set[name] = mongoConvertValue(column.DataType, text)
		} else {
			set[name] = value
		}
	}
	if len(set) == 0 {
		return model.MutationResult{}, fmt.Errorf("没有需要更新的字段")
	}
	client, err := m.MongoClient(ctx, conn, password)
	if err != nil {
		return model.MutationResult{}, err
	}
	dbName, err := mongoDatabaseName(conn, database)
	if err != nil {
		return model.MutationResult{}, err
	}
	result, err := client.Database(dbName).Collection(collection).UpdateOne(ctx, bson.M{"_id": mongoID(id)}, bson.M{"$set": set})
	if err != nil {
		return model.MutationResult{}, err
	}
	return model.MutationResult{AffectedRows: result.ModifiedCount}, nil
}

func (m *Manager) mongoDeleteRow(ctx context.Context, conn model.Connection, password, database, collection string, keys map[string]any) (model.MutationResult, error) {
	if conn.ReadOnly {
		return model.MutationResult{}, fmt.Errorf("当前连接为只读模式")
	}
	id, ok := keys["_id"]
	if !ok {
		return model.MutationResult{}, fmt.Errorf("缺少 _id")
	}
	client, err := m.MongoClient(ctx, conn, password)
	if err != nil {
		return model.MutationResult{}, err
	}
	dbName, err := mongoDatabaseName(conn, database)
	if err != nil {
		return model.MutationResult{}, err
	}
	result, err := client.Database(dbName).Collection(collection).DeleteOne(ctx, bson.M{"_id": mongoID(id)})
	if err != nil {
		return model.MutationResult{}, err
	}
	return model.MutationResult{AffectedRows: result.DeletedCount}, nil
}

func (m *Manager) mongoExportRows(ctx context.Context, conn model.Connection, password, database, collection string, limit int, sortColumn, sortDir string, filters []model.Filter) ([]string, [][]any, error) {
	meta, err := m.mongoTableMeta(ctx, conn, password, database, collection)
	if err != nil {
		return nil, nil, err
	}
	if limit <= 0 || limit > 200000 {
		limit = 200000
	}
	client, err := m.MongoClient(ctx, conn, password)
	if err != nil {
		return nil, nil, err
	}
	dbName, err := mongoDatabaseName(conn, database)
	if err != nil {
		return nil, nil, err
	}
	filter, err := mongoFilter(filters, meta.Columns)
	if err != nil {
		return nil, nil, err
	}
	findOptions := options.Find().SetLimit(int64(limit))
	if sortColumn != "" {
		direction := 1
		if strings.EqualFold(sortDir, "desc") {
			direction = -1
		}
		findOptions.SetSort(bson.D{{Key: sortColumn, Value: direction}})
	}
	cursor, err := client.Database(dbName).Collection(collection).Find(ctx, filter, findOptions)
	if err != nil {
		return nil, nil, err
	}
	defer cursor.Close(ctx)
	var docs []bson.M
	if err := cursor.All(ctx, &docs); err != nil {
		return nil, nil, err
	}
	names := make([]string, len(meta.Columns))
	for index, column := range meta.Columns {
		names[index] = column.Name
	}
	rows := make([][]any, 0, len(docs))
	for _, doc := range docs {
		rows = append(rows, mongoDocumentRow(doc, meta.Columns))
	}
	return names, rows, nil
}

func (m *Manager) mongoDropCollection(ctx context.Context, conn model.Connection, password, database, collection string) (model.MutationResult, error) {
	if conn.ReadOnly {
		return model.MutationResult{}, fmt.Errorf("当前连接为只读模式")
	}
	client, err := m.MongoClient(ctx, conn, password)
	if err != nil {
		return model.MutationResult{}, err
	}
	dbName, err := mongoDatabaseName(conn, database)
	if err != nil {
		return model.MutationResult{}, err
	}
	if err := client.Database(dbName).Collection(collection).Drop(ctx); err != nil {
		return model.MutationResult{}, err
	}
	return model.MutationResult{DDL: "drop collection " + collection}, nil
}
