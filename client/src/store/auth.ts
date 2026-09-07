import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface SessionUser {
  id: string;
  username: string;
  full_name: string;
  avatar_url?: string | null;
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: SessionUser | null;
  setSession: (s: { access_token: string; refresh_token: string; user?: SessionUser }) => void;
  setUser: (u: SessionUser | null) => void;
  clear: () => void;
}

/**
 * Session state. In the production React Native app the refresh token lives
 * in SecureStore/Keychain and (web) an HttpOnly cookie; this web demo
 * persists it in localStorage for convenience — the server only ever stores
 * the SHA-256 hash of the refresh jti.
 */
export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      setSession: (s) => set({ accessToken: s.access_token, refreshToken: s.refresh_token, user: s.user ?? null }),
      setUser: (u) => set({ user: u }),
      clear: () => set({ accessToken: null, refreshToken: null, user: null }),
    }),
    { name: 'cv_session' },
  ),
);
