/**
 * ChatVault wire contract — versioned envelope.
 *
 * Every WebSocket frame uses this single envelope. `cid` (client id) is the
 * idempotency key: the server dedupes against messages.client_msg_id and the
 * `.ack` echoes the originating `cid` so callers can correlate.
 */

export const WS_PROTOCOL_VERSION = 1;

export interface WsEnvelope<T = unknown> {
  /** Protocol version (1). */
  v: typeof WS_PROTOCOL_VERSION;
  /** Server event name, e.g. "message.send", "message.ack", "call.offer". */
  event: string;
  /** Client-generated correlation/idempotency id. */
  cid?: string;
  /** ISO-8601 timestamp (client → server; server stamps its own frames). */
  ts?: string;
  payload: T;
}

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

export type MessageKind = 'text' | 'media' | 'system';
export type MediaKind = 'image' | 'audio' | 'video' | 'voice_note' | 'document';
export type ViewPolicy = 'standard' | 'view_once';

export interface MediaAttachmentRef {
  attachment_id: string;
  kind: MediaKind;
  mime_type: string;
  size_bytes: number;
  width_px?: number;
  height_px?: number;
  duration_ms?: number;
  view_policy: ViewPolicy;
  presigned_url?: string;
  presigned_url_expires_at?: string;
}

export interface SendTextPayload {
  conversation_id: string;
  type: 'text';
  body: string;
  client_msg_id: string;
  reply_to_message_id?: string;
}

export interface SendMediaPayload {
  conversation_id: string;
  type: 'media';
  /** Optional caption attached to the media payload. */
  caption?: string;
  /** Optional reply-to reference on media messages. */
  reply_to_message_id?: string;
  client_msg_id: string;
  media: MediaAttachmentRef & { attachment_id: string };
}

export interface MessageAckPayload {
  status: 'ok' | 'error';
  code?: string;
  message_id?: string;
  created_at?: string;
}

export interface MessageNewPayload {
  message_id: string;
  conversation_id: string;
  sender_id: string;
  type: MessageKind;
  body: string | null; // text or caption
  media?: MediaAttachmentRef;
  is_view_once: boolean;
  reply_to_message_id?: string | null;
  client_msg_id: string;
  created_at: string;
}

export interface ReadReceiptPayload {
  conversation_id: string;
  user_id: string;
  message_ids: string[];
}

/* ------------------------------------------------------------------ */
/* View-once media lifecycle (4 steps: request → grant → consumed → destroyed) */
/* ------------------------------------------------------------------ */

export interface ViewOnceRequestPayload {
  attachment_id: string;
  message_id: string;
}

export interface ViewOnceGrantPayload extends ViewOnceRequestPayload {
  one_time_token: string;
  presigned_url: string;
  expires_at: string;
  view_window_seconds: number;
}

export interface ViewOnceConsumedPayload extends ViewOnceRequestPayload {}

export interface ViewOnceDestroyedPayload extends ViewOnceRequestPayload {
  opened_at: string;
}

/* ------------------------------------------------------------------ */
/* Typing / presence / sync                                            */
/* ------------------------------------------------------------------ */

export interface TypingPayload {
  conversation_id: string;
  user_id: string;
  user_name?: string;
}

export interface PresencePayload {
  user_id: string;
  status: 'online' | 'offline';
  last_seen_at: string | null;
}

export interface SyncPayload {
  conversation_id: string;
  /** Fetch messages strictly newer than this cursor (created_at ISO string). */
  since?: string;
}

/* ------------------------------------------------------------------ */
/* VoIP signaling — server relays SDP/ICE only; media flows P2P        */
/* ------------------------------------------------------------------ */

/** Portable SDP/ICE shapes (no DOM lib required on server). */
export type SdpType = 'offer' | 'answer' | 'pranswer' | 'rollback';

export interface SessionDescriptionInit {
  type?: SdpType;
  sdp?: string;
}

export interface IceCandidateInit {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export type CallKind = 'audio' | 'video';

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface CallOfferPayload {
  call_id: string;
  caller_id: string;
  callee_id: string;
  kind: CallKind;
  sdp: SessionDescriptionInit;
  ice_servers: IceServerConfig[];
}

export interface CallAnswerPayload {
  call_id: string;
  caller_id: string;
  callee_id: string;
  sdp: SessionDescriptionInit;
}

export interface CallIcePayload {
  call_id: string;
  from: string;
  candidate: IceCandidateInit;
}

export interface CallEndPayload {
  call_id: string;
  reason: 'caller_hangup' | 'callee_reject' | 'no_answer' | 'timeout' | 'failed';
  duration_ms?: number;
}
