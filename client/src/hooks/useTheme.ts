import { useCallback, useEffect, useState } from 'react';
import { apiPatch } from '../lib/api';
import { useAuth } from '../store/auth';

export type ThemeMode = 'light' | 'dark' | 'system';

function resolve(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return mode;
}

/** Theme toggle (Light/Dark/System), persisted locally + synced to the server. */
export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(() => {
    const t = localStorage.getItem('cv_theme');
    return t === 'light' || t === 'dark' ? t : 'system';
  });
  const accessToken = useAuth((s) => s.accessToken);

  useEffect(() => {
    document.documentElement.dataset.theme = resolve(mode);
    localStorage.setItem('cv_theme', mode);
  }, [mode]);

  const setTheme = useCallback(
    (next: ThemeMode) => {
      setMode(next);
      if (accessToken) {
        void apiPatch('/me/preferences', { theme: next }, accessToken).catch(() => {
          /* offline — local wins */
        });
      }
    },
    [accessToken],
  );

  return { mode, setTheme };
}
