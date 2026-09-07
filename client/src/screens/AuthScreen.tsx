import { useCallback, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { apiPost } from '../lib/api';
import { isAtLeast18 } from '../lib/age';
import { useAuth, type SessionUser } from '../store/auth';

interface RegisterForm {
  full_name: string;
  username: string;
  email: string;
  phone_number: string;
  password: string;
  gender: string;
  date_of_birth: string;
  device_location?: { lat: number; lng: number; accuracy_m?: number };
}

export function AuthScreen() {
  const setSession = useAuth((s) => s.setSession);
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState<RegisterForm>({
    full_name: '', username: '', email: '', phone_number: '', password: '',
    gender: 'prefer_not_to_say', date_of_birth: '',
  });

  const set = (k: keyof RegisterForm) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  /** Browser/Device Geolocation API — captured ONCE at registration with consent. */
  const captureLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setError('Geolocation not available on this device');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setForm((f) => ({
          ...f,
          device_location: { lat: p.coords.latitude, lng: p.coords.longitude, accuracy_m: p.coords.accuracy },
        }));
        setError(null);
      },
      () => setError('Location permission denied — you can still register without it'),
      { enableHighAccuracy: false, timeout: 8000 },
    );
  }, []);

  const register = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    // Client-side age validation (UX sugar) — server is authoritative.
    if (!form.date_of_birth) return setError('Date of birth is required');
    if (!isAtLeast18(form.date_of_birth))
      return setError('You must be at least 18 years old (based on your last birthday) to use ChatVault');
    if (!/^[a-zA-Z0-9_]{3,32}$/.test(form.username))
      return setError('Username must be 3-32 chars of a-z, 0-9, _');
    if (!form.email && !form.phone_number) return setError('Email or phone number is required');

    setBusy(true);
    try {
      const res = await apiPost<{ access_token: string; refresh_token: string; user?: SessionUser }>('/auth/register', form);
      setSession({ access_token: res.access_token, refresh_token: res.refresh_token, user: res.user });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const login = async (e: FormEvent) => {
    e.preventDefault();
    const data = new FormData(e.target as HTMLFormElement);
    setError(null);
    setBusy(true);
    try {
      const res = await apiPost<{ access_token: string; refresh_token: string; user?: SessionUser }>('/auth/login', {
        identifier: data.get('identifier'), password: data.get('password'),
      });
      setSession({ access_token: res.access_token, refresh_token: res.refresh_token, user: res.user });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  /** OAuth 2.0 (Google/Apple) — production flow: PKCE redirect → code exchange → /auth/oauth/:provider. */
  const oauth = (provider: 'google' | 'apple') => {
    setError(`OAuth ${provider} redirect flow — wire PKCE + IdP client ids from server .env`);
    // Production: window.location = `${API}/auth/${provider}/login` (redirect dance)
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div className="cv-card" style={{ width: 420, padding: 28 }}>
        <div style={{ fontSize: 26, fontWeight: 700, background: 'var(--cv-brand-gradient)', WebkitBackgroundClip: 'text', color: 'transparent', marginBottom: 4 }}>
          ChatVault
        </div>
        <div style={{ fontSize: 14, color: 'var(--cv-text-secondary)', marginBottom: 20 }}>
          Real-time messaging · view-once media · VoIP · 18+
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button className="cv-btn" style={{ flex: 1, background: mode === 'register' ? 'var(--cv-brand-gradient)' : 'var(--cv-bg-subtle, var(--cv-bg-incoming))' }} onClick={() => setMode('register')}>Register</button>
          <button className="cv-btn" style={{ flex: 1, background: mode === 'login' ? 'var(--cv-brand-gradient)' : 'var(--cv-bg-subtle, var(--cv-bg-incoming))' }} onClick={() => setMode('login')}>Log in</button>
        </div>

        {mode === 'register' ? (
          <form onSubmit={register} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input className="cv-input" placeholder="Full name *" value={form.full_name} onChange={set('full_name')} required />
            <input className="cv-input" placeholder="Username (a-z, 0-9, _) *" value={form.username} onChange={set('username')} required />
            <input className="cv-input" type="email" placeholder="Email" value={form.email} onChange={set('email')} />
            <input className="cv-input" type="tel" placeholder="Phone number (E.164)" value={form.phone_number} onChange={set('phone_number')} />
            <input className="cv-input" type="password" placeholder="Password" value={form.password} onChange={set('password')} minLength={8} required />
            <div style={{ display: 'flex', gap: 10 }}>
              <input className="cv-input" type="date" max={new Date().toISOString().slice(0, 10)} value={form.date_of_birth} onChange={set('date_of_birth')} required />
              <select className="cv-input" value={form.gender} onChange={set('gender')}>
                <option value="prefer_not_to_say">Gender…</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="non_binary">Non-binary</option>
                <option value="other">Other</option>
              </select>
            </div>
            <button type="button" className="cv-btn" style={{ background: 'var(--cv-bg-incoming)', color: 'var(--cv-text-primary)', border: '1px solid var(--cv-border)' }} onClick={captureLocation}>
              {form.device_location ? `📍 ${form.device_location.lat.toFixed(4)}, ${form.device_location.lng.toFixed(4)}` : '📍 Capture device location'}
            </button>
            {error ? <div style={{ color: '#EF4444', fontSize: 13 }}>{error}</div> : null}
            <button className="cv-btn" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button type="button" className="cv-btn" style={{ flex: 1, background: 'var(--cv-bg-incoming)', color: 'var(--cv-text-primary)', border: '1px solid var(--cv-border)' }} onClick={() => oauth('google')}>Continue with Google</button>
              <button type="button" className="cv-btn" style={{ flex: 1, background: 'var(--cv-bg-incoming)', color: 'var(--cv-text-primary)', border: '1px solid var(--cv-border)' }} onClick={() => oauth('apple')}>Continue with Apple</button>
            </div>
          </form>
        ) : (
          <form onSubmit={login} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input className="cv-input" name="identifier" placeholder="Email or phone number" required />
            <input className="cv-input" name="password" type="password" placeholder="Password" required />
            {error ? <div style={{ color: '#EF4444', fontSize: 13 }}>{error}</div> : null}
            <button className="cv-btn" disabled={busy}>{busy ? 'Signing in…' : 'Log in'}</button>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button type="button" className="cv-btn" style={{ flex: 1, background: 'var(--cv-bg-incoming)', color: 'var(--cv-text-primary)', border: '1px solid var(--cv-border)' }} onClick={() => oauth('google')}>Google</button>
              <button type="button" className="cv-btn" style={{ flex: 1, background: 'var(--cv-bg-incoming)', color: 'var(--cv-text-primary)', border: '1px solid var(--cv-border)' }} onClick={() => oauth('apple')}>Apple</button>
            </div>
          </form>
        )}
        <div style={{ fontSize: 11, color: 'var(--cv-text-secondary)', marginTop: 14, textAlign: 'center' }}>
          Sessions persist until you explicitly log out.
        </div>
      </div>
    </div>
  );
}
