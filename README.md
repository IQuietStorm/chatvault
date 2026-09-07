# ChatVault

Real-time, cloud-synced multimedia messaging **and** VoIP application: text/media chat with full cross-device history, view-once media, WebRTC 1:1 audio/video calls, OAuth + JWT identity with strict 18+ verification, and a global Blue (`#2563EB`) / Purple (`#9333EA`) theming system with Light/Dark modes and a single universal chat wallpaper.

> Full design rationale lives in [`docs/ChatVault-System-Architecture-Spec-v1.md`](docs/ChatVault-System-Architecture-Spec-v1.md) — companion visuals: [`docs/architecture.svg`](docs/architecture.svg), [`docs/database-erd.mmd`](docs/database-erd.mmd).

## Repository Map

```
.
├── docs/                        # Architecture spec, diagrams
├── shared/src/                  # Versioned WS envelope + payload types (contract)
├── server/                      # NestJS API + Socket.IO real-time services
│   └── src/
│       ├── auth/                # Register/login/OTP/OAuth, JWT rotation, age gate
│       ├── chat/                # Conversation + message persistence, WS fan-out
│       ├── media/               # S3 presigning, view-once lifecycle
│       ├── calls/               # WebRTC signaling relay (offer/answer/ICE)
│       └── db/                  # schema.sql (PostgreSQL 16 DDL)
├── client/                      # React 18 (web/PWA) — same contracts used by RN app
│   └── src/
│       ├── theme/               # Design tokens: light/dark + global wallpaper
│       ├── socket/              # Socket.IO client with JWT handshake
│       ├── components/          # MessageBubble, ViewOnce viewer…
│       └── screens/             # Chat, Auth, Call overlay
├── infra/
│   ├── docker-compose.yml       # postgres + redis + coturn + api, one command
│   ├── coturn/                  # TURN server config for NAT traversal
│   └── terraform/               # AWS: S3, CloudFront, RDS, ElastiCache
└── scripts/                     # Age-boundary tests, seed data
```

## Quick Start (local dev)

```bash
cp server/.env.example server/.env          # fill secrets
docker compose -f infra/docker-compose.yml up -d   # postgres, redis, coturn

cd server && npm ci && npm run dev          # API      → http://localhost:3000
cd client && npm ci && npm run dev          # Web app  → http://localhost:5173
cd scripts && node age-boundary-tests.mjs   # 18+ rule boundary verification
```

Database schema is applied with:
```bash
psql "$DATABASE_URL" -f server/src/db/schema.sql
```

## Feature Highlights

| Capability | Implementation |
|---|---|
| Login | Phone+Password, Phone+OTP, Email+Password, OAuth 2.0 Google/Apple (PKCE) |
| Age rule | `ageAtLastBirthday()` — ≥18 measured at the **last birthday** (month/day compare), enforced client → server → DB CHECK |
| Sessions | 15-min access JWT + rotating 30-day refresh token, hashed at rest in `sessions`; persists until explicit Logout; reuse detection revokes all devices |
| Real-time | Socket.IO + Redis adapter; rooms `user:{id}` / `conv:{id}`; `cid` idempotency |
| Media | Presigned S3 PUT/GET; image/audio/video/voice-note/document + optional caption |
| View-once | One-time token + 30s TTL presigned URL, revoke + object deletion on consume |
| VoIP | WebRTC P2P with Coturn TURN fallback; signaling relayed over the same socket |
| Theming | `#2563EB`/`#9333EA` tokens, Light/Dark/System, one global `chat_wallpaper_url` |

## CI / Deploy

GitHub Actions (`.github/workflows/ci.yml`) runs typecheck + build for server and client, Terraform fmt/validate, and a Docker build. Infrastructure is declarative in `infra/terraform`.

## License

MIT — see [LICENSE](LICENSE).
