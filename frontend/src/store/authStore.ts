import { create } from 'zustand';
import { ApiError, api } from '../lib/api';
import { useAppStore } from './appStore';
import type {
  AuthStatus,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
  UserProfile,
} from '../types';

interface AuthState {
  user: UserProfile | null;
  status: AuthStatus | null;
  loading: boolean;
  initialized: boolean;
  error: string | null;
  initialize: () => Promise<void>;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>;
  resetPassword: (input: ResetPasswordInput) => Promise<void>;
  clearError: () => void;
}

let initPromise: Promise<void> | null = null;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  status: null,
  loading: true,
  initialized: false,
  error: null,

  initialize: () => {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      set({ loading: true, error: null });
      try {
        const status = await api.authStatus();
        set({ status });
        try {
          const me = await api.me();
          set({ user: me.user });
        } catch (error) {
          set({ user: null });
          if (status.authEnabled && !(error instanceof ApiError && error.status === 401)) {
            throw error;
          }
        }
      } catch (error) {
        set({ error: messageOf(error) });
      } finally {
        set({ loading: false, initialized: true });
      }
    })();
    return initPromise;
  },

  login: async (input) => {
    set({ error: null });
    try {
      const response = await api.login(input);
      set({ user: response.user });
    } catch (error) {
      set({ error: messageOf(error) });
      throw error;
    }
  },

  register: async (input) => {
    set({ error: null });
    try {
      const response = await api.register(input);
      set({ user: response.user });
    } catch (error) {
      set({ error: messageOf(error) });
      throw error;
    }
  },

  logout: async () => {
    try {
      await api.logout();
    } catch {
      // 会话已失效时也继续清理本地状态
    } finally {
      set({ user: null, error: null });
      useAppStore.getState().resetWorkspace();
    }
  },

  changePassword: async (oldPassword, newPassword) => {
    const response = await api.changePassword(oldPassword, newPassword);
    set({ user: response.user });
  },

  resetPassword: async (input) => {
    await api.resetPassword(input);
  },

  clearError: () => set({ error: null }),
}));

if (typeof window !== 'undefined') {
  window.addEventListener('navideck:auth-required', () => {
    const state = useAuthStore.getState();
    if (!state.user) return;
    useAuthStore.setState({ user: null, error: '登录状态已失效，请重新登录' });
    useAppStore.getState().resetWorkspace();
  });
}

export function currentUserId(): string {
  return useAuthStore.getState().user?.id ?? 'local';
}
