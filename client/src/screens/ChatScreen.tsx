import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { MessageNewPayload, MediaKind } from '@chatvault/shared';
import { createChatSocket } from '../socket/client';
import { apiGet, apiPost } from '../lib/api';
import { useAuth } from '../store/auth';
import { useTheme } from '../hooks/useTheme';
import { MessageBubble } from '../components/MessageBubble';
import { CallOverlay } from '../components/CallOverlay';
import { SettingsScreen } from './SettingsScreen';
import { randomUUID } from '../lib/id';

interface Conversation {
  id: string;
  type: 'direct' | 'group';
  title: string | null;
  participant_ids: string[];
  last_message_at: string | null;
}

interface HistoryRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  type: string;
  body: string | null;
  is_view_once: boolean;
  created_at: string;
  client_msg_id: string;
  reply_to_message_id?: string | null;
  media_attachment_id?: string | null;
  kind?: MediaKind;
  mime_type?: string | null;
  size_bytes?: number | null;
  view_policy?: 'standard' | 'view_once' | null;
  duration_ms?: number | null;
}

function toMessagePayload(row: HistoryRow): MessageNewPayload {
  return {
    message_id: row.id,
    conversation_id: row.conversation_id,
    sender_id: row.sender_id,
    type: row.type as MessageNewPayload['type'],
    body: row.body,
    is_view_once: row.is_view_once,
    reply_to_message_id: row.reply_to_message_id,
    client_msg_id: row.client_msg_id,
    created_at: row.created_at,
    ...(row.media_attachment_id && row.kind && row.mime_type && row.size_bytes != null && row.view_policy
      ? {
          media: {
            attachment_id: row.media_attachment_id,
            kind: row.kind,
            mime_type: row.mime_type,
            size_bytes: row.size_bytes,
            view_policy: row.view_policy,
            ...(row.duration_ms != null ? { duration_ms: row.duration_ms } : {}),
          },
        }
      : {}),
  };
}

export function ChatScreen() {
  const { accessToken, user, clear } = useAuth();
  const { setTheme } = useTheme();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageNewPayload[]>([]);
  const [draft, setDraft] = useState('');
  const [caption, setCaption] = useState('');
  const [typing, setTyping] = useState<Set<string>>(new Set());
  const [showSettings, setShowSettings] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const myId = user?.id ?? '';
  const active = convs.find((c) => c.id === activeId) ?? null;
  const peerId = active ? active.participant_ids.find((p) => p !== myId) ?? null : null;

  /* ---- socket lifecycle + listeners ---- */
  useEffect(() => {
    if (!accessToken) return;
    const s = createChatSocket(accessToken);
    setSocket(s);
    s.on('connect', () => {
      void apiGet<Conversation[]>('/conversations?limit=50', accessToken).then(setConvs).catch(() => {});
    });
    s.on('message.new', (m: MessageNewPayload) => {
      setMessages((prev) => (prev.some((x) => x.message_id === m.message_id) ? prev : [...prev, m]));
      // Receipts: auto-mark messages from others as read in the active thread.
      if (m.sender_id !== myId && m.conversation_id === activeId && activeId) {
        s.emit('message.read', { conversation_id: activeId, message_ids: [m.message_id] });
      }
    });
    s.on('typing.start', (p: { conversation_id: string; user_id: string; user_name?: string }) => {
      if (p.conversation_id === activeId && p.user_id !== myId) {
        setTyping((t) => new Set(t).add(p.user_name ?? p.user_id));
      }
    });
    s.on('typing.stop', (p: { conversation_id: string; user_id: string }) => {
      if (p.conversation_id === activeId) {
        setTyping((t) => {
          const n = new Set(t);
          n.delete(p.user_id);
          return n;
        });
      }
    });
    return () => {
      s.disconnect();
      setSocket(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  /* ---- history load + room join ---- */
  useEffect(() => {
    if (!activeId || !accessToken) return;
    setMessages([]);
    void apiGet<HistoryRow[]>(`/conversations/${activeId}/messages?limit=50`, accessToken)
      .then((rows) => setMessages(rows.map(toMessagePayload)))
      .catch(() => {});
    socket?.emit('conversation.join', { conversation_id: activeId });
  }, [activeId, accessToken, socket]);

  /* ---- send text ---- */
  const sendText = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!socket || !activeId || !draft.trim()) return;
      const cid = randomUUID();
      socket.emit('message.send', {
        conversation_id: activeId, type: 'text' as const, body: draft.trim(), client_msg_id: cid,
      });
      setDraft('');
    },
    [socket, activeId, draft],
  );

  /* ---- send media (presigned PUT → message.send with optional caption) ---- */
  const onPickFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file || !socket || !activeId || !accessToken) return;
      try {
        const pre = await apiPost<{ attachment_id: string; upload_url: string }>(
          '/media/presign',
          { mime_type: file.type, size_bytes: file.size, view_policy: 'standard' },
          accessToken,
        );
        await fetch(pre.upload_url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
        socket.emit('message.send', {
          conversation_id: activeId,
          type: 'media' as const,
          caption: caption.trim() || undefined,
          client_msg_id: randomUUID(),
          media: { attachment_id: pre.attachment_id, kind: 'image', mime_type: file.type, size_bytes: file.size, view_policy: 'standard' },
        });
        setCaption('');
      } catch (err: any) {
        alert(err.message);
      }
    },
    [socket, activeId, accessToken, caption],
  );

  const logout = useCallback(async () => {
    if (accessToken) await apiPost('/auth/logout', {}, accessToken).catch(() => {});
    clear();
  }, [accessToken, clear]);

  const startWallpaper = () => {
    if (!socket) return;
    socket.emit('typing.start', { conversation_id: activeId ?? '', user_id: myId, user_name: user?.full_name });
    const stop = () => socket.emit('typing.stop', { conversation_id: activeId ?? '', user_id: myId });
    socket.emit('typing.stop', { conversation_id: activeId ?? '', user_id: myId });
    void stop;
  };

  if (showSettings) {
    return <SettingsScreen onClose={() => setShowSettings(false)} />;
  }

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      {/* Chat list rail */}
      <aside className="cv-card" style={{ width: 300, margin: 8, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--cv-brand-gradient)' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>{user?.full_name ?? 'ChatVault'}</div>
            <div style={{ fontSize: 12, color: 'var(--cv-text-secondary)' }}>@{user?.username ?? ''}</div>
          </div>
          <button className="cv-btn" style={{ padding: '6px 10px', fontSize: 12 }} onClick={() => setShowSettings(true)}>⚙️</button>
        </div>
        <input className="cv-input" placeholder="Search chats…" style={{ margin: '0 12px 8px' }} />
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {convs.map((c) => (
            <div
              key={c.id}
              onClick={() => setActiveId(c.id)}
              style={{
                padding: '10px 16px', cursor: 'pointer', borderLeft: activeId === c.id ? '3px solid var(--cv-accent)' : '3px solid transparent',
                background: activeId === c.id ? 'var(--cv-primary-soft)' : 'transparent',
              }}
            >
              <div style={{ fontWeight: 500, fontSize: 14 }}>{c.title ?? c.participant_ids.filter((p) => p !== myId).join(', ')}</div>
              <div style={{ fontSize: 12, color: 'var(--cv-text-secondary)' }}>{c.last_message_at ? new Date(c.last_message_at).toLocaleString() : 'New conversation'}</div>
            </div>
          ))}
        </div>
        <button className="cv-btn" style={{ margin: 12, background: 'var(--cv-bg-incoming)', color: 'var(--cv-text-primary)', border: '1px solid var(--cv-border)' }} onClick={logout}>
          Logout (explicit — session stays until clicked)
        </button>
      </aside>

      {/* Chat pane */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, margin: '8px 8px 8px 0' }}>
        <header className="cv-card" style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--cv-bg-subtle, var(--cv-bg-incoming))' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{active?.title ?? (peerId ? 'Conversation' : 'No chat selected')}</div>
            <div style={{ fontSize: 12, color: 'var(--cv-text-secondary)' }}>
              {typing.size > 0 ? `${[...typing].join(', ')} typing…` : active ? 'online' : ''}
            </div>
          </div>
          {['🌙','☀️'].map((_, i) => null)}
          <select
            className="cv-input" style={{ width: 110, padding: '6px 8px', fontSize: 12 }}
            defaultValue="system"
            onChange={(e) => setTheme(e.target.value as 'light' | 'dark' | 'system')}
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="system">System</option>
          </select>
        </header>

        {/* Universal wallpaper applies to this scroll container in every thread */}
        <div className="cv-chat-wallpaper" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, padding: 16 }}>
          {messages.map((m) => (
            <MessageBubble key={m.message_id} message={m} own={m.sender_id === myId} socket={socket!} />
          ))}
        </div>

        <footer className="cv-card" style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '10px 12px' }}>
          <button className="cv-btn" style={{ padding: '8px', background: 'var(--cv-bg-incoming)', border: '1px solid var(--cv-border)' }} onClick={() => fileRef.current?.click()} title="Attach media">📎</button>
          <input ref={fileRef} type="file" hidden onChange={onPickFile} />
          <input className="cv-input" placeholder="Caption (optional)" value={caption} onChange={(e) => setCaption(e.target.value)} style={{ flex: 0.4 }} />
          <form onSubmit={sendText} style={{ flex: 1, display: 'flex', gap: 8 }}>
            <input className="cv-input" placeholder="Message" value={draft} onChange={(e) => { setDraft(e.target.value); startWallpaper(); }} />
            <button className="cv-btn" disabled={!draft.trim()}>➤</button>
          </form>
        </footer>
      </main>

      {socket && peerId ? <CallOverlay socket={socket} myId={myId} peerId={peerId} /> : null}
    </div>
  );
}
