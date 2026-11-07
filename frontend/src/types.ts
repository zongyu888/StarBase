export type Driver = 'mysql' | 'mariadb' | 'postgres' | 'sqlite' | 'sqlserver' | 'oracle' | 'snowflake' | 'mongodb' | 'redis' | 'chroma';
export type ObjectType = 'table' | 'view' | 'collection' | 'key';
export type CellValue = string | number | boolean | null;

export interface Connection {
  id: string;
  ownerId?: string;
  name: string;
  driver: Driver;
  host?: string;
  port?: number;
  username?: string;
  database?: string;
  sslMode?: string;
  sqlitePath?: string;
  instance?: string;
  oracleSid?: string;
  oracleWallet?: string;
  account?: string;
  warehouse?: string;
  role?: string;
  defaultSchema?: string;
  authSource?: string;
  tenant?: string;
  template?: string;
  color: string;
  group?: string;
  readOnly: boolean;
  connected: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectionInput {
  name: string;
  driver: Driver;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  database?: string;
  sslMode?: string;
  sqlitePath?: string;
  instance?: string;
  oracleSid?: string;
  oracleWallet?: string;
  account?: string;
  warehouse?: string;
  role?: string;
  defaultSchema?: string;
  authSource?: string;
  tenant?: string;
  template?: string;
  color?: string;
  group?: string;
  readOnly?: boolean;
}

export interface TestConnectionResult {
  ok: boolean;
  latencyMs: number;
  message?: string;
  server?: string;
}

export interface DatabaseInfo {
  name: string;
  charset?: string;
  collation?: string;
  tableCount: number;
  sizeBytes: number;
  isSystem?: boolean;
}

export interface ObjectInfo {
  id?: string;
  name: string;
  type: ObjectType;
  engine?: string;
  rows: number;
  sizeBytes: number;
  comment?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ColumnInfo {
  name: string;
  dataType: string;
  columnType: string;
  nullable: boolean;
  defaultValue: string | null;
  key?: string;
  extra?: string;
  comment?: string;
  position: number;
  length?: number;
  precision?: number;
  scale?: number;
  generated?: boolean;
}

export interface IndexInfo {
  name: string;
  columns: string[];
  unique: boolean;
  primary: boolean;
  type?: string;
  comment?: string;
}

export interface ForeignKeyInfo {
  name: string;
  columns: string[];
  refSchema?: string;
  refTable: string;
  refColumns: string[];
  onDelete?: string;
  onUpdate?: string;
}

export interface TableMeta {
  database: string;
  schema: string;
  name: string;
  type: ObjectType;
  engine?: string;
  rows: number;
  sizeBytes: number;
  comment?: string;
  createdAt?: string;
  updatedAt?: string;
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  foreignKeys: ForeignKeyInfo[];
  primaryKey: string[];
  ddl: string;
  editable: boolean;
}

export interface ResultColumn {
  name: string;
  databaseType?: string;
  scanType?: string;
  nullable: boolean;
}

export interface QueryResult {
  index: number;
  statement: string;
  kind: 'rows' | 'exec';
  columns?: ResultColumn[];
  rows?: CellValue[][];
  rowCount: number;
  affectedRows: number;
  lastInsertId?: number;
  durationMs: number;
  truncated: boolean;
  error?: string;
}

export interface QueryResponse {
  results: QueryResult[];
  durationMs: number;
  database?: string;
}

export interface Filter {
  column: string;
  operator: string;
  value: string;
}

export interface RowsResponse {
  columns: ColumnInfo[];
  rows: CellValue[][];
  total: number;
  page: number;
  pageSize: number;
  primaryKeys: string[];
  editable: boolean;
}

export interface MutationResult {
  affectedRows: number;
  lastInsertId?: number;
  ddl?: string;
}

export interface BatchRowUpdate {
  keys: Record<string, CellValue>;
  changes: Record<string, CellValue>;
}

export interface BatchRowsRequest {
  database: string;
  schema: string;
  table: string;
  updates: BatchRowUpdate[];
  inserts: Array<Record<string, CellValue>>;
  deletes: Array<Record<string, CellValue>>;
}

export interface BatchRowsResult {
  updated: number;
  inserted: number;
  deleted: number;
}

export interface NewColumn {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue: string | null;
  primaryKey: boolean;
  autoIncrement: boolean;
  comment: string;
}

export interface CreateTableRequest {
  database: string;
  schema: string;
  name: string;
  comment: string;
  columns: NewColumn[];
}

export interface AlterTableRequest {
  database: string;
  schema: string;
  table: string;
  action:
    | 'add_column'
    | 'drop_column'
    | 'rename_column'
    | 'modify_column'
    | 'rename_table'
    | 'set_table_comment'
    | 'add_index'
    | 'drop_index'
    | 'add_foreign_key'
    | 'drop_foreign_key';
  column?: NewColumn;
  name?: string;
  newName?: string;
  comment?: string;
  columns?: string[];
  unique?: boolean;
  foreignKey?: ForeignKeyInput;
}

export interface ForeignKeyInput {
  name: string;
  columns: string[];
  refSchema?: string;
  refTable: string;
  refColumns: string[];
  onDelete?: string;
  onUpdate?: string;
}

export interface ImportMapping {
  csvColumn: string;
  tableColumn: string;
}

export interface ImportCsvOptions {
  delimiter?: string;
  emptyAsNull: boolean;
  nullValue?: string;
  mapping?: ImportMapping[];
}

export interface SavedQuery {
  id: string;
  ownerId?: string;
  name: string;
  connectionId: string;
  database: string;
  schema: string;
  sql: string;
  createdAt: string;
  updatedAt: string;
}

export interface SavedQueryInput {
  name: string;
  connectionId: string;
  database: string;
  schema: string;
  sql: string;
}

export interface TableTarget {
  connectionId: string;
  database: string;
  schema: string;
  table: string;
}

export interface HealthInfo {
  ok: boolean;
  version: string;
  drivers: string[];
  uptimeMs: number;
  desktop?: boolean;
}

export type UserRole = 'ADMIN' | 'USER';

export interface UserProfile {
  id: string;
  username: string;
  email: string;
  displayName: string;
  role: UserRole;
  enabled: boolean;
  emailVerified: boolean;
  createdAt: string;
  lastLoginAt?: string;
}

export interface AuthStatus {
  authEnabled: boolean;
  registrationEnabled: boolean;
  mailConfigured: boolean;
  devCodes: boolean;
  hasUsers: boolean;
}

export interface AuthResponse {
  user: UserProfile;
}

export interface CaptchaChallenge {
  captchaId: string;
  imageBase64: string;
  devCode?: string;
}

export interface EmailCodeResponse {
  ok: boolean;
  message: string;
  devCode?: string;
}

export interface RegisterInput {
  username: string;
  email: string;
  displayName?: string;
  password: string;
  verifyCode: string;
  captchaId: string;
  captchaCode: string;
}

export interface LoginInput {
  login: string;
  password: string;
  captchaId: string;
  captchaCode: string;
}

export interface ResetPasswordInput {
  email: string;
  verifyCode: string;
  newPassword: string;
  captchaId: string;
  captchaCode: string;
}

export type Theme = 'dark' | 'light';

export interface WelcomeTab {
  id: 'welcome';
  kind: 'welcome';
  title: string;
}

export interface QueryTab {
  id: string;
  kind: 'query';
  title: string;
  connectionId: string;
  database: string;
  schema: string;
  sql: string;
  seq: number;
}

export interface TableTab {
  id: string;
  kind: 'table';
  title: string;
  connectionId: string;
  database: string;
  schema: string;
  table: string;
  objectType: ObjectType;
  mode: 'data' | 'structure' | 'design';
}

export interface RedisTab {
  id: string;
  kind: 'redis';
  title: string;
  connectionId: string;
  database: string;
  key?: string;
}

export interface ChromaTab {
  id: string;
  kind: 'chroma';
  title: string;
  connectionId: string;
  database: string;
  collection?: string;
  collectionId?: string;
}

export type Tab = WelcomeTab | QueryTab | TableTab | RedisTab | ChromaTab;

export interface QueryHistoryItem {
  id: string;
  connectionId: string;
  connectionName: string;
  database: string;
  sql: string;
  at: number;
  durationMs: number;
  success: boolean;
  rows: number;
}

export interface RedisHashEntry {
  field: string;
  value: string;
}

export interface RedisZSetEntry {
  member: string;
  score: number;
}

export interface RedisStreamEntry {
  id: string;
  fields: Record<string, string>;
}

export interface RedisKeyInfo {
  key: string;
  type: string;
  ttl: number;
  value: unknown;
  size?: number;
  encoding?: string;
  length: number;
  cursor?: number;
  more?: boolean;
  truncated?: boolean;
}

export interface RedisKeyMeta {
  key: string;
  type: string;
}

export interface RedisKeysPage {
  keys: RedisKeyMeta[];
  cursor: number;
  done: boolean;
  scanned: number;
}

export interface RedisDBStats {
  db: number;
  keys: number;
  expires: number;
  avgTtl: number;
}

export interface RedisInfo {
  raw: Record<string, string>;
  keyspace: RedisDBStats[];
}

export interface RedisDeleteKeysResult {
  deleted: number;
  scanned: number;
  truncated: boolean;
}

export interface RedisEntryInput {
  database: string;
  key: string;
  action: 'set' | 'delete' | 'add' | 'push';
  field?: string;
  value?: string;
  member?: string;
  score?: number;
  index?: number;
  id?: string;
  fields?: Record<string, unknown>;
  left?: boolean;
}

export interface RedisCommandResult {
  result: unknown;
}
export interface ChromaCollection {
  id: string;
  name: string;
  metadata?: Record<string, unknown>;
  hnsw?: Record<string, unknown>;
  count: number;
  dimension?: number;
  version?: number;
  tenant?: string;
  database?: string;
  distance?: string;
  configuration?: Record<string, unknown>;
}

export interface ChromaDocument {
  id: string;
  document?: string;
  metadata?: Record<string, unknown>;
  embedding?: number[];
  distance?: number;
}

export interface ChromaDocumentInput {
  id: string;
  document?: string;
  metadata?: Record<string, unknown>;
  embedding?: number[];
}

export interface ChromaDocumentsPage {
  documents: ChromaDocument[];
  total: number;
  limit: number;
  offset: number;
}

export interface ChromaInfo {
  version?: string;
  heartbeat: boolean;
  tenant: string;
  database: string;
  server?: string;
}

export interface ChromaQueryResult {
  documents: ChromaDocument[];
}
