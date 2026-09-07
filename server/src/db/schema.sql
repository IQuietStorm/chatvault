-- ChatVault — PostgreSQL 16 DDL
-- Apply: psql "$DATABASE_URL" -f server/src/db/schema.sql
-- Design notes: docs/ChatVault-System-Architecture-Spec-v1.md §2

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_role          AS ENUM ('user','admin');
CREATE TYPE gender_type        AS ENUM ('male','female','non_binary','other','prefer_not_to_say');
CREATE TYPE oauth_provider     AS ENUM ('google','apple');
CREATE TYPE conversation_type  AS ENUM ('direct','group');
CREATE TYPE message_type       AS ENUM ('text','media','system');
CREATE TYPE media_kind         AS ENUM ('image','audio','video','voice_note','document');
CREATE TYPE media_view_policy  AS ENUM ('standard','view_once');
CREATE TYPE session_status     AS ENUM ('active','revoked','expired');

CREATE TABLE users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username          VARCHAR(32)  NOT NULL,
  full_name         VARCHAR(120) NOT NULL,
  email             VARCHAR(255),
  phone_number      VARCHAR(32),
  password_hash     TEXT,
  oauth_identities  JSONB NOT NULL DEFAULT '[]',
  gender            gender_type,
  date_of_birth     DATE         NOT NULL,
  is_age_verified   BOOLEAN      NOT NULL DEFAULT FALSE,
  avatar_url        TEXT,
  device_location   JSONB,
  last_login_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT uq_users_username UNIQUE (username),
  CONSTRAINT uq_users_email    UNIQUE (email),
  CONSTRAINT uq_users_phone    UNIQUE (phone_number),
  -- Last-birthday rule (18th birthday already passed) enforced at DB level too
  CONSTRAINT chk_users_dob CHECK (
    date_of_birth <= (CURRENT_DATE - INTERVAL '18 years')
    AND date_of_birth >= '1900-01-01'
  )
);

CREATE TABLE sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_jti   UUID NOT NULL,
  refresh_hash  CHAR(64) NOT NULL,
  user_agent    TEXT,
  device_name   TEXT,
  ip_address    INET,
  status        session_status NOT NULL DEFAULT 'active',
  issued_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ  NOT NULL,
  last_seen_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  revoked_at    TIMESTAMPTZ
);
CREATE INDEX idx_sessions_user       ON sessions (user_id, status);
CREATE UNIQUE INDEX uq_sessions_hash ON sessions (refresh_hash);

CREATE TABLE conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type            conversation_type NOT NULL DEFAULT 'direct',
  title           VARCHAR(160),
  participant_ids UUID[] NOT NULL,
  created_by      UUID NOT NULL REFERENCES users(id),
  last_message_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at     TIMESTAMPTZ
);
CREATE INDEX idx_conversations_participants ON conversations USING GIN (participant_ids);
CREATE INDEX idx_conversations_recency      ON conversations (last_message_at DESC);

CREATE TABLE media_attachments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uploader_id      UUID NOT NULL REFERENCES users(id),
  message_id       UUID,
  kind             media_kind NOT NULL,
  view_policy      media_view_policy NOT NULL DEFAULT 'standard',
  bucket           TEXT NOT NULL,
  object_key       TEXT NOT NULL,
  mime_type        TEXT NOT NULL,
  size_bytes       BIGINT NOT NULL,
  sha256_checksum  CHAR(64),
  width_px         INT,
  height_px        INT,
  duration_ms      INT,
  one_time_token   UUID,
  token_expires_at TIMESTAMPTZ,
  viewed_at        TIMESTAMPTZ,
  destructed_at    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_media_object UNIQUE (bucket, object_key)
);
CREATE INDEX idx_media_message  ON media_attachments (message_id);
CREATE INDEX idx_media_viewonce ON media_attachments (view_policy, token_expires_at)
  WHERE view_policy = 'view_once' AND viewed_at IS NULL;

CREATE TABLE messages (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id     UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id           UUID NOT NULL REFERENCES users(id),
  type                message_type NOT NULL DEFAULT 'text',
  body                TEXT,
  media_attachment_id UUID REFERENCES media_attachments(id),
  is_view_once        BOOLEAN NOT NULL DEFAULT FALSE,
  delivered_to        UUID[] NOT NULL DEFAULT '{}',
  read_by             UUID[] NOT NULL DEFAULT '{}',
  reply_to_message_id UUID REFERENCES messages(id),
  client_msg_id       UUID NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ,
  CONSTRAINT uq_messages_client UNIQUE (sender_id, client_msg_id)
);
CREATE INDEX idx_messages_conv_created ON messages (conversation_id, created_at);
CREATE INDEX idx_messages_sender       ON messages (sender_id, created_at DESC);

CREATE TABLE user_preferences (
  user_id            UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  theme              TEXT NOT NULL DEFAULT 'system',
  chat_wallpaper_url TEXT,
  font_scale         REAL NOT NULL DEFAULT 1.0,
  language           TEXT NOT NULL DEFAULT 'en',
  notification_prefs JSONB NOT NULL DEFAULT '{"messages":true,"calls":true}',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
