import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Socket } from 'socket.io-client';
import type { MessageNewPayload, MediaKind } from '@chatvault/shared';
import { apiGet } from '../lib/api';
import { useAuth } from '../store/auth';
import { ViewOnceMedia } from './ViewOnceMedia';

function kindGlyph(kind: MediaKind): string {
  return { image: '🖼', video: '🎬', audio: '🎵', voice_note: '🎙', document: '📄' }[kind] ?? '📎';
}

interface Props {
  message: MessageNewPayload;
  own: boolean;
  socket: Socket;
}

/** Incoming/outgoing bubble. Outgoing = brand gradient; media renders with optional caption. */
export function MessageBubble({ message, own, socket }: Props) {
  const accessToken = useAuth((s) => s.accessToken);
  const [presigned, setPresigned] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    if (message.media && !message.is_view_once && !presigned && accessToken) {
      void apiGet<{ presigned_url: string }>(`/media/${message.media.attachment_id}/presigned`, accessToken)
        .then((r) => setPresigned(r.presigned_url))
        .catch(() => {});
    }
  }, [message, presigned, accessToken]);

  useEffect(() => {
    const onDestroyed = (p: { message_id: string }) => {
      if (p.message_id === message.message_id) setOpened(true);
    };
    socket.on('media.view_once.destroyed', onDestroyed);
    return () => {
      socket.off('media.view_once.destroyed', onDestroyed);
    };
  }, [socket, message.message_id]);

  const body = useMemo(() => {
    if (message.is_view_once && !opened) return null;
    if (message.type === 'text') return null;
    if (!message.media) return null;

    switch (message.media.kind) {
      case 'image':
        return presigned ? <img src={presigned} alt="" style={{ maxWidth: 260, borderRadius: 10, display: 'block' }} /> : <span>{kindGlyph('image')} image</span>;
      case 'video':
        return presigned ? (
          <video src={presigned} controls style={{ maxWidth: 260, borderRadius: 10, maxHeight: 220 }} />
        ) : (<span>{kindGlyph('video')} video</span>);
      case 'audio':
      case 'voice_note':
        return presigned ? <audio src={presigned} controls style={{ maxWidth: 240 }} /> : <span>{kindGlyph(message.media.kind)} audio</span>;
      default:
        return presigned ? <a href={presigned} target="_blank" rel="noreferrer">📄 open document</a> : <span>{kindGlyph('document')} document</span>;
    }
  }, [message, presigned, opened]);

  const style: CSSProperties = own
    ? { background: 'var(--cv-bg-outgoing)', color: 'var(--cv-text-on-brand)', alignSelf: 'flex-end', borderRadius: '14px 4px 14px 14px' }
    : { background: 'var(--cv-bg-incoming)', alignSelf: 'flex-start', borderRadius: '4px 14px 14px 14px' };

  return (
    <div style={{ ...style, padding: '8px 12px', maxWidth: '72%', boxShadow: 'var(--cv-shadow)', wordBreak: 'break-word' }}>
      {message.is_view_once && !opened ? (
        <ViewOnceMedia socket={socket} attachmentId={message.media!.attachment_id} messageId={message.message_id} />
      ) : (
        <>
          {body}
          {message.body ? <div style={{ marginTop: body ? 6 : 0, fontSize: 14 }}>{message.body}</div> : null}
          <div style={{ textAlign: 'right', fontSize: 10, opacity: 0.8, marginTop: 2 }}>
            {message.is_view_once ? (opened ? '✅ Opened' : '🔒 view-once') : ''}
            {' '}
            {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        </>
      )}
    </div>
  );
}
