const BASE_KEY = 'starbase.agent.base';
const TOKEN_KEY = 'starbase.agent.token';
const MODE_KEY = 'starbase.agent.mode';

export const DEFAULT_AGENT_BASE = 'http://127.0.0.1:18620';

export interface AgentHealth {
  name: string;
  version: string;
  paired: boolean;
}

function readStorage(key: string): string {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

function writeStorage(key: string, value: string) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // 隐私模式下 localStorage 可能不可用，忽略即可
  }
}

let baseUrl = readStorage(BASE_KEY) || DEFAULT_AGENT_BASE;
let token = readStorage(TOKEN_KEY);
let mode = readStorage(MODE_KEY) === '1';

export function getAgentBase(): string {
  return baseUrl;
}

export function setAgentBase(value: string) {
  baseUrl = value.trim().replace(/\/+$/, '') || DEFAULT_AGENT_BASE;
  writeStorage(BASE_KEY, baseUrl === DEFAULT_AGENT_BASE ? '' : baseUrl);
}

export function getAgentToken(): string {
  return token;
}

export function setAgentToken(value: string) {
  token = value.trim();
  writeStorage(TOKEN_KEY, token);
}

export function clearAgentToken() {
  token = '';
  writeStorage(TOKEN_KEY, '');
}

export function isAgentMode(): boolean {
  return mode && Boolean(token);
}

export function setAgentMode(enabled: boolean) {
  mode = enabled;
  writeStorage(MODE_KEY, enabled ? '1' : '');
}

export function agentUrl(path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${baseUrl}/api${suffix}`;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

export async function probeAgent(timeoutMs = 1800): Promise<AgentHealth | null> {
  try {
    const response = await fetchWithTimeout(
      agentUrl('/agent/health'),
      { method: 'GET', credentials: 'omit', mode: 'cors', cache: 'no-store' },
      timeoutMs,
    );
    if (!response.ok) return null;
    const data = (await response.json()) as Partial<AgentHealth>;
    return {
      name: data.name || 'StarBase Agent',
      version: data.version || '',
      paired: Boolean(data.paired),
    };
  } catch {
    return null;
  }
}

export async function pairAgent(pin: string): Promise<string> {
  const response = await fetchWithTimeout(
    agentUrl('/agent/pair'),
    {
      method: 'POST',
      credentials: 'omit',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    },
    10000,
  );
  let payload: { token?: string; error?: string } = {};
  try {
    payload = (await response.json()) as { token?: string; error?: string };
  } catch {
    // 忽略非 JSON 响应
  }
  if (!response.ok || !payload.token) {
    throw new Error(payload.error || `本地 Agent 配对失败 (${response.status})`);
  }
  setAgentToken(payload.token);
  return payload.token;
}

export async function agentHealthOnce(timeoutMs = 2500): Promise<AgentHealth | null> {
  return probeAgent(timeoutMs);
}