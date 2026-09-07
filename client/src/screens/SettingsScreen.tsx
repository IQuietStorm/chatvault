import { useState } from 'react';
import { apiPatch, apiPost } from '../lib/api';
import { useAuth } from '../store/auth';
import { useTheme } from '../hooks/useTheme';

/** One global wallpaper for ALL threads — picker writes a single value. */
const WALLPAPERS: { name: string; svg: string }[] = [
  { name: 'Nebula Blue-Purple', svg: `<svg xmlns='http://www.w3.org/2000/svg' width='800' height='600'><defs><radialGradient id='g' cx='35%' cy='30%' r='80%'><stop offset='0%' stop-color='#2563EB'/><stop offset='55%' stop-color='#9333EA'/><stop offset='100%' stop-color='#0B1220'/></radialGradient></defs><rect width='800' height='600' fill='url(#g)'/></svg>` },
  { name: 'Purple Waves', svg: `<svg xmlns='http://www.w3.org/2000/svg' width='800' height='600'><defs><linearGradient id='w' x1='0' y1='0' x2='1' y2='1'><stop offset='0%' stop-color='#7C3AED'/><stop offset='100%' stop-color='#2563EB'/></linearGradient></defs><rect width='800' height='600' fill='#111A2E'/><path d='M0 400 Q200 300 400 400 T800 400 V600 H0 Z' fill='url(#w)' opacity='.55'/><path d='M0 480 Q200 380 400 480 T800 480 V600 H0 Z' fill='#2563EB' opacity='.6'/></svg>` },
  { name: 'Light Minimal', svg: `<svg xmlns='http://www.w3.org/2000/svg' width='800' height='600'><defs><radialGradient id='l' cx='50%' cy='0%' r='90%'><stop offset='0%' stop-color='#DBEAFE'/><stop offset='100%' stop-color='#F8FAFC'/></radialGradient></defs><rect width='800' height='600' fill='url(#l)'/><circle cx='680' cy='90' r='60' fill='#9333EA' opacity='.18'/></svg>` },
  { name: 'Midnight', svg: `<svg xmlns='http://www.w3.org/2000/svg' width='800' height='600'><defs><radialGradient id='m' cx='20%' cy='80%' r='90%'><stop offset='0%' stop-color='#1E3A8A'/><stop offset='100%' stop-color='#0B1220'/></radialGradient></defs><rect width='800' height='600' fill='url(#m)'/><circle cx='120' cy='120' r='3' fill='#F1F5F9'/><circle cx='300' cy='80' r='2' fill='#F1F5F9'/><circle cx='520' cy='160' r='3' fill='#F1F5F9'/><circle cx='660' cy='70' r='2' fill='#F1F5F9'/></svg>` },
];
const asDataUri = (svg: string) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

export function SettingsScreen({ onClose }: { onClose: () => void }) {
  const { accessToken, user, clear } = useAuth();
  const { mode, setTheme } = useTheme();
  const [username, setUsername] = useState(user?.username ?? '');
  const [activeWall, setActiveWall] = useState(() => localStorage.getItem('cv_wallpaper') ?? '0');

  const applyWallpaper = async (i: number) => {
    setActiveWall(String(i));
    localStorage.setItem('cv_wallpaper', String(i));
    const url = asDataUri(WALLPAPERS[i].svg);
    document.documentElement.style.setProperty('--cv-wallpaper-url', url);
    if (accessToken) {
      await apiPatch('/me/preferences', { chat_wallpaper_url: url }, accessToken).catch(() => {});
    }
  };

  const saveUsername = async () => {
    if (!accessToken || !username.trim()) return;
    try {
      await apiPatch('/me', { username: username.trim() }, accessToken);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const logout = async () => {
    if (accessToken) await apiPost('/auth/logout', {}, accessToken).catch(() => {});
    clear();
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', justifyContent: 'center', padding: 24 }}>
      <div className="cv-card" style={{ width: 520, padding: 28, alignSelf: 'flex-start' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>Settings</div>
          <button className="cv-btn" style={{ padding: '6px 12px', fontSize: 12 }} onClick={onClose}>Back to chats</button>
        </div>

        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--cv-text-secondary)', margin: '16px 0 8px' }}>PROFILE (custom avatar + editable username)</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--cv-brand-gradient)' }} />
          <input className="cv-input" value={username} onChange={(e) => setUsername(e.target.value)} style={{ flex: 1 }} />
          <button className="cv-btn" style={{ padding: '8px 14px' }} onClick={saveUsername}>Save</button>
        </div>

        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--cv-text-secondary)', margin: '20px 0 8px' }}>THEME</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['light', 'dark', 'system'] as const).map((t) => (
            <button
              key={t}
              className="cv-btn"
              style={{
                flex: 1, background: mode === t ? 'var(--cv-brand-gradient)' : 'var(--cv-bg-incoming)',
                color: mode === t ? 'var(--cv-text-on-brand)' : 'var(--cv-text-primary)',
                border: '1px solid var(--cv-border)', textTransform: 'capitalize',
              }}
              onClick={() => setTheme(t)}
            >
              {t}
            </button>
          ))}
        </div>

        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--cv-text-secondary)', margin: '20px 0 8px' }}>
          GLOBAL CHAT WALLPAPER — one background for every thread
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {WALLPAPERS.map((w, i) => (
            <div
              key={w.name}
              onClick={() => applyWallpaper(i)}
              style={{
                height: 72, borderRadius: 10, cursor: 'pointer', background: asDataUri(w.svg),
                backgroundSize: 'cover', outline: activeWall === String(i) ? '3px solid var(--cv-accent)' : '1px solid var(--cv-border)',
                display: 'flex', alignItems: 'flex-end', padding: 6, color: '#fff', fontSize: 11, fontWeight: 600,
                textShadow: '0 1px 3px rgba(0,0,0,.6)',
              }}
            >
              {w.name}
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11, color: 'var(--cv-text-secondary)', marginTop: 6 }}>
          Applied instantly to all chats via the --cv-wallpaper-url design token; synced with PATCH /me/preferences.
        </div>

        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--cv-text-secondary)', margin: '20px 0 8px' }}>SESSION</div>
        <button className="cv-btn" style={{ background: 'var(--cv-bg-incoming)', color: 'var(--cv-text-primary)', border: '1px solid var(--cv-border)', width: '100%' }} onClick={logout}>
          Logout — ends this device's session (server revokes the refresh token)
        </button>
      </div>
    </div>
  );
}
