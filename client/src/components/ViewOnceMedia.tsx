import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { ViewOnceGrantPayload } from '@chatvault/shared';
import { randomUUID } from '../lib/id';

interface Props {
  socket: Socket;
  attachmentId: string;
  messageId: string;
}

type Stage = 'idle' | 'requesting' | 'granted' | 'opened';

/**
 * View-once media client state machine:
 * idle → (tap) request → granted (30s TTL URL + countdown) → consumed (ack) → opened.
 * The server revokes the one-time token and deletes the S3 object on consume.
 */
export function ViewOnceMedia({ socket, attachmentId, messageId }: Props) {
  const [stage, setStage] = useState<Stage>('idle');
  const [grant, setGrant] = useState<ViewOnceGrantPayload | null>(null);
  const [remaining, setRemaining] = useState(30);
  const consumed = useRef(false);

  useEffect(() => {
    if (stage !== 'granted' || !grant) return;
    const finish = (ms: number) => {
      setRemaining(Math.max(0, Math.ceil(ms / 1000)));
    };
    const iv = setInterval(() => finish(new Date(grant.expires_at).getTime() - Date.now()), 250);
    return () => clearInterval(iv);
  }, [stage, grant]);

  const consume = useCallback(() => {
    if (consumed.current) return;
    consumed.current = true;
    socket.emit('media.view_once.consumed', { attachment_id: attachmentId, message_id: messageId });
    setStage('opened');
  }, [socket, attachmentId, messageId]);

  // Window expired without explicit consume → still ack (server marks viewed).
  useEffect(() => {
    if (stage === 'granted' && remaining <= 1) consume();
  }, [stage, remaining, consume]);

  const request = () => {
    if (stage !== 'idle') return;
    setStage('requesting');
    const onGrant = (p: ViewOnceGrantPayload) => {
      if (p.attachment_id !== attachmentId) return;
      socket.off('media.view_once.grant', onGrant);
      setGrant(p);
      setStage('granted');
    };
    socket.on('media.view_once.grant', onGrant);
    socket.emit('media.view_once.request', { attachment_id: attachmentId, message_id: messageId });
    setTimeout(() => socket.off('media.view_once.grant', onGrant), 15_000);
  };

  const cid = randomUUID();

  if (stage === 'granted' && grant) {
    return (
      <div style={{ position: 'relative', minWidth: 200, minHeight: 110 }}>
        <img src={grant.presigned_url} alt="View-once media" style={{ width: '100%', borderRadius: 10, display: 'block' }} />
        <div
          style={{
            position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,.65)', color: '#fff',
            borderRadius: 12, padding: '2px 10px', fontSize: 12, fontWeight: 600,
          }}
        >
          🔒 {remaining}s
        </div>
        <button className="cv-btn" style={{ marginTop: 8, width: '100%', fontSize: 12, padding: 6 }} onClick={consume}>
          Mark as viewed
        </button>
      </div>
    );
  }

  if (stage === 'opened') {
    return <div style={{ fontSize: 13, opacity: 0.85 }}>✅ Opened · media destroyed on server</div>;
  }

  return (
    <button
      className="cv-btn"
      style={{ fontSize: 13, padding: '14px 18px', width: '100%' }}
      onClick={request}
      disabled={stage === 'requesting'}
    >
      {stage === 'requesting' ? '⏳ Opening…' : '🔒 View-once media · tap to open'}
      <div style={{ fontSize: 10, opacity: 0.85, marginTop: 4 }}>opens once · 30s window · auto-destroy</div>
      <div style={{ display: 'none' }}>{cid}</div>
    </button>
  );
}
