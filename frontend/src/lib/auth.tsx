import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, setCsrfToken } from './api';

export type User = {
  id: number;
  username: string;
  role: 'admin' | 'readonly';
  totpEnabled: boolean;
  permissions: string[];
};

type AuthState = {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  can: (permission: string) => boolean;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api<{ user: User; csrfToken: string }>('/api/auth/me');
      setCsrfToken(data.csrfToken);
      setUser(data.user);
    } catch {
      setUser(null);
      setCsrfToken('');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (username: string, password: string) => {
    const data = await api<{ user: User; csrfToken: string }>('/api/auth/login', {
      method: 'POST',
      json: { username, password },
    });
    setCsrfToken(data.csrfToken);
    setUser(data.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('/api/auth/logout', { method: 'POST', json: {} });
    } finally {
      setUser(null);
      setCsrfToken('');
    }
  }, []);

  const can = useCallback((permission: string) => !!user?.permissions.includes(permission), [user]);

  const value = useMemo(
    () => ({ user, loading, login, logout, refresh, can }),
    [user, loading, login, logout, refresh, can],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside provider');
  return ctx;
}
