import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import Redis from 'ioredis';
import { config } from '../config';
import { query } from '../db/database';

const ALLOWED: Record<string, { kind: string; maxBytes: number }> = {
  'image/jpeg': { kind: 'image', maxBytes: 25 * 1024 * 1024 },
  'image/png': { kind: 'image', maxBytes: 25 * 1024 * 1024 },
  'image/webp': { kind: 'image', maxBytes: 25 * 1024 * 1024 },
  'audio/mpeg': { kind: 'audio', maxBytes: 50 * 1024 * 1024 },
  'audio/mp4': { kind: 'audio', maxBytes: 50 * 1024 * 1024 },
  'audio/wav': { kind: 'audio', maxBytes: 50 * 1024 * 1024 },
  'audio/ogg': { kind: 'voice_note', maxBytes: 20 * 1024 * 1024 },
  'video/mp4': { kind: 'video', maxBytes: 200 * 1024 * 1024 },
  'application/pdf': { kind: 'document', maxBytes: 50 * 1024 * 1024 },
  'text/plain': { kind: 'document', maxBytes: 10 * 1024 * 1024 },
  'application/zip': { kind: 'document', maxBytes: 100 * 1024 * 1024 },
};

async function s3(): Promise<S3Client> {
  return new S3Client({
    region: config.s3.region,
    credentials: config.s3.accessKeyId
      ? { accessKeyId: config.s3.accessKeyId!, secretAccessKey: config.s3.secretAccessKey! }
      : undefined, // IAM role in production
  });
}

interface AttachmentRow {
  id: string;
  message_id: string | null;
  conversation_id: string;
  kind: string;
  view_policy: string;
  bucket: string;
  object_key: string;
  one_time_token: string | null;
  token_expires_at: string | null;
  viewed_at: string | null;
}

@Injectable()
export class MediaService {
  private redis = new Redis(config.redisUrl);

  /** Preflight + presigned PUT — media bytes never touch the API server. */
  async presignPut(uploaderId: string, mimeType: string, sizeBytes: number, viewPolicy: 'standard' | 'view_once' = 'standard') {
    const rule = ALLOWED[mimeType];
    if (!rule) throw new ForbiddenException('unsupported media type');
    if (sizeBytes > rule.maxBytes) throw new ForbiddenException('file too large');

    const id = randomUUID();
    const ext = mimeType.split('/')[1] ?? 'bin';
    const objectKey = `media/${uploaderId}/${id}.${ext}`;
    const bucket = config.s3.bucket;

    await query(
      `INSERT INTO media_attachments (id, uploader_id, kind, view_policy, bucket, object_key, mime_type, size_bytes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, uploaderId, rule.kind, viewPolicy, bucket, objectKey, mimeType, sizeBytes],
    );

    const url = await getSignedUrl(
      await s3(),
      new PutObjectCommand({ Bucket: bucket, Key: objectKey, ContentType: mimeType }),
      { expiresIn: 600 }, // 10-min upload window
    );
    return { attachment_id: id, upload_url: url, object_key: objectKey, expires_at: new Date(Date.now() + 600_000).toISOString() };
  }

  /** Standard media download — short-lived (60s) presigned GET. */
  async presignGet(attachmentId: string) {
    const rows = await query<AttachmentRow>(
      `SELECT * FROM media_attachments WHERE id = $1 AND destructed_at IS NULL`, [attachmentId],
    );
    const att = rows[0];
    if (!att) throw new NotFoundException('attachment not found');
    if (!att.message_id) throw new ForbiddenException('attachment not attached to a message yet');
    const url = await getSignedUrl(
      await s3(),
      new GetObjectCommand({ Bucket: att.bucket, Key: att.object_key }),
      { expiresIn: 60 },
    );
    return { attachment_id: att.id, presigned_url: url, presigned_url_expires_at: new Date(Date.now() + 60_000).toISOString() };
  }

  /**
   * VIEW-ONCE step 2 — arm the one-time token and issue a 30-second TTL
   * presigned URL bound to it. Only the intended recipient (a conversation
   * participant who is NOT the sender) may request it.
   */
  async armViewOnce(attachmentId: string, messageId: string, requesterId: string) {
    const rows = await query<AttachmentRow>(
      `SELECT a.*, m.conversation_id
       FROM media_attachments a
       JOIN messages m ON m.id = a.message_id
       JOIN conversations c ON c.id = m.conversation_id
       WHERE a.id = $1 AND a.view_policy = 'view_once' AND a.message_id = $2
         AND a.viewed_at IS NULL AND a.destructed_at IS NULL
         AND m.sender_id <> $3 AND $3::uuid = ANY(c.participant_ids)`,
      [attachmentId, messageId, requesterId],
    );
    const att = rows[0] as AttachmentRow & { conversation_id: string };
    if (!att) throw new ForbiddenException('view-once media not available');

    const token = randomUUID();
    const ttl = config.viewOnceTtlSeconds; // 30
    await query(
      `UPDATE media_attachments SET one_time_token=$1, token_expires_at=now() + ($2 || ' seconds')::interval WHERE id=$3`,
      [token, String(ttl), attachmentId],
    );
    await this.redis.setex(`vo:${token}`, ttl, attachmentId);

    const url = await getSignedUrl(
      await s3(),
      new GetObjectCommand({ Bucket: att.bucket, Key: att.object_key }),
      { expiresIn: ttl },
    );
    return {
      one_time_token: token,
      presigned_url: url,
      expires_at: new Date(Date.now() + ttl * 1000).toISOString(),
      view_window_seconds: ttl,
    };
  }

  /**
   * VIEW-ONCE step 3/4 — verify consumption, mark viewed, revoke the token,
   * delete the S3 object, and broadcast destruction. One consume only.
   */
  async consumeViewOnce(attachmentId: string, messageId: string, consumerId: string) {
    const rows = await query<AttachmentRow & { conversation_id: string }>(
      `SELECT a.*, m.conversation_id
       FROM media_attachments a JOIN messages m ON m.id = a.message_id
       WHERE a.id = $1 AND a.message_id = $2 AND a.viewed_at IS NULL AND m.sender_id <> $3`,
      [attachmentId, messageId, consumerId],
    );
    const att = rows[0];
    if (!att) return null;
    if (att.one_time_token) await this.redis.del(`vo:${att.one_time_token}`);

    await query(
      `UPDATE media_attachments SET viewed_at=now(), one_time_token=NULL, token_expires_at=NULL, destructed_at=now()
       WHERE id=$1 AND viewed_at IS NULL`,
      [attachmentId],
    );
    // Object removal — fire-and-forget; nightly purge also sweeps orphans.
    void (async () => {
      try {
        const client = await s3();
        await client.send(new DeleteObjectCommand({ Bucket: att.bucket, Key: att.object_key }));
      } catch { /* lifecycle job retries */ }
    })();
    return { conversation_id: att.conversation_id, opened_at: new Date().toISOString() };
  }

  /** Nightly sweep: view-once rows never consumed within 24h of expiry. */
  async purgeExpired(): Promise<number> {
    const res = await query(
      `UPDATE media_attachments SET destructed_at=now()
       WHERE view_policy='view_once' AND viewed_at IS NULL AND destructed_at IS NULL
         AND token_expires_at < now() - INTERVAL '24 hours'
       RETURNING id`,
    );
    return res.length;
  }
}
