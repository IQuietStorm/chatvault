# ChatVault — System Architecture & Technical Specification

**Version:** 1.0 · **Stage:** Build-Ready Blueprint · **Date:** September 2026
**Scope:** Real-time, cloud-synced multimedia messaging + VoIP (1:1 audio/video) with view-once media, OAuth/JWT identity, and global theming (Blue `#2563EB` / Purple `#9333EA`, Light/Dark, universal chat wallpaper).

---

## 1. System Architecture Overview

### 1.1 Design Goals

| Goal | Requirement it satisfies |
|---|---|
| Real-time delivery < 100ms (p99) | WebSocket/Socket.IO fan-out with Redis pub/sub |
| Full cross-device history sync | Every message persisted in PostgreSQL; clients fetch paginated history on login |
| Media of all kinds | S3-backed attachments: image, audio, video, voice note, document |
| View-once security | Short-TTL presigned URLs + one-time tokens + server-side invalidation on view |
| Persistent sessions | JWT access token (15 min) + rotating refresh token (30 days) in HTTP-only cookies / SecureStore |
| Strict 18+ rule | DOB validated at the *last birthday* (month/day compare), enforced client + server + DB |
| VoIP 1:1 | WebRTC P2P with TURN fallback; signaling reuses the same socket layer |

### 1.2 Recommended Tech Stack

| Layer | Recommendation | Justification |
|---|---|---|
| **Frontend** | React Native (iOS/Android) + React 18 (Web/PWA), TypeScript, Zustand + React Query, Socket.IO client | One codebase family, native feelings, typed end-to-end |
| **Backend API** | Node.js (NestJS) or Go, REST + JSON | NestJS mirrors the app's modular structure; Go if team wants max throughput |
| **Real-Time Layer** | Socket.IO with Redis adapter (WebSocket transport, long-polling fallback) | Battle-tested rooms, auto-reconnect, horizontal scale-out |
| **Database** | PostgreSQL 16 (primary) + Redis 7 (presence, typing, pub/sub, one-time tokens, rate limits) | Relational integrity for messages + fast ephemeral state |
| **Cloud Storage** | AWS S3 + CloudFront (CDN + signed edge URLs) — Supabase Storage as a managed alternative | Durable object storage, presigned PUT/GET, lifecycle rules |
| **VoIP** | WebRTC + Coturn (TURN) for NAT traversal; LiveKit SFU optional for future group calls | P2P for 1:1; SFU when >2 participants |
| **Push / SMS / OTP** | FCM + APNs; Twilio (or Firebase Auth for SMS OTP) | Offline delivery + phone OTP path |
| **Observability** | OpenTelemetry → Prometheus/Grafana, Sentry | Traces across WS + REST, error tracking |
| **Infra / DevOps** | Docker, Kubernetes (EKS), Terraform, GitHub Actions CI/CD, CloudFront + WAF | Reproducible scale-out, SSO-free managed edge |

### 1.3 Component Architecture

Layered topology (diagram rendered with this reply):

```
[Clients] React Native / React Web
      │  HTTPS REST + WSS (Socket.IO) + WebRTC media
      ▼
[Edge] CloudFront CDN · WAF · API Gateway (REST /auth /users /conversations /media /calls)
      ▼
[API & Real-Time Services] Node.js (NestJS) monolith-first, modular:
      • Auth Service      (register, OTP, OAuth, JWT issue/rotate)
      • Chat Service      (conversations, persistence, fan-out)
      • Media Service     (presign upload/download, view-once lifecycle)
      • VoIP Signaling    (call offer/answer/ICE relay via WS)
      ▼
[Data] PostgreSQL 16 (users, sessions, conversations, messages, media, prefs)
       Redis 7 (presence, typing, WS pub/sub, one-time token cache, rate limits)
       S3 + CloudFront (object storage, presigned URLs, destruction on view)
       [FCM/APNs] push for offline recipients
```

**Key flow — sending a message:**
1. Client opens WSS with `Authorization: Bearer <accessJWT>` in the handshake.
2. Server resolves user, creates/joins rooms: `user:{id}` (personal) and `conv:{id}` (per conversation).
3. Client emits `message.send` with `client_msg_id` (idempotency key).
4. Server validates → persists row to Postgres → backfills `media_attachment.message_id` → emits `message.ack` to sender → broadcasts `message.new` to the conversation room → triggers push to offline members.
5. Recipients ack delivery (`message.delivered`) and read (`message.read`); the server updates the array columns and mirrors state to all devices.

### 1.4 Real-Time Layer Design

- **Rooms:** `user:{id}` for presence, calls, and per-user events; `conv:{id}` for message fan-out.
- **Scale-out:** multiple Socket.IO nodes behind a load balancer with sticky sessions; the **Redis adapter** routes room events across nodes — a message published on Node A reaches subscribers on Node B.
- **Idempotency:** every client event carries `cid` (client id); the server dedupes against `messages.client_msg_id` (unique per sender).
- **Throttling:** typing events coalesced server-side (max 1 broadcast/2s/user/conversation); media solicitations rate-limited per user.
- **Resilience:** automatic reconnect with exponential backoff; on reconnect the client requests `conversation.sync?since=<last_seq>` to fetch anything missed (cursor = `created_at` of last received message).

### 1.5 Cloud Storage & Media Pipeline

- Uploads: client requests `POST /media/presign` → server validates type/size → returns S3 **presigned PUT URL** (10 min TTL) → client uploads directly to S3 → emits `message.send` with attachment id. Bytes never touch the API server.
- Downloads: `standard` media → short-lived (60–300s) presigned GET / CloudFront signed URL generated on demand and cached for burst fan-out.
- **View-once pipeline:** bucket policy denies all anonymous access; only presigned URLs work.
  1. Sender marks `view_policy = view_once`; server reserves `one_time_token` (revoked by default).
  2. When the recipient taps the bubble, client emits `media.view_once.request`.
  3. Server creates a **30-second TTL presigned URL bound to the token**, grants exactly one GET, starts a countdown in the UI.
  4. On decode/playback completion the client emits `media.view_once.consumed`; server sets `viewed_at`, revokes the token in Redis, deletes (or lifecycle-tags) the S3 object, and broadcasts `media.view_once.destroyed` to the room so the bubble becomes "Opened".
  5. If the URL or token expires before consumption, the object is garbage-collected by a nightly job (deletes all `view_once` rows with `viewed_at IS NULL AND token_expires_at < now() - 24h`).
- Lifecycle rules: `standard` media retained per retention policy (e.g., 24 months), voice notes 12 months; S3 Intelligent-Tiering + Glacier for old media.

### 1.6 Deployment Topology & Scaling Targets

- **Phase 1 (MVP):** single-region, monolith API + 2 Socket.IO nodes + RDS (Multi-AZ) + ElastiCache Redis (cluster mode off) + S3 + CloudFront. Handle ~10k concurrent WS connections per node.
- **Phase 2 (growth):** Kubernetes autoscaling on WS connections + CPU; Redis cluster mode on; read replicas for history queries.
- **SLOs:** message p99 end-to-end < 300ms; history load < 500ms for 200 messages; availability 99.9%.
- **Security baseline:** TLS everywhere, KMS for media encryption at rest (SSE-KMS), 2FA-ready by extending sessions with `mfa_checked_at`, WAF rate rules on `/auth/*` and `/media/*`.

---

## 2. Database Schema Design (Relational / SQL)

### 2.1 Conventions

- Primary keys: `UUID` (`gen_random_uuid()`), never expose sequential ids.
- Timestamps: `TIMESTAMPTZ` (UTC); `created_at`/`updated_at` on every table.
- Soft deletes: `deleted_at` on conversations/messages; hard purge via nightly job after grace period.
- Enums via `CREATE TYPE` for data integrity; indexes follow the query patterns in §2.4.

### 2.2 Enumerated Types

```sql
CREATE TYPE user_role          AS ENUM ('user','admin');
CREATE TYPE gender_type        AS ENUM ('male','female','non_binary','other','prefer_not_to_say');
CREATE TYPE oauth_provider     AS ENUM ('google','apple');
CREATE TYPE conversation_type  AS ENUM ('direct','group');
CREATE TYPE message_type       AS ENUM ('text','media','system');
CREATE TYPE media_kind         AS ENUM ('image','audio','video','voice_note','document');
CREATE TYPE media_view_policy  AS ENUM ('standard','view_once');
CREATE TYPE session_status     AS ENUM ('active','revoked','expired');
```

### 2.3 Tables (DDL)

**users** — identity, registration profile, OAuth links, age gate.

```sql
CREATE TABLE users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username          VARCHAR(32)  NOT NULL,            -- unique, editable, 3-32 alnum/underscore
  full_name         VARCHAR(120) NOT NULL,
  email             VARCHAR(255),                     -- NULL for phone-only accounts
  phone_number      VARCHAR(32),                      -- NULL for OAuth-only accounts; E.164
  password_hash     TEXT,                             -- argon2id; NULL for OAuth-only
  oauth_identities  JSONB NOT NULL DEFAULT '[]',      -- [{"provider":"google","subject":"...","email":"...","picture_url":"..."}]
  gender            gender_type,
  date_of_birth     DATE         NOT NULL,
  is_age_verified   BOOLEAN      NOT NULL DEFAULT FALSE,
  avatar_url        TEXT,                             -- custom profile picture (S3 key)
  device_location   JSONB,                            -- {lat, lng, accuracy_m, captured_at} — captured ONCE at registration
  last_login_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT uq_users_username UNIQUE (username),
  CONSTRAINT uq_users_email    UNIQUE (email),
  CONSTRAINT uq_users_phone    UNIQUE (phone_number),
  -- DB-level last-birthday gate: dob+18y must already be <= today (see §3.3 for the app-level check)
  CONSTRAINT chk_users_dob CHECK (
    date_of_birth <= (CURRENT_DATE - INTERVAL '18 years')
    AND date_of_birth >= '1900-01-01'
  )
);
```

**sessions** — one row per logged-in device; refresh tokens stored as hashes only.

```sql
CREATE TABLE sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_jti   UUID NOT NULL,                 -- random id embedded in the refresh JWT
  refresh_hash  CHAR(64) NOT NULL,             -- SHA-256 hex of refresh_jti (raw token never stored)
  user_agent    TEXT,
  device_name   TEXT,
  ip_address    INET,
  status        session_status NOT NULL DEFAULT 'active',
  issued_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ  NOT NULL,         -- now() + 30 days (sliding)
  last_seen_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  revoked_at    TIMESTAMPTZ
);

CREATE INDEX idx_sessions_user      ON sessions (user_id, status);
CREATE UNIQUE INDEX uq_sessions_hash ON sessions (refresh_hash);
```

**conversations** — direct (2 users) and group; participants as a GIN-indexed array for fast membership lookups.

```sql
CREATE TABLE conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type            conversation_type NOT NULL DEFAULT 'direct',
  title           VARCHAR(160),                   -- groups only
  participant_ids UUID[] NOT NULL,                -- app-enforced: 2 for direct, <=512 for group
  created_by      UUID NOT NULL REFERENCES users(id),
  last_message_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at     TIMESTAMPTZ
);

CREATE INDEX idx_conversations_participants ON conversations USING GIN (participant_ids);
CREATE INDEX idx_conversations_recency      ON conversations (last_message_at DESC);
```

**media_attachments** — every uploaded object; view-once fields baked in.

```sql
CREATE TABLE media_attachments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uploader_id      UUID NOT NULL REFERENCES users(id),
  message_id       UUID,                          -- backfilled when the message.send commits
  kind             media_kind NOT NULL,
  view_policy      media_view_policy NOT NULL DEFAULT 'standard',
  bucket           TEXT NOT NULL,
  object_key       TEXT NOT NULL,                 -- media/<user_id>/<uuid>.<ext>
  mime_type        TEXT NOT NULL,
  size_bytes       BIGINT NOT NULL,
  sha256_checksum  CHAR(64),
  width_px         INT,
  height_px        INT,
  duration_ms      INT,                           -- audio/video/voice_note
  one_time_token   UUID,                          -- armed only for view_once
  token_expires_at TIMESTAMPTZ,                   -- 30s after grant
  viewed_at        TIMESTAMPTZ,                   -- set on media.view_once.consumed
  destructed_at    TIMESTAMPTZ,                   -- server-side object removal time
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_media_object UNIQUE (bucket, object_key)
);

CREATE INDEX idx_media_message  ON media_attachments (message_id);
CREATE INDEX idx_media_viewonce ON media_attachments (view_policy, token_expires_at)
  WHERE view_policy = 'view_once' AND viewed_at IS NULL;
```

**messages** — text/media/system rows with delivery + read receipts and optional caption.

```sql
CREATE TABLE messages (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id     UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id           UUID NOT NULL REFERENCES users(id),
  type                message_type NOT NULL DEFAULT 'text',
  body                TEXT,                       -- text content, or the CAPTION on media rows
  media_attachment_id UUID REFERENCES media_attachments(id),
  is_view_once        BOOLEAN NOT NULL DEFAULT FALSE,
  delivered_to        UUID[] NOT NULL DEFAULT '{}',
  read_by             UUID[] NOT NULL DEFAULT '{}',
  reply_to_message_id UUID REFERENCES messages(id),
  client_msg_id       UUID NOT NULL,              -- idempotency key supplied by the client
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ,
  CONSTRAINT uq_messages_client UNIQUE (sender_id, client_msg_id)
);

CREATE INDEX idx_messages_conv_created ON messages (conversation_id, created_at);
CREATE INDEX idx_messages_sender       ON messages (sender_id, created_at DESC);
```

**user_preferences** — exactly one row per user; carries the **single global wallpaper** + theme.

```sql
CREATE TABLE user_preferences (
  user_id            UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  theme              TEXT NOT NULL DEFAULT 'system',   -- 'light' | 'dark' | 'system'
  chat_wallpaper_url TEXT,                             -- ONE global wallpaper for ALL threads
  font_scale         REAL NOT NULL DEFAULT 1.0,
  language           TEXT NOT NULL DEFAULT 'en',
  notification_prefs JSONB NOT NULL DEFAULT '{"messages":true,"calls":true}',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 2.4 Indexes & Hot Query Patterns

| Query | Index used |
|---|---|
| Conversation list for user (recent first) | `idx_conversations_recency` + GIN participant match |
| Message history page (`WHERE conv AND created_at < cursor ORDER BY created_at DESC LIMIT 50`) | `idx_messages_conv_created` |
| View-once orphans to purge | partial `idx_media_viewonce` |
| Refresh-token rotation lookup | `uq_sessions_hash` |
| Login device list / revoke-all | `idx_sessions_user` |

### 2.5 Retention & Cleanup Jobs

- Nightly: soft-delete purge (grace 90 days), `view_once` orphan destruction, expired-session purge (> 30d inactive).
- Weekly: S3 lifecycle transition + Glacier for media older than retention window.
- Users deleted → sessions/media/messages cascade; conversation rows retained 30 days as tombstone for sync consistency.
---

## 3. Authentication & Age Validation Logic

### 3.1 Registration & Identity Model

**Supported first-factor paths (any one):**
1. **Phone + Password** — E.164 phone, argon2id-hashed password.
2. **Phone + OTP** — server generates 6-digit TOTP, sends via SMS (Twilio), 5-min TTL, 3 attempts, then new code required; rate-limited per phone.
3. **Email + Password** — email verified via 6-digit code before activation.
4. **OAuth 2.0 (Google / Apple)** — PKCE code flow; `oauth_identities` JSONB stores `[{provider, subject, email, picture_url}]`.

**OAuth profile auto-population** (per requirement):

```python
def oauth_autofill(provider: str, claims: dict) -> dict:
    return {
        "full_name":  claims.get("name")   or derive_from_email(claims["email"]),
        "email":      claims.get("email"),
        "avatar_url": claims.get("picture") or claims.get("avatar"),  # Apple: via identityToken claims
        "email_verified": claims.get("email_verified", False),
    }
# On first OAuth login: create user with these + DOB collected afterward in a "finish profile"
# screen (OAuth providers don't return DOB). is_age_verified stays False until DOB passes §3.3.
```

**Registration fields:** `full_name`, `email`, `phone_number`, `password`, `gender`, `device_location` (single capture via `navigator.geolocation.getCurrentPosition` or native `Geolocation.getCurrentPosition`, with consent UI), `username` (unique, validated `^[a-zA-Z0-9_]{3,32}$`), `date_of_birth`.

### 3.2 Age Validation — Strict ≥ 18 by **Last Birthday** (month/day compare)

The rule: *"User must be ≥ 18 years old based on their last birthday."* We compute the age at the **most recent** occurrence of the DOB anniversary — never by naive year subtraction (`2026 - 2009 = 17` would wrongly reject someone born 2009-01-15 who turned 18 last January; `year subtraction` would wrongly *accept* someone born 2009-12-30 who is still 17).

```python
def age_at_last_birthday(dob: date, today: date) -> int:
    """Age measured at the user's most recent birthday (or today if it IS their birthday)."""
    this_year_birthday = date(today.year, dob.month, dob.day)
    last_birthday = this_year_birthday if this_year_birthday <= today \
                    else date(today.year - 1, dob.month, dob.day)
    return last_birthday.year - dob.year

def verify_registration(dob: date) -> bool:
    today = date.today()
    if dob > today:                                   # sanity: future DOB
        raise ValidationError("date_of_birth cannot be in the future")
    if dob < date(1900, 1, 1):
        raise ValidationError("date_of_birth out of accepted range")
    if age_at_last_birthday(dob, today) < 18:
        raise ValidationError(
            "You must be at least 18 years old (based on your last birthday) to use ChatVault")
    return True
```

**Enforcement layers (defense in depth):**
1. **Client:** native date-picker caps today; same month/day algorithm runs pre-submit, but is only UX sugar.
2. **Server (authoritative):** `verify_registration()` runs on register *and* on any later DOB edit. The server stores `is_age_verified = TRUE` only after it passes.
3. **Database:** `chk_users_dob` CHECK — `date_of_birth <= (CURRENT_DATE - INTERVAL '18 years')`. Note this is mathematically identical to the last-birthday rule: *18th birthday has occurred* ⟺ *dob + 18y ≤ today* ⟺ *age at last birthday ≥ 18*. It is a backstop, not the primary check (a NEW row re-validates on insert).

```ts
// Client mirror (same logic, used for instant UX feedback)
function ageAtLastBirthday(dobISO: string, now = new Date()): number {
  const dob = new Date(dobISO);
  const y = now.getUTCFullYear(), m = now.getUTCMonth(), d = now.getUTCDate();
  const lastBirthdayYear = (dob.getUTCMonth() > m || (dob.getUTCMonth() === m && dob.getUTCDate() > d)) ? y - 1 : y;
  return lastBirthdayYear - dob.getUTCFullYear();
}
if (ageAtLastBirthday(dobISO) < 18) setError("You must be 18 or older.");
```

### 3.3 Session Management — Persistent Login Until Explicit Logout

- **Access token (JWT):** 15-minute lifetime, used by REST + WS handshake. Claims: `sub` (user id), `sid` (session id), `typ: "access"`.
- **Refresh token (JWT):** 30-day sliding lifetime, random `jti`. Stored **hashed** (`refresh_hash = SHA-256(jti)`) in `sessions`. Issued to the client in an `HttpOnly; Secure; SameSite=Lax` cookie (web) or SecureStore/Keychain (mobile) — JS never reads it.
- **Rotation:** every refresh issues a fresh access token **and** a new refresh token; the old one is invalidated atomically. Reuse of a rotated token ⇒ token-theft signal ⇒ **revoke the whole session**.
- **Logout:** explicit → revoke `sessions` row + clear cookies/storage. Closing the app does **not** log out; tokens persist until expiry/rotation-revocation.

```python
# ---------- Issue ----------
def issue_session(user_id, device) -> (str, str):
    sid = str(uuid4())
    access = sign_jwt({"sub": user_id, "sid": sid, "typ": "access",
                       "iat": now, "exp": now + 15 * MINUTE}, ACCESS_SECRET)
    rjti = uuid4()
    refresh = sign_jwt({"sub": user_id, "sid": sid, "typ": "refresh", "jti": str(rjti),
                        "exp": now + 30 * DAY}, REFRESH_SECRET)
    db.insert_session(sid, user_id, sha256_hex(str(rjti)), device)
    return access, refresh    # set-cookie: HttpOnly, Secure, SameSite=Lax, Path=/

# ---------- Rotation (on /auth/refresh) ----------
def rotate_refresh(refresh_token):
    claims = verify_jwt(refresh_token, REFRESH_SECRET)          # raises if expired/bad sig
    row = db.get_session(claims["sid"])
    if not row or row.status != "active" or now > row.expires_at:
        db.revoke_session(claims["sid"]); raise SessionExpired()
    if row.refresh_hash != sha256_hex(claims["jti"]):
        db.revoke_all_for_user(row.user_id)                     # REUSE DETECTED → revoke all devices
        raise TokenReuseDetected()
    new_rjti = uuid4()
    db.update_session(row.sid, refresh_hash=sha256_hex(str(new_rjti)),
                      last_seen_at=now, expires_at=now + 30 * DAY)
    return sign_jwt({"sub": row.user_id, "sid": row.sid, "typ": "access",
                     "exp": now + 15 * MINUTE}, ACCESS_SECRET), \
           sign_jwt({"sub": row.user_id, "sid": row.sid, "typ": "refresh", "jti": str(new_rjti),
                     "exp": now + 30 * DAY}, REFRESH_SECRET)

# ---------- WS handshake ----------
def ws_authenticate(handshake_auth):
    token = extract_bearer_or_cookie(handshake_auth)
    claims = verify_jwt(token, ACCESS_SECRET)      # typ must be "access"
    if claims["typ"] != "access": raise Unauthorized()
    if db.session_status(claims["sid"]) != "active": raise Unauthorized()
    return claims                                   # ctx.user_id, ctx.sid available in all handlers

# ---------- Logout ----------
def logout(sid): db.revoke_session(sid)             # explicit "Logout" click only
```

> Edge case: the SAME user signs in on a phone and a web tab. Both are independent `sessions` rows; a message read on one device updates `messages.read_by` and mirror-syncs to the other via the `user:{id}` room — no cross-session invalidation.

---

## 4. Data Payload Formats (Real-Time / WebSocket + REST)

### 4.1 Versioned Envelope

Every WS frame uses one envelope (backward-compatible via `v`):

```json
{
  "v": 1,
  "event": "message.send",
  "cid": "cl-7f3a",                        // client id → idempotency + ack correlation
  "ts": "2026-09-07T09:41:00.000Z",
  "payload": { }
}
```

Server → client frames use the same shape with `event: message.new`, `message.ack`, etc. `.ack` echoes the originating `cid` and returns `status: "ok" | "error"` + `code` + `message_id`.

### 4.2 Events

**Text message (client → server / server → client):**

```json
{
  "v": 1, "event": "message.send", "cid": "cl-7f3a", "ts": "2026-09-07T09:41:00.000Z",
  "payload": {
    "conversation_id": "c_1a2b3c",
    "type": "text",
    "body": "Drop the spec in the shared drive?",
    "client_msg_id": "cl-7f3a",
    "reply_to_message_id": "msg_88dc"
  }
}
```

```json
{
  "v": 1, "event": "message.ack", "cid": "cl-7f3a",
  "payload": { "status": "ok", "message_id": "msg_9e21", "created_at": "2026-09-07T09:41:00.042Z" }
}
```

**Media + caption** (media uploaded via presigned PUT first; caption rides on the message row `body`):

```json
{
  "v": 1, "event": "message.send", "cid": "cl-9b2d", "ts": "2026-09-07T09:44:12.000Z",
  "payload": {
    "conversation_id": "c_1a2b3c",
    "type": "media",
    "caption": "Sunset from the rooftop 📍",
    "media": {
      "attachment_id": "att_4410",
      "kind": "image",
      "mime_type": "image/jpeg",
      "size_bytes": 2407123,
      "width_px": 4032,
      "height_px": 3024,
      "view_policy": "standard",
      "presigned_url": "https://cdn.chatvault.app/media/u_88/...?X-Amz-Signature=...",
      "presigned_url_expires_at": "2026-09-07T09:49:12.000Z"
    }
  }
}
```

**View-once media lifecycle (4-step):**
1. Solicit — recipient taps the blurred bubble:
```json
{ "v": 1, "event": "media.view_once.request", "cid": "cl-55ee",
  "payload": { "attachment_id": "att_7712", "message_id": "msg_333c" } }
```
2. Grant — server arms the token, returns a **30-second TTL presigned URL** bound to it:
```json
{ "v": 1, "event": "media.view_once.grant", "cid": "cl-55ee",
  "payload": {
    "attachment_id": "att_7712", "message_id": "msg_333c",
    "one_time_token": "8f3c1a2b-0000-4c11-8d3e-9f0bafe71177",
    "presigned_url": "https://cdn.chatvault.app/vo/att_7712?token=8f3c...&X-Amz-Expires=30",
    "expires_at": "2026-09-07T09:42:30.000Z",
    "view_window_seconds": 30
  } }
```
3. Consumed — client ack on successful decode/playback:
```json
{ "v": 1, "event": "media.view_once.consumed", "cid": "cl-55ee",
  "payload": { "attachment_id": "att_7712", "message_id": "msg_333c" } }
```
4. Destroyed — server sets `viewed_at`, revokes token, deletes/invalidates the object, broadcasts:
```json
{ "v": 1, "event": "media.view_once.destroyed",
  "payload": { "attachment_id": "att_7712", "message_id": "msg_333c", "opened_at": "2026-09-07T09:42:12.100Z" } }
```
> Screenshot/recording cannot be fully prevented client-side; the 30s window + no-replay + server-side destruction is the designed control surface. Long-press/share/forward of view-once media is blocked at the client AND the URL requires the one-time token which is revoked server-side after first use.

**Typing indicator** (coalesced server-side):

```json
{ "v": 1, "event": "typing.start", "payload": { "conversation_id": "c_1a2b3c", "user_id": "u_88", "user_name": "Maya" } }
{ "v": 1, "event": "typing.stop",  "payload": { "conversation_id": "c_1a2b3c", "user_id": "u_88" } }
```

**Presence:**

```json
{ "v": 1, "event": "presence.update", "payload": { "user_id": "u_88", "status": "online", "last_seen_at": null } }
```

**VoIP signaling — WebRTC over the same socket (1:1 audio/video):**

Caller → server → callee (SDP offer + ICE server config):

```json
{
  "v": 1, "event": "call.offer", "cid": "cl-c1", "ts": "2026-09-07T10:02:11.000Z",
  "payload": {
    "call_id": "call_01",
    "caller_id": "u_88",
    "callee_id": "u_12",
    "kind": "video",
    "sdp": { "type": "offer", "sdp": "v=0\r\no=- 4611722893 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96 97 ..." },
    "ice_servers": [
      { "urls": "stun:stun.chatvault.app:3478" },
      { "urls": ["turn:turn.chatvault.app:3478?transport=udp", "turn:turn.chatvault.app:3478?transport=tcp"],
        "username": "ephemeral_user", "credential": "ephemeral_pass" }
    ]
  }
}
```

Callee accepts (SDP answer):

```json
{ "v": 1, "event": "call.answer", "cid": "cl-c2",
  "payload": { "call_id": "call_01", "caller_id": "u_88", "callee_id": "u_12",
               "sdp": { "type": "answer", "sdp": "v=0\r\no=- 194102..." } } }
```

ICE candidates flow both ways (trickle):

```json
{ "v": 1, "event": "call.ice", "cid": "cl-c3",
  "payload": { "call_id": "call_01", "from": "u_88",
               "candidate": { "candidate": "candidate:842163049 1 udp 1677729535 ...", "sdpMid": "0", "sdpMLineIndex": 0 } } }
```

End / reject / timeout:

```json
{ "v": 1, "event": "call.end", "cid": "cl-c4",
  "payload": { "call_id": "call_01", "reason": "caller_hangup | callee_reject | no_answer | timeout | failed", "duration_ms": 84320 } }
```

> The server is a **signaling relay only** — SDP/ICE pass through rooms `user:{id}`; media flows P2P (or via TURN when symmetric NATs block P2P). No media bytes touch ChatVault servers.

**REST (outside WS):**
- `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`
- `GET /conversations?cursor=...&limit=50`, `GET /conversations/:id/messages?before=<cursor>`
- `POST /media/presign` → `{ "upload_url": "...", "attachment_id": "att_4410", "expires_at": "..." }`
- `PATCH /me/preferences` → `{ "theme": "dark", "chat_wallpaper_url": "https://cdn.chatvault.app/wallpapers/nebula.webp" }`
---

## 5. UI/UX Wireframe & Component Layout Blueprint

### 5.1 Design Tokens (Theme System)

The entire UI is token-driven. Light/Dark are **data-theme attribute swaps** over the same component tree; `chat_wallpaper_url` is a runtime CSS custom property so changing it re-themes every thread instantly.

```css
/* Light Mode */
:root[data-theme="light"] {
  --primary:           #2563EB;            /* Primary Blue */
  --accent:            #9333EA;            /* Vibrant Purple */
  --primary-soft:      #DBEAFE;
  --accent-soft:       #F3E8FF;
  --brand-gradient:    linear-gradient(135deg, #2563EB 0%, #9333EA 100%);
  --bg-app:            #F8FAFC;
  --bg-surface:        #FFFFFF;
  --bg-incoming:       #FFFFFF;
  --bg-outgoing:       var(--brand-gradient);
  --text-primary:      #0F172A;
  --text-secondary:    #64748B;
  --text-on-brand:     #FFFFFF;
  --border:            #E2E8F0;
  --shadow:            0 1px 3px rgba(15, 23, 42, .08);
  --scrim:             rgba(15, 23, 42, .45);
  --chat-wallpaper:    var(--wallpaper-url, url("https://cdn.chatvault.app/wallpapers/light_default.webp"));
}

/* Dark Mode */
:root[data-theme="dark"] {
  --primary:           #3B82F6;
  --accent:            #A855F7;
  --primary-soft:      #1E3A8A;
  --accent-soft:       #4C1D95;
  --brand-gradient:    linear-gradient(135deg, #2563EB 0%, #7C3AED 100%);
  --bg-app:            #0B1220;
  --bg-surface:        #111A2E;
  --bg-incoming:       #1E293B;
  --bg-outgoing:       var(--brand-gradient);
  --text-primary:      #F1F5F9;
  --text-secondary:    #94A3B8;
  --text-on-brand:     #FFFFFF;
  --border:            #1E293B;
  --shadow:            0 1px 3px rgba(0, 0, 0, .5);
  --scrim:             rgba(0, 0, 0, .55);
  --chat-wallpaper:    var(--wallpaper-url, url("https://cdn.chatvault.app/wallpapers/dark_default.webp"));
}

/* Universal wallpaper: applied to the message-list scroll container in EVERY thread */
.chat-wallpaper {
  background-image: var(--chat-wallpaper);
  background-size: cover;
  background-position: center;
  background-attachment: local;
}
.chat-wallpaper::before {           /* readability scrim over the wallpaper */
  content: ""; position: absolute; inset: 0;
  background: var(--scrim); pointer-events: none;
}
```

**Avatar/username customization** lives under Settings → Profile (updates `users.avatar_url` / `users.username`; username uniqueness enforced server-side with 409 → inline validation).

### 5.2 App Shell Layout (responsive zones)

```
┌──────────┬───────────────┬──────────────────────────────┐
│  72px    │   320px       │  flex-1                      │
│ LeftRail │ ChatList      │  ChatPane                    │
│  avatar  │ search box    │  ┌─ ChatHeader ────────────┐ │
│  calls   │ conv rows     │  │ name · online · `📞` `🎥` │ │
│  chats   │ (avatar, name,│  └──────────────────────────┘ │
│  settings│ last msg,     │  ┌─ MessageList ────────────┐ │
│  🌙/☀️   │ unread badge, │  │   wallpaper bg (global)  │ │
│          │ online dot)   │  │  date chip               │ │
│          │               │  │  [incoming bubble]       │ │
│          │               │  │  [outgoing bubble+caption]│ │
│          │               │  │  🔒 view-once bubble     │ │
│          │               │  └──────────────────────────┘ │
│          │               │  ┌─ Composer ───────────────┐ │
│          │               │  │ 📎 attach · input · 🎤 › │ │
│          │               │  └──────────────────────────┘ │
└──────────┴───────────────┴──────────────────────────────┘
```
- **Desktop (≥1024px):** 3-pane as above; right detail rail (shared media, wallpaper) toggles at 1440px+.
- **Tablet (768–1023px):** ChatList collapses into a slide-over drawer.
- **Mobile (<768px):** single pane; push navigation Chats → Chat → Call; grid-based fit.

### 5.3 Key Screens & Components

| Screen | Core components | Notes |
|---|---|---|
| **Auth** | OTPScreen, EmailPassScreen, OAuthButtons, RegistrationForm | Registration: DOB picker (max = today) + geolocation consent; OAuth buttons autofill name/email/photo, then "finish profile" collects DOB |
| **Chats** | SearchBar, ConversationRow, UnreadBadge, OnlineDot, FAB(NewChat) | Sorted by `last_message_at`; swipe = archive |
| **Chat** | ChatHeader, MessageList, MessageBubble, MediaCard, CaptionText, ViewOnceBubble, DateChip, Composer | Bubbles: outgoing = `--brand-gradient` white text; incoming = `--bg-incoming`; media renders with caption under it; ViewOnceBubble shows 🔒 + "Tap to open · expires in 30s" countdown once granted |
| **ViewOnceViewer** | CountdownRing, MediaViewport (blurred until grant), ConsumedOverlay("Opened") | Screenshot-blocked best-effort; after consumed the bubble is replaced by "Opened" for both sides |
| **Call (audio/video)** | CallOverlay, VideoGrid, MuteBtn, CameraFlip, SpeakerBtn, EndCallBtn, CallTimer, Minimize | Full-screen overlay above chat; incoming call = full-screen accept/decline with caller avatar |
| **Settings** | ProfileEditor, UsernameEditor, WallpaperPicker, ThemeToggle (Light/Dark/System), SessionList ("log out of other devices"), LogoutButton, AvatarPicker | Every mutating call PATCHes `/me/preferences` or `/me`; optimistic UI + rollback |

### 5.4 Universal Chat Wallpaper Logic (global, single background)

1. `user_preferences.chat_wallpaper_url` holds **one** URL — there is deliberately no per-thread wallpaper setting.
2. On Settings → Wallpaper, the picker writes that single value; the client updates `--wallpaper-url` once and **every** thread's `.chat-wallpaper` container re-renders with the new image (CSS variable = instant, no per-conversation refetch).
3. Wallpaper asset is downloaded once and cached (Cache-First, CDN `immutable` hash URL); a `wallpaper_version` bump in preferences busts stale cache.
4. Incoming bubbles stay opaque for readability; the scrim (`.chat-wallpaper::before`) guarantees 4.5:1 text contrast regardless of wallpaper brightness.

### 5.5 Theme Toggle & Persistence

- 3-state control: **Light / Dark / System** (System = `prefers-color-scheme`).
- Persisted at `PATCH /me/preferences { "theme": "dark" }` and mirrored to all of the user's devices via the `user:{id}` WS room → `theme.updated` event → swap `data-theme` live (no reload).
- Hydration: tokens + preferences fetched in parallel at app boot; no theme flash (inline `<script>` reads preference before first paint on web; splash-screen color on native).

---

## 6. Security, Compliance & Operations Appendix

- **Encryption:** TLS 1.3 in transit; SSE-KMS at rest for S3; Postgres pgcrypto for any PII-at-rest requirement; password = argon2id (m=64MB, t=3, p=1), peppered.
- **Age/GDPR:** DOB is PII → encrypted at rest, only `is_age_verified` exposed to clients; export/delete flows (`/me/export`, `/me/delete`) required for CCPA/GDPR.
- **Abuse controls:** per-IP + per-user rate limits (Redis sliding window) on `/auth/*` (OTP brute force), `/media/presign`; WS message throttle; media content-hash dedupe against CSAM/abuse hashes; report + block primitives (`blocks` list on users via JSONB or extension table).
- **Observability:** OpenTelemetry spans on WS events + REST; dashboards: WS connections/node, fan-out latency, view-once destruction rate, refresh-token reuse alerts (token-theft).
- **CI/CD:** GitHub Actions → lint/typecheck/test → build images → Terraform-apply staging → canary EKS deploy. DB migrations via Flyway with backward-compatible steps (expand → migrate → contract).
- **Testing musts:** age-boundary unit tests (born 2008-09-08 vs today 2026-09-07 → last birthday 2025 → age 17 → REJECT; born 2008-09-06 → birthday passed 2026-09-06 → 18 → ACCEPT; born 2008-09-07 → today IS the 18th birthday → ACCEPT); view-once double-open rejection; refresh reuse revocation; WS reconnect gap sync.

---

*End of specification. Companion artifacts: architecture diagram + UI layout blueprint rendered above.*

---
*Companion visual artifacts (architecture diagram + UI layout blueprint) ship as rendered widgets in the delivery message.*
