import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { query } from '../db/database';

interface ConvRow {
  id: string;
  type: string;
  title: string | null;
  participant_ids: string[];
  last_message_at: string | null;
  created_at: string;
}

export interface NewMessage {
  conversation_id: string;
  sender_id: string;
  type: 'text' | 'media' | 'system';
  body: string | null; // text content or media caption
  media_attachment_id?: string | null;
  is_view_once?: boolean;
  reply_to_message_id?: string | null;
  client_msg_id: string;
}

@Injectable()
export class ChatService {
  /** Direct conversation = unique unordered 2-user pair; group = participant array. */
  async getOrCreateDirect(userA: string, userB: string): Promise<string> {
    const rows = await query<ConvRow>(
      `SELECT id FROM conversations
       WHERE type='direct' AND participant_ids @> $1::uuid[] AND participant_ids @> $2::uuid[]
       LIMIT 1`,
      [[userA], [userB]],
    );
    if (rows[0]) return rows[0].id;
    const created = await query<ConvRow>(
      `INSERT INTO conversations (type, participant_ids, created_by)
       VALUES ('direct', $1::uuid[], $2) RETURNING id`,
      [[userA, userB], userA],
    );
    return created[0].id;
  }

  async listForUser(userId: string, limit = 50): Promise<ConvRow[]> {
    return query<ConvRow>(
      `SELECT * FROM conversations
       WHERE participant_ids @> $1::uuid[] AND archived_at IS NULL
       ORDER BY last_message_at DESC NULLS LAST
       LIMIT $2`,
      [[userId], limit],
    );
  }

  /** Cursor-paginated history: messages strictly older than `before`. */
  async history(conversationId: string, before?: string, limit = 50): Promise<any[]> {
    const rows = before
      ? await query(
          `SELECT m.*, a.kind, a.mime_type, a.size_bytes, a.view_policy, a.duration_ms
           FROM messages m LEFT JOIN media_attachments a ON a.id = m.media_attachment_id
           WHERE m.conversation_id = $1 AND m.created_at < $2 AND m.deleted_at IS NULL
           ORDER BY m.created_at DESC LIMIT $3`,
          [conversationId, before, limit],
        )
      : await query(
          `SELECT m.*, a.kind, a.mime_type, a.size_bytes, a.view_policy, a.duration_ms
           FROM messages m LEFT JOIN media_attachments a ON a.id = m.media_attachment_id
           WHERE m.conversation_id = $1 AND m.deleted_at IS NULL
           ORDER BY m.created_at DESC LIMIT $2`,
          [conversationId, limit],
        );
    return rows.reverse();
  }

  /**
   * Persist a message. client_msg_id (unique per sender) makes retries
   * idempotent — the same cid never creates a duplicate row.
   */
  async saveMessage(msg: NewMessage): Promise<any> {
    const id = randomUUID();
    try {
      const rows = await query(
        `INSERT INTO messages
           (id, conversation_id, sender_id, type, body, media_attachment_id,
            is_view_once, reply_to_message_id, client_msg_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING *`,
        [
          id, msg.conversation_id, msg.sender_id, msg.type, msg.body,
          msg.media_attachment_id ?? null,
          msg.is_view_once ?? false,
          msg.reply_to_message_id ?? null,
          msg.client_msg_id,
        ],
      );
      if (msg.media_attachment_id) {
        await query(`UPDATE media_attachments SET message_id = $1 WHERE id = $2`, [id, msg.media_attachment_id]);
      }
      await query(`UPDATE conversations SET last_message_at = now() WHERE id = $1`, [msg.conversation_id]);
      return rows[0];
    } catch (e: any) {
      if (String(e.code) === '23505') {
        // Duplicate client_msg_id → return the existing row (idempotent ack)
        const existing = await query(`SELECT * FROM messages WHERE sender_id=$1 AND client_msg_id=$2`, [msg.sender_id, msg.client_msg_id]);
        return existing[0];
      }
      throw e;
    }
  }

  async markRead(conversationId: string, userId: string, messageIds: string[]) {
    await query(
      `UPDATE messages
       SET read_by = ARRAY(SELECT DISTINCT unnest(read_by || $1::uuid[]))
       WHERE conversation_id = $2 AND id = ANY($3::uuid[]) AND NOT (read_by @> $1::uuid[])`,
      [[userId], conversationId, messageIds],
    );
  }
}
