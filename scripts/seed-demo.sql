-- ChatVault demo seed — two users, one direct conversation, text + view-once rows.
-- NOTE: password_hash is NULL here; in real onboarding the server argon2-hashes
-- the password (argon2.hash(password)) — see server/src/auth/auth.service.ts.
-- Apply after schema.sql: psql "$DATABASE_URL" -f scripts/seed-demo.sql

INSERT INTO users (id, username, full_name, email, phone_number, gender, date_of_birth, is_age_verified, avatar_url)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'mayac', 'Maya Chen', 'maya@example.com', '+12025550101', 'female', '1995-03-12', true, NULL),
  ('00000000-0000-4000-8000-000000000002', 'arjunp', 'Arjun Patel', 'arjun@example.com', '+12025550102', 'male', '1992-07-24', true, NULL)
ON CONFLICT (email) DO NOTHING;

INSERT INTO user_preferences (user_id, theme, chat_wallpaper_url)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'dark', NULL),
  ('00000000-0000-4000-8000-000000000002', 'light', NULL)
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO conversations (id, type, participant_ids, created_by, last_message_at)
VALUES ('00000000-0000-4000-8000-000000000010', 'direct',
        ARRAY['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002'],
        '00000000-0000-4000-8000-000000000001', now());

INSERT INTO messages (id, conversation_id, sender_id, type, body, client_msg_id, created_at)
VALUES
  ('00000000-0000-4000-8000-000000000021',
   '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000001',
   'text', 'Spec is in the drive — review before standup?', 'seeddemo-0001', now() - interval '2 hours'),
  ('00000000-0000-4000-8000-000000000022',
   '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000002',
   'text', 'On it 🚀', 'seeddemo-0002', now() - interval '1 hour');

-- View-once example: create the attachment row + message (object not uploaded —
-- replace object_key with a real S3 PUT from a dev client to test the full flow).
INSERT INTO media_attachments (id, uploader_id, message_id, kind, view_policy, bucket, object_key, mime_type, size_bytes)
VALUES ('00000000-0000-4000-8000-000000000031',
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000023',
        'image', 'view_once', 'chatvault-media', 'media/demo/viewonce.jpg', 'image/jpeg', 1048576);

INSERT INTO messages (id, conversation_id, sender_id, type, body, media_attachment_id, is_view_once, client_msg_id, created_at)
VALUES ('00000000-0000-4000-8000-000000000023',
        '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000001',
        'media', 'Sunset from the rooftop 📍',
        '00000000-0000-4000-8000-000000000031', true,
        'seeddemo-0003', now() - interval '30 minutes');
