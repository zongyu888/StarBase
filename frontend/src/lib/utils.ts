import type { Connection, Driver } from '../types';

export function isDesktopShell(): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.protocol === 'wails:' || window.location.hostname === 'wails.localhost';
}

export const DRIVER_META: Record<Driver, { label: string; short: string; color: string; defaultPort: number; description: string }> = {
  mysql: { label: 'MySQL', short: 'MY', color: '#4f8ef7', defaultPort: 3306, description: 'MySQL 5.7+ / 8.x' },
  mariadb: { label: 'MariaDB', short: 'MA', color: '#c0765a', defaultPort: 3306, description: 'MySQL 兼容' },
  postgres: { label: 'PostgreSQL', short: 'PG', color: '#3b82c4', defaultPort: 5432, description: 'PostgreSQL 12+' },
  sqlite: { label: 'SQLite', short: 'SQ', color: '#e8a33d', defaultPort: 0, description: '本地单文件数据库' },
  sqlserver: { label: 'SQL Server', short: 'MS', color: '#e05a5a', defaultPort: 1433, description: 'SQL Server 2016+ / Azure SQL' },
  oracle: { label: 'Oracle', short: 'OR', color: '#d94f70', defaultPort: 1521, description: 'Oracle 12c+ / Cloud' },
  snowflake: { label: 'Snowflake', short: 'SF', color: '#29b5e8', defaultPort: 443, description: '云数据仓库' },
  mongodb: { label: 'MongoDB', short: 'MG', color: '#10aa50', defaultPort: 27017, description: '文档数据库' },
  redis: { label: 'Redis', short: 'RD', color: '#d82c20', defaultPort: 6379, description: '键值数据库' },
  chroma: { label: 'Chroma', short: 'CH', color: '#7c5cf0', defaultPort: 8000, description: '向量数据库' },
};

export function driverHasSchemas(driver: Driver): boolean {
  return driver === 'postgres' || driver === 'sqlserver' || driver === 'oracle' || driver === 'snowflake';
}

export function driverSupportsSQLQuery(driver: Driver): boolean {
  return driver !== 'mongodb' && driver !== 'redis' && driver !== 'chroma';
}

export function driverSupportsTableDesign(driver: Driver): boolean {
  return driver !== 'mongodb' && driver !== 'redis' && driver !== 'chroma';
}

export function driverSupportsImportExport(driver: Driver): boolean {
  return driver !== 'mongodb' && driver !== 'redis' && driver !== 'chroma';
}

export function driverSupportsIndexes(driver: Driver): boolean {
  return driver !== 'snowflake' && driver !== 'mongodb' && driver !== 'redis' && driver !== 'chroma';
}

export const DRIVER_TYPE_PRESETS: Record<Driver, string[]> = {
  mysql: ['INT', 'BIGINT', 'VARCHAR(255)', 'TEXT', 'DECIMAL(10,2)', 'DATETIME', 'TIMESTAMP', 'DATE', 'BOOLEAN', 'JSON', 'BLOB'],
  mariadb: ['INT', 'BIGINT', 'VARCHAR(255)', 'TEXT', 'DECIMAL(10,2)', 'DATETIME', 'TIMESTAMP', 'DATE', 'BOOLEAN', 'JSON', 'BLOB'],
  postgres: ['INTEGER', 'BIGINT', 'VARCHAR(255)', 'TEXT', 'NUMERIC(10,2)', 'TIMESTAMP', 'TIMESTAMPTZ', 'DATE', 'BOOLEAN', 'JSONB', 'UUID', 'BYTEA'],
  sqlite: ['INTEGER', 'TEXT', 'REAL', 'NUMERIC', 'VARCHAR(255)', 'DATETIME', 'BOOLEAN', 'BLOB'],
  sqlserver: ['INT', 'BIGINT', 'NVARCHAR(255)', 'NVARCHAR(MAX)', 'DECIMAL(10,2)', 'DATETIME2', 'DATE', 'BIT', 'UNIQUEIDENTIFIER', 'VARBINARY(MAX)'],
  oracle: ['NUMBER(19)', 'NUMBER(10)', 'VARCHAR2(255)', 'CLOB', 'NUMBER(10,2)', 'TIMESTAMP(6)', 'DATE', 'CHAR(1)', 'BLOB', 'RAW(16)'],
  snowflake: ['NUMBER(38,0)', 'NUMBER(10,2)', 'VARCHAR(16777216)', 'VARCHAR(255)', 'BOOLEAN', 'DATE', 'TIMESTAMP_NTZ', 'TIMESTAMP_TZ', 'VARIANT', 'OBJECT', 'ARRAY'],
  mongodb: ['string', 'number', 'boolean', 'date', 'objectId', 'object', 'array'],
  redis: ['string', 'hash', 'list', 'set', 'zset', 'stream'],
  chroma: ['document', 'metadata', 'embedding'],
};

export function isMySQLFamily(driver: Driver): boolean {
  return driver === 'mysql' || driver === 'mariadb';
}

export function driverSupportsCreateDatabase(driver: Driver): boolean {
  return driver === 'mysql' || driver === 'mariadb' || driver === 'postgres' || driver === 'sqlserver' || driver === 'snowflake';
}

export function defaultSchemaFor(driver: Driver, connection?: Pick<Connection, 'username' | 'defaultSchema'>, database?: string): string {
  switch (driver) {
    case 'postgres':
      return 'public';
    case 'sqlserver':
      return 'dbo';
    case 'oracle':
      return (connection?.username ?? '').toUpperCase();
    case 'snowflake':
      return connection?.defaultSchema || 'PUBLIC';
    case 'sqlite':
      return 'main';
    case 'mongodb':
    case 'redis':
    case 'chroma':
      return '';
    default:
      return database ?? '';
  }
}

export interface ConnectionTemplate {
  id: string;
  label: string;
  group: string;
  driver: Driver;
  port: number;
  sslMode: string;
  description: string;
}

export const CONNECTION_TEMPLATES: ConnectionTemplate[] = [
  { id: 'custom', label: '自建 / 本地数据库', group: '通用', driver: 'mysql', port: 3306, sslMode: 'disable', description: '手动选择引擎与连接参数' },
  { id: 'mariadb', label: 'MariaDB', group: '通用', driver: 'mariadb', port: 3306, sslMode: 'disable', description: 'MySQL 兼容，使用 MariaDB 标识' },
  { id: 'snowflake', label: 'Snowflake', group: '通用', driver: 'snowflake', port: 443, sslMode: 'require', description: '云数据仓库，使用账户标识/仓库/角色' },
  { id: 'mongodb', label: 'MongoDB', group: '通用', driver: 'mongodb', port: 27017, sslMode: 'disable', description: '文档数据库，集合文档浏览' },
  { id: 'redis', label: 'Redis', group: '通用', driver: 'redis', port: 6379, sslMode: 'disable', description: '键值数据库，键浏览/编辑' },
  { id: 'chroma', label: 'Chroma 向量数据库', group: '通用', driver: 'chroma', port: 8000, sslMode: 'disable', description: '集合、文档、向量检索与元数据过滤' },
  { id: 'aws-mysql', label: 'Amazon RDS / Aurora (MySQL)', group: 'Amazon AWS', driver: 'mysql', port: 3306, sslMode: 'require', description: '预填 MySQL + TLS' },
  { id: 'aws-postgres', label: 'Amazon RDS / Aurora (PostgreSQL)', group: 'Amazon AWS', driver: 'postgres', port: 5432, sslMode: 'require', description: '预填 PostgreSQL + TLS' },
  { id: 'aws-sqlserver', label: 'Amazon RDS (SQL Server)', group: 'Amazon AWS', driver: 'sqlserver', port: 1433, sslMode: 'require', description: '预填 SQL Server + 加密' },
  { id: 'aws-redshift', label: 'Amazon Redshift', group: 'Amazon AWS', driver: 'postgres', port: 5439, sslMode: 'require', description: 'PostgreSQL 协议，Redshift 端口 5439' },
  { id: 'aws-documentdb', label: 'Amazon DocumentDB (MongoDB)', group: 'Amazon AWS', driver: 'mongodb', port: 27017, sslMode: 'require', description: 'MongoDB 兼容文档数据库' },
  { id: 'aws-elasticache', label: 'Amazon ElastiCache (Redis)', group: 'Amazon AWS', driver: 'redis', port: 6379, sslMode: 'require', description: 'Redis 兼容缓存' },
  { id: 'azure-mysql', label: 'Azure Database for MySQL', group: 'Microsoft Azure', driver: 'mysql', port: 3306, sslMode: 'require', description: '预填 MySQL + TLS' },
  { id: 'azure-postgres', label: 'Azure Database for PostgreSQL', group: 'Microsoft Azure', driver: 'postgres', port: 5432, sslMode: 'require', description: '预填 PostgreSQL + TLS' },
  { id: 'azure-sql', label: 'Azure SQL Database', group: 'Microsoft Azure', driver: 'sqlserver', port: 1433, sslMode: 'require', description: '预填 SQL Server + 加密' },
  { id: 'azure-cosmos-mongo', label: 'Azure Cosmos DB (MongoDB API)', group: 'Microsoft Azure', driver: 'mongodb', port: 10255, sslMode: 'require', description: 'MongoDB API' },
  { id: 'azure-redis', label: 'Azure Cache for Redis', group: 'Microsoft Azure', driver: 'redis', port: 6380, sslMode: 'require', description: 'Redis 缓存' },
  { id: 'gcp-mysql', label: 'Google Cloud SQL (MySQL)', group: 'Google Cloud', driver: 'mysql', port: 3306, sslMode: 'require', description: '预填 MySQL + TLS' },
  { id: 'gcp-postgres', label: 'Google Cloud SQL (PostgreSQL)', group: 'Google Cloud', driver: 'postgres', port: 5432, sslMode: 'require', description: '预填 PostgreSQL + TLS' },
  { id: 'gcp-sqlserver', label: 'Google Cloud SQL (SQL Server)', group: 'Google Cloud', driver: 'sqlserver', port: 1433, sslMode: 'require', description: '预填 SQL Server + 加密' },
  { id: 'gcp-redis', label: 'Google Cloud Memorystore (Redis)', group: 'Google Cloud', driver: 'redis', port: 6379, sslMode: 'require', description: 'Redis 缓存' },
  { id: 'oracle-cloud', label: 'Oracle Cloud Autonomous Database', group: 'Oracle Cloud', driver: 'oracle', port: 1521, sslMode: 'require', description: '预填 Oracle + TLS，可填写 Wallet 目录' },
  { id: 'oracle-mysql-heatwave', label: 'Oracle MySQL HeatWave', group: 'Oracle Cloud', driver: 'mysql', port: 3306, sslMode: 'require', description: 'MySQL 兼容' },
  { id: 'aliyun-mysql', label: '阿里云 RDS MySQL', group: '阿里云', driver: 'mysql', port: 3306, sslMode: 'require', description: '预填 MySQL + TLS' },
  { id: 'aliyun-postgres', label: '阿里云 RDS PostgreSQL', group: '阿里云', driver: 'postgres', port: 5432, sslMode: 'require', description: '预填 PostgreSQL + TLS' },
  { id: 'aliyun-sqlserver', label: '阿里云 RDS SQL Server', group: '阿里云', driver: 'sqlserver', port: 1433, sslMode: 'require', description: '预填 SQL Server + 加密' },
  { id: 'aliyun-mongodb', label: '阿里云 RDS MongoDB', group: '阿里云', driver: 'mongodb', port: 3717, sslMode: 'require', description: 'MongoDB 文档数据库' },
  { id: 'aliyun-redis', label: '阿里云 RDS Redis', group: '阿里云', driver: 'redis', port: 6379, sslMode: 'require', description: 'Redis 兼容缓存' },
  { id: 'aliyun-polardb-mysql', label: '阿里云 PolarDB MySQL', group: '阿里云', driver: 'mysql', port: 3306, sslMode: 'require', description: 'MySQL 兼容云原生数据库' },
  { id: 'aliyun-polardb-postgres', label: '阿里云 PolarDB PostgreSQL', group: '阿里云', driver: 'postgres', port: 5432, sslMode: 'require', description: 'PostgreSQL 兼容云原生数据库' },
  { id: 'aliyun-polardb-x', label: '阿里云 PolarDB-X', group: '阿里云', driver: 'mysql', port: 3306, sslMode: 'require', description: 'MySQL 兼容分布式数据库' },
  { id: 'aliyun-oceanbase-mysql', label: '阿里云 OceanBase (MySQL 模式)', group: '阿里云', driver: 'mysql', port: 2881, sslMode: 'disable', description: 'OceanBase MySQL 兼容模式' },
  { id: 'aliyun-oceanbase-oracle', label: '阿里云 OceanBase (Oracle 模式)', group: '阿里云', driver: 'oracle', port: 2881, sslMode: 'disable', description: 'OceanBase Oracle 兼容模式，实验性' },
  { id: 'huawei-gaussdb', label: '华为云 GaussDB (PostgreSQL)', group: '华为云', driver: 'postgres', port: 8000, sslMode: 'require', description: 'openGauss/GaussDB PostgreSQL 协议' },
  { id: 'huawei-gaussdb-dws', label: '华为云 GaussDB(DWS)', group: '华为云', driver: 'postgres', port: 8000, sslMode: 'require', description: '数据仓库，PostgreSQL 协议' },
  { id: 'huawei-mysql', label: '华为云 RDS MySQL', group: '华为云', driver: 'mysql', port: 3306, sslMode: 'require', description: '预填 MySQL + TLS' },
  { id: 'huawei-postgres', label: '华为云 RDS PostgreSQL', group: '华为云', driver: 'postgres', port: 5432, sslMode: 'require', description: '预填 PostgreSQL + TLS' },
  { id: 'huawei-sqlserver', label: '华为云 RDS SQL Server', group: '华为云', driver: 'sqlserver', port: 1433, sslMode: 'require', description: '预填 SQL Server + 加密' },
  { id: 'huawei-mongo', label: '华为云 GaussDB(for Mongo)', group: '华为云', driver: 'mongodb', port: 8635, sslMode: 'require', description: 'MongoDB 兼容文档数据库' },
  { id: 'huawei-redis', label: '华为云 GaussDB(for Redis)', group: '华为云', driver: 'redis', port: 6379, sslMode: 'require', description: 'Redis 兼容缓存' },
  { id: 'tencent-mysql', label: '腾讯云 TencentDB MySQL', group: '腾讯云', driver: 'mysql', port: 3306, sslMode: 'require', description: '预填 MySQL + TLS' },
  { id: 'tencent-postgres', label: '腾讯云 TencentDB PostgreSQL', group: '腾讯云', driver: 'postgres', port: 5432, sslMode: 'require', description: '预填 PostgreSQL + TLS' },
  { id: 'tencent-sqlserver', label: '腾讯云 TencentDB SQL Server', group: '腾讯云', driver: 'sqlserver', port: 1433, sslMode: 'require', description: '预填 SQL Server + 加密' },
  { id: 'tencent-mongodb', label: '腾讯云 TencentDB MongoDB', group: '腾讯云', driver: 'mongodb', port: 27017, sslMode: 'require', description: 'MongoDB 文档数据库' },
  { id: 'tencent-redis', label: '腾讯云 TencentDB Redis', group: '腾讯云', driver: 'redis', port: 6379, sslMode: 'require', description: 'Redis 兼容缓存' },
  { id: 'tencent-tdsqlc', label: '腾讯云 TDSQL-C MySQL', group: '腾讯云', driver: 'mysql', port: 3306, sslMode: 'require', description: 'MySQL 兼容云原生数据库' },
  { id: 'tencent-tdsql-pg', label: '腾讯云 TDSQL PostgreSQL', group: '腾讯云', driver: 'postgres', port: 5432, sslMode: 'require', description: 'PostgreSQL 兼容分布式数据库' },
  { id: 'fujitsu-ep', label: 'Fujitsu Enterprise Postgres', group: '其他厂商', driver: 'postgres', port: 5432, sslMode: 'require', description: 'PostgreSQL 协议' },
  { id: 'kingbase', label: '电科金仓 KingbaseES', group: '国产兼容', driver: 'postgres', port: 54321, sslMode: 'disable', description: 'PostgreSQL 兼容' },
  { id: 'highgo', label: '瀚高 HighGo', group: '国产兼容', driver: 'postgres', port: 5866, sslMode: 'disable', description: 'PostgreSQL 兼容' },
  { id: 'tidb', label: '平凯星辰 TiDB', group: '国产兼容', driver: 'mysql', port: 4000, sslMode: 'disable', description: 'MySQL 兼容，默认端口 4000' },
  { id: 'cockroach', label: 'CockroachDB', group: '开源兼容', driver: 'postgres', port: 26257, sslMode: 'require', description: 'PostgreSQL 协议，默认端口 26257' },
];

export const CONNECTION_COLORS = ['#e8a33d', '#4f8ef7', '#3ecf8e', '#f472b6', '#a78bfa', '#22d3ee', '#fb7185', '#a3e635'];

export function driverLabel(driver: Driver): string {
  return DRIVER_META[driver]?.label ?? driver;
}

export function formatBytes(bytes: number | undefined | null): string {
  if (!bytes || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

export function formatNumber(value: number | undefined | null): string {
  if (value === undefined || value === null) return '0';
  return new Intl.NumberFormat('zh-CN').format(value);
}

export function formatDateTime(value: string | number | Date | undefined | null): string {
  if (!value) return '—';
  const date = typeof value === 'string' && /^\d+$/.test(value) ? new Date(Number(value)) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

export function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;
  return formatDateTime(timestamp);
}

export function connectionSubtitle(conn: Connection): string {
  if (conn.driver === 'sqlite') return conn.sqlitePath || 'SQLite';
  const port = conn.port ? `:${conn.port}` : '';
  return `${conn.host || 'localhost'}${port}`;
}

export function quoteIdent(driver: Driver, name: string): string {
  if (isMySQLFamily(driver)) return `\`${name.replaceAll('`', '``')}\``;
  if (driver === 'sqlserver') return `[${name.replaceAll(']', ']]')}]`;
  return `"${name.replaceAll('"', '""')}"`;
}

export function qualifiedTable(driver: Driver, database: string, schema: string, table: string): string {
  if (isMySQLFamily(driver)) {
    return database ? `${quoteIdent(driver, database)}.${quoteIdent(driver, table)}` : quoteIdent(driver, table);
  }
  if (driver === 'postgres' || driver === 'sqlserver' || driver === 'oracle' || driver === 'snowflake') {
    return schema ? `${quoteIdent(driver, schema)}.${quoteIdent(driver, table)}` : quoteIdent(driver, table);
  }
  return quoteIdent(driver, table);
}

export function keyOfRow(primaryKeys: string[], columns: string[], row: unknown[]): Record<string, unknown> {
  const keys: Record<string, unknown> = {};
  primaryKeys.forEach((pk) => {
    const index = columns.indexOf(pk);
    if (index >= 0) keys[pk] = row[index];
  });
  return keys;
}

export function isNumericType(type: string | undefined): boolean {
  if (!type) return false;
  const lower = type.toLowerCase();
  return (
    lower.includes('int') ||
    lower.startsWith('number') ||
    lower.includes('decimal') ||
    lower.includes('numeric') ||
    lower.includes('real') ||
    lower.includes('double') ||
    lower.includes('float') ||
    lower.includes('serial') ||
    lower === 'money' ||
    lower === 'smallmoney'
  );
}

export function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_');
}

export function downloadUrl(url: string, filename?: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.rel = 'noopener';
  if (filename) anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export function downloadText(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  downloadUrl(url, filename);
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function defaultQueryFor(conn: Connection, database?: string): string {
  if (isMySQLFamily(conn.driver)) {
    return `-- 输入 SQL，按 Ctrl/⌘ + Enter 执行\n-- 当前数据库：${database || '未选择'}\nSHOW TABLES;`;
  }
  if (conn.driver === 'postgres') {
    return `-- 输入 SQL，按 Ctrl/⌘ + Enter 执行
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
ORDER BY table_schema, table_name;`;
  }
  if (conn.driver === 'sqlserver') {
    return `-- 输入 SQL，按 Ctrl/⌘ + Enter 执行
SELECT s.name AS schema_name, o.name AS object_name, o.type_desc
FROM sys.objects o
JOIN sys.schemas s ON s.schema_id = o.schema_id
WHERE o.type IN ('U', 'V') AND o.is_ms_shipped = 0
ORDER BY s.name, o.name;`;
  }
  if (conn.driver === 'oracle') {
    return `-- 输入 SQL，按 Ctrl/⌘ + Enter 执行
SELECT table_name, 'TABLE' AS object_type FROM user_tables
UNION ALL
SELECT view_name, 'VIEW' FROM user_views
ORDER BY 1;`;
  }
  if (conn.driver === 'snowflake') {
    return `-- 输入 SQL，按 Ctrl/⌘ + Enter 执行
SELECT CURRENT_DATABASE() AS database_name,
       CURRENT_SCHEMA() AS schema_name,
       CURRENT_USER() AS user_name;`;
  }
  if (conn.driver === 'mongodb') {
    return `// MongoDB 使用集合文档浏览；SQL 查询不适用。`;
  }
  if (conn.driver === 'redis') {
    return `// Redis 使用键浏览器 / 命令控制台；SQL 查询不适用。`;
  }
  if (conn.driver === 'chroma') {
    return `// Chroma 使用向量工作台；SQL 查询不适用。`;
  }
  return `-- 输入 SQL，按 Ctrl/⌘ + Enter 执行
SELECT name, type
FROM sqlite_master
WHERE type IN ('table', 'view')
ORDER BY name;`;
}

export function suggestSqlForTable(driver: Driver, database: string, schema: string, table: string): string {
  const target = qualifiedTable(driver, database, schema, table);
  if (driver === 'sqlserver') {
    return `SELECT TOP 100 *\nFROM ${target};`;
  }
  if (driver === 'oracle') {
    return `SELECT *\nFROM ${target}\nFETCH FIRST 100 ROWS ONLY;`;
  }
  return `SELECT *\nFROM ${target}\nLIMIT 100;`;
}

export function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}
