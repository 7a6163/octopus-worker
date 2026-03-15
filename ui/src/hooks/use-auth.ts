import { createContext } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
import { getMe, login as apiLogin } from '@ui/api/auth';
import { clearToken, getToken } from '@ui/api/client';

interface AuthUser {
  id: number;
  username: string;
  role: string;
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

export const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  login: async () => {},
  logout: () => {},
});

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

export function useAuthProvider(): AuthState {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getToken();
    if (token) {
      getMe()
        .then((u) => setUser(u))
        .catch(() => clearToken())
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (username: string, password: string) => {
    const res = await apiLogin(username, password);
    setUser(res.user);
  };

  const logout = () => {
    clearToken();
    setUser(null);
  };

  return { user, loading, login, logout };
}
