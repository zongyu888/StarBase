import type {
  AlterTableRequest,
  AuthResponse,
  AuthStatus,
  BatchRowsRequest,
  BatchRowsResult,
  CaptchaChallenge,
  ChromaCollection,
  ChromaDocument,
  ChromaDocumentInput,
  ChromaDocumentsPage,
  ChromaInfo,
  ChromaQueryResult,
  Connection,
  ConnectionInput,
  CreateTableRequest,
  DatabaseInfo,
  EmailCodeResponse,
  Filter,
  HealthInfo,
  ImportCsvOptions,
  LoginInput,
  MutationResult,
  ObjectInfo,
  QueryResponse,
  RedisCommandResult,
  RedisDeleteKeysResult,
  RedisEntryInput,
  RedisInfo,
  RedisKeyInfo,
  RedisKeysPage,
  RegisterInput,
  ResetPasswordInput,
  RowsResponse,
  SavedQuery,
  SavedQueryInput,
  TableMeta,
  TableTarget,
  TestConnectionResult,
  UserProfile,
} from '../types';

import { agentUrl, getAgentToken, isAgentMode } from './agent';

const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');
const BASE = `${API_BASE}/api`;

function isSiteOnlyPath(path: string): boolean {
  return (
    path.startsWith('/auth') ||
    path === '/health' ||
    path.startsWith('/health?') ||
    path.startsWith('/users') ||
    path.startsWith('/admin')
  );
}

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}, options: { site?: boolean } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const useAgent = !options.site && isAgentMode() && !isSiteOnlyPath(path);
  const url = useAgent ? agentUrl(path) : `${BASE}${path}`;
  if (useAgent) {
    const token = getAgentToken();
    if (token) headers.set('X-StarBase-Agent-Token', token);
  }
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers,
      credentials: useAgent ? 'omit' : API_BASE ? 'include' : 'same-origin',
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(
      useAgent ? '无法连接本地 Agent，请确认 StarBase Agent 已启动' : '无法连接后端服务，请确认服务已启动',
      0,
    );
  }
  if (response.status === 401 && !useAgent) {
    const suppress =
      path.startsWith('/auth/login') ||
      path.startsWith('/auth/register') ||
      path.startsWith('/auth/reset-password') ||
      path.startsWith('/auth/email-code');
    if (!suppress) window.dispatchEvent(new Event('navideck:auth-required'));
  }
  if (!response.ok) {
    let message = `请求失败 (${response.status})`;
    try {
      const data = await response.json();
      if (data?.error) message = data.error;
    } catch {
      const text = await response.text().catch(() => '');
      if (text) message = text;
    }
    throw new ApiError(message, response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function connectionPath(id: string): string {
  return `/connections/${encodeURIComponent(id)}`;
}

function tableSearch(target: Omit<TableTarget, 'connectionId'>, extras?: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  params.set('database', target.database);
  params.set('schema', target.schema);
  params.set('table', target.table);
  if (extras) {
    Object.entries(extras).forEach(([key, value]) => {
      if (value !== undefined && value !== '') params.set(key, String(value));
    });
  }
  return params.toString();
}

export const api = {
  health: () => request<HealthInfo>('/health'),

  authStatus: () => request<AuthStatus>('/auth/status'),
  authCaptcha: () => request<CaptchaChallenge>('/auth/captcha'),
  sendEmailCode: (email: string, scene: 'register' | 'reset') =>
    request<EmailCodeResponse>('/auth/email-code', {
      method: 'POST',
      body: JSON.stringify({ email, scene }),
    }),
  register: (input: RegisterInput) =>
    request<AuthResponse>('/auth/register', { method: 'POST', body: JSON.stringify(input) }),
  login: (input: LoginInput) =>
    request<AuthResponse>('/auth/login', { method: 'POST', body: JSON.stringify(input) }),
  me: () => request<AuthResponse>('/auth/me'),
  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
  changePassword: (oldPassword: string, newPassword: string) =>
    request<AuthResponse>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword, newPassword }),
    }),
  resetPassword: (input: ResetPasswordInput) =>
    request<{ ok: boolean }>('/auth/reset-password', { method: 'POST', body: JSON.stringify(input) }),
  adminUsers: () => request<{ users: UserProfile[] }>('/admin/users'),
  adminSetUserEnabled: (id: string, enabled: boolean) =>
    request<AuthResponse>(`/admin/users/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    }),
  adminDeleteUser: (id: string) =>
    request<{ ok: boolean }>(`/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  adminTestMail: (to: string) =>
    request<{ ok: boolean; message: string }>('/admin/mail/test', {
      method: 'POST',
      body: JSON.stringify({ to }),
    }),

  listConnections: () => request<{ connections: Connection[] }>('/connections'),
  createConnection: (input: ConnectionInput) =>
    request<Connection>('/connections', { method: 'POST', body: JSON.stringify(input) }),
  updateConnection: (id: string, input: ConnectionInput) =>
    request<Connection>(connectionPath(id), { method: 'PUT', body: JSON.stringify(input) }),
  deleteConnection: (id: string) => request<{ ok: boolean }>(connectionPath(id), { method: 'DELETE' }),
  testConnection: (input: ConnectionInput & { id?: string }) =>
    request<TestConnectionResult>('/connections/test', { method: 'POST', body: JSON.stringify(input) }),
  connect: (id: string) => request<{ connected: boolean }>(`${connectionPath(id)}/connect`, { method: 'POST' }),
  disconnect: (id: string) => request<{ connected: boolean }>(`${connectionPath(id)}/disconnect`, { method: 'POST' }),

  databases: (id: string) =>
    request<{ databases: DatabaseInfo[] }>(`${connectionPath(id)}/databases`),
  schemas: (id: string, database: string) =>
    request<{ schemas: string[] }>(`${connectionPath(id)}/schemas?database=${encodeURIComponent(database)}`),
  objects: (id: string, database: string, schema: string) => {
    const params = new URLSearchParams({ database, schema });
    return request<{ objects: ObjectInfo[] }>(`${connectionPath(id)}/objects?${params.toString()}`);
  },
  createDatabase: (id: string, name: string) =>
    request<MutationResult>(`${connectionPath(id)}/databases`, { method: 'POST', body: JSON.stringify({ name }) }),
  dropDatabase: (id: string, database: string) =>
    request<MutationResult>(`${connectionPath(id)}/databases/${encodeURIComponent(database)}`, { method: 'DELETE' }),

  table: (id: string, target: Omit<TableTarget, 'connectionId'>) =>
    request<TableMeta>(`${connectionPath(id)}/table?${tableSearch(target)}`),
  rows: (
    id: string,
    target: Omit<TableTarget, 'connectionId'>,
    options: { page: number; pageSize: number; sortColumn?: string; sortDir?: string; filters?: Filter[] },
  ) => {
    const extras: Record<string, string | number | undefined> = {
      page: options.page,
      pageSize: options.pageSize,
      sortColumn: options.sortColumn,
      sortDir: options.sortDir,
      filters: options.filters && options.filters.length > 0 ? JSON.stringify(options.filters) : undefined,
    };
    return request<RowsResponse>(`${connectionPath(id)}/table/rows?${tableSearch(target, extras)}`);
  },
  insertRow: (id: string, target: Omit<TableTarget, 'connectionId'>, values: Record<string, unknown>) =>
    request<MutationResult>(`${connectionPath(id)}/table/rows`, {
      method: 'POST',
      body: JSON.stringify({ ...target, values }),
    }),
  updateRow: (
    id: string,
    target: Omit<TableTarget, 'connectionId'>,
    keys: Record<string, unknown>,
    changes: Record<string, unknown>,
  ) =>
    request<MutationResult>(`${connectionPath(id)}/table/rows`, {
      method: 'PATCH',
      body: JSON.stringify({ ...target, keys, changes }),
    }),
  deleteRow: (id: string, target: Omit<TableTarget, 'connectionId'>, keys: Record<string, unknown>) =>
    request<MutationResult>(`${connectionPath(id)}/table/rows`, {
      method: 'DELETE',
      body: JSON.stringify({ ...target, keys }),
    }),
  batchMutate: (
    id: string,
    target: Omit<TableTarget, 'connectionId'>,
    payload: Omit<BatchRowsRequest, 'database' | 'schema' | 'table'>,
  ) =>
    request<BatchRowsResult>(`${connectionPath(id)}/table/rows/batch`, {
      method: 'POST',
      body: JSON.stringify({ ...target, ...payload }),
    }),

  query: (
    id: string,
    payload: { database: string; schema: string; sql: string; maxRows: number },
    signal?: AbortSignal,
  ) =>
    request<QueryResponse>(`${connectionPath(id)}/query`, {
      method: 'POST',
      body: JSON.stringify(payload),
      signal,
    }),

  createTable: (id: string, payload: CreateTableRequest) =>
    request<MutationResult>(`${connectionPath(id)}/tables`, { method: 'POST', body: JSON.stringify(payload) }),
  dropTable: (id: string, target: Omit<TableTarget, 'connectionId'>, type: string) =>
    request<MutationResult>(`${connectionPath(id)}/table/drop`, {
      method: 'POST',
      body: JSON.stringify({ ...target, type }),
    }),
  truncateTable: (id: string, target: Omit<TableTarget, 'connectionId'>) =>
    request<MutationResult>(`${connectionPath(id)}/table/truncate`, {
      method: 'POST',
      body: JSON.stringify(target),
    }),
  alterTable: (id: string, payload: AlterTableRequest) =>
    request<MutationResult>(`${connectionPath(id)}/table/alter`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  importCsv: (id: string, target: Omit<TableTarget, 'connectionId'>, csv: string, options: ImportCsvOptions) =>
    request<MutationResult>(`${connectionPath(id)}/table/import`, {
      method: 'POST',
      body: JSON.stringify({ ...target, csv, ...options }),
    }),

  exportUrl: (
    id: string,
    target: Omit<TableTarget, 'connectionId'>,
    format: 'csv' | 'json',
    options?: { filters?: Filter[]; sortColumn?: string; sortDir?: string; limit?: number },
  ) =>
    `${BASE}${connectionPath(id)}/table/export?${tableSearch(target, {
      format,
      filters: options?.filters && options.filters.length > 0 ? JSON.stringify(options.filters) : undefined,
      sortColumn: options?.sortColumn,
      sortDir: options?.sortDir,
      limit: options?.limit,
    })}`,

  savedQueries: (connectionId?: string) =>
    request<{ queries: SavedQuery[] }>(
      `/queries${connectionId ? `?connectionId=${encodeURIComponent(connectionId)}` : ''}`,
    ),
  createSavedQuery: (input: SavedQueryInput) =>
    request<SavedQuery>('/queries', { method: 'POST', body: JSON.stringify(input) }),
  updateSavedQuery: (id: string, input: SavedQueryInput) =>
    request<SavedQuery>(`/queries/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) }),
  deleteSavedQuery: (id: string) =>
    request<{ ok: boolean }>(`/queries/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  redisInfo: (id: string, database: string) =>
    request<RedisInfo>(
      `${connectionPath(id)}/redis/info?database=${encodeURIComponent(database)}`,
    ),
  redisKeys: (
    id: string,
    options: { database: string; pattern?: string; type?: string; cursor?: number; count?: number },
  ) => {
    const query = new URLSearchParams();
    query.set('database', options.database);
    if (options.pattern) query.set('pattern', options.pattern);
    if (options.type) query.set('type', options.type);
    if (options.cursor) query.set('cursor', String(options.cursor));
    if (options.count) query.set('count', String(options.count));
    return request<RedisKeysPage>(`${connectionPath(id)}/redis/keys?${query.toString()}`);
  },
  redisKey: (id: string, database: string, key: string, cursor = 0, count = 200) =>
    request<RedisKeyInfo>(
      `${connectionPath(id)}/redis/key?${new URLSearchParams({
        database,
        key,
        cursor: String(cursor),
        count: String(count),
      }).toString()}`,
    ),
  setRedisKey: (
    id: string,
    payload: {
      database: string;
      key: string;
      type: string;
      value: unknown;
      ttl: number;
      overwrite?: boolean;
    },
  ) =>
    request<{ ok: boolean }>(`${connectionPath(id)}/redis/key`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteRedisKey: (id: string, database: string, key: string) =>
    request<{ ok: boolean }>(
      `${connectionPath(id)}/redis/key?database=${encodeURIComponent(database)}&key=${encodeURIComponent(key)}`,
      { method: 'DELETE' },
    ),
  redisDeleteKeys: (
    id: string,
    payload: { database: string; keys?: string[]; pattern?: string; limit?: number; allowAll?: boolean },
  ) =>
    request<RedisDeleteKeysResult>(`${connectionPath(id)}/redis/keys/delete`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  redisRenameKey: (id: string, payload: { database: string; key: string; newKey: string }) =>
    request<{ ok: boolean }>(`${connectionPath(id)}/redis/key/rename`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  redisExpireKey: (
    id: string,
    payload: { database: string; key: string; ttl?: number; persist?: boolean },
  ) =>
    request<{ ok: boolean; ttl: number }>(`${connectionPath(id)}/redis/key/expire`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  redisEntry: (id: string, payload: RedisEntryInput) =>
    request<{ ok: boolean; result?: unknown }>(`${connectionPath(id)}/redis/key/entry`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  redisCommand: (id: string, database: string, command: string) =>
    request<RedisCommandResult>(`${connectionPath(id)}/redis/command`, {
      method: 'POST',
      body: JSON.stringify({ database, command }),
    }),

  chromaInfo: (id: string) => request<ChromaInfo>(`${connectionPath(id)}/chroma/info`),
  chromaCollections: (id: string) =>
    request<{ collections: ChromaCollection[] }>(`${connectionPath(id)}/chroma/collections`),
  chromaCollection: (id: string, collection: string) =>
    request<ChromaCollection>(
      `${connectionPath(id)}/chroma/collections/${encodeURIComponent(collection)}`,
    ),
  chromaCreateCollection: (id: string, name: string, space: string) =>
    request<ChromaCollection>(`${connectionPath(id)}/chroma/collections`, {
      method: 'POST',
      body: JSON.stringify({ name, space }),
    }),
  chromaDeleteCollection: (id: string, collection: string) =>
    request<{ ok: boolean }>(
      `${connectionPath(id)}/chroma/collections/${encodeURIComponent(collection)}`,
      { method: 'DELETE' },
    ),
  chromaDocuments: (id: string, collection: string, limit = 20, offset = 0) =>
    request<ChromaDocumentsPage>(
      `${connectionPath(id)}/chroma/collections/${encodeURIComponent(collection)}/documents?${new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
      }).toString()}`,
    ),
  chromaAddDocument: (id: string, collection: string, input: ChromaDocumentInput) =>
    request<ChromaDocument>(
      `${connectionPath(id)}/chroma/collections/${encodeURIComponent(collection)}/documents`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
  chromaUpdateDocument: (id: string, collection: string, docId: string, input: ChromaDocumentInput) =>
    request<ChromaDocument>(
      `${connectionPath(id)}/chroma/collections/${encodeURIComponent(collection)}/documents/${encodeURIComponent(docId)}`,
      { method: 'PUT', body: JSON.stringify(input) },
    ),
  chromaDeleteDocument: (id: string, collection: string, docId: string) =>
    request<{ ok: boolean }>(
      `${connectionPath(id)}/chroma/collections/${encodeURIComponent(collection)}/documents/${encodeURIComponent(docId)}`,
      { method: 'DELETE' },
    ),
  chromaQuery: (
    id: string,
    collection: string,
    payload: { embedding: number[]; nResults: number; where?: Record<string, unknown> },
  ) =>
    request<ChromaQueryResult>(
      `${connectionPath(id)}/chroma/collections/${encodeURIComponent(collection)}/query`,
      { method: 'POST', body: JSON.stringify(payload) },
    ),
  chromaFilter: (id: string, collection: string, payload: { where: Record<string, unknown>; limit: number }) =>
    request<ChromaQueryResult>(
      `${connectionPath(id)}/chroma/collections/${encodeURIComponent(collection)}/filter`,
      { method: 'POST', body: JSON.stringify(payload) },
    ),
};
