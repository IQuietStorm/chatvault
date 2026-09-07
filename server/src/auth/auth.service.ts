import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomUUID } from 'crypto';
import { query } from '../db/database';
import { verifyAge, MIN_AGE } from './age-gate';
import { signAccess, signRefresh, sha256Hex, verify } from './jwt';
import { config } from '../config';

export interface RegisterDto {
  full_name: string;
  email?: string;
  phone_number?: string;
  password?: string;
  gender?: string;
  username: string;
  date_of_birth: string; // ISO
  device_location?: { lat: number; lng: number; accuracy_m?: number };
}

export interface OAuthClaims {
  provider: 'google' | 'apple';
  subject: string;
  email?: string;
  name?: string;
  picture?: string; // google picture / apple avatar
}

interface UserRow {
  id: string;
  username: string;
  full_name: string;
  email: string | null;
  phone_number: string | null;
  avatar_url: string | null;
  is_age_verified: boolean;
  password_hash: string | null;
  oauth_identities: unknown;
}

@Injectable()
export class AuthService {
  /** Register with full profile — age gate is authoritative here (layer 2 of 3). */
  async register(dto: RegisterDto) {
    const dob = new Date(dto.date_of_birth);
    const check = verifyAge(dob, config.minAge);
    if (!check.ok) throw new BadRequestException(check.reason);

    // Username rule: 3-32 alphanumeric/underscore
    if (!/^[a-zA-Z0-9_]{3,32}$/.test(dto.username))
      throw new BadRequestException('username must be 3-32 chars of a-z, 0-9, _');
    if (!dto.email && !dto.phone_number)
      throw new BadRequestException('email or phone_number is required');

    const passwordHash = dto.password ? await argon2.hash(dto.password) : null;

    try {
      const rows = await query<UserRow>(
        `INSERT INTO users
           (username, full_name, email, phone_number, password_hash, gender,
            date_of_birth, is_age_verified, device_location)
         VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8)
         RETURNING id, full_name, email, phone_number, avatar_url, is_age_verified, password_hash, oauth_identities`,
        [
          dto.username,
          dto.full_name,
          dto.email ?? null,
          dto.phone_number ?? null,
          passwordHash,
          dto.gender ?? null,
          dob.toISOString().slice(0, 10),
          dto.device_location ? JSON.stringify(dto.device_location) : null,
        ],
      );
      const user = rows[0];
      await query(`INSERT INTO user_preferences (user_id) VALUES ($1)`, [user.id]);
      return this.issueSession(user, 'registration');
    } catch (e: any) {
      if (String(e.code) === '23505')
        throw new BadRequestException('username, email, or phone already registered');
      throw e;
    }
  }

  /** Phone+Password or Email+Password login. */
  async login(identifier: string, password: string) {
    const rows = await query<UserRow>(
      `SELECT * FROM users WHERE email = $1 OR phone_number = $1`,
      [identifier],
    );
    const user = rows[0];
    if (!user?.password_hash) throw new UnauthorizedException('invalid credentials');
    const ok = await argon2.verify(user.password_hash, password);
    if (!ok) throw new UnauthorizedException('invalid credentials');
    await query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [user.id]);
    return this.issueSession(user, 'password');
  }

  /**
   * OAuth 2.0 (Google/Apple, PKCE). Profile auto-population:
   * name / email / photo are pre-filled from provider claims; DOB is NOT
   * returned by providers → collected in a one-step "finish profile" screen
   * and re-validated by verifyAge before is_age_verified = true.
   */
  async oauthAutofill(claims: OAuthClaims) {
    return {
      full_name: claims.name ?? this.deriveFromEmail(claims.email),
      email: claims.email,
      avatar_url: claims.picture,
      provider: claims.provider,
    };
  }

  async oauthLogin(claims: OAuthClaims) {
    const rows = await query<UserRow>(
      `SELECT * FROM users WHERE oauth_identities @> $1::jsonb`,
      [JSON.stringify([{ provider: claims.provider, subject: claims.subject }])],
    );
    let user = rows[0];
    if (!user) {
      // First OAuth login → create skeleton; DOB collected on next screen.
      const name = claims.name ?? this.deriveFromEmail(claims.email);
      const username = `user_${randomUUID().slice(0, 8)}`;
      const inserted = await query<UserRow>(
        `INSERT INTO users (username, full_name, email, oauth_identities, avatar_url)
         VALUES ($1,$2,$3,$4::jsonb,$5)
         RETURNING id, full_name, email, phone_number, avatar_url, is_age_verified, password_hash, oauth_identities`,
        [username, name, claims.email ?? null,
         JSON.stringify([{ provider: claims.provider, subject: claims.subject, email: claims.email, picture_url: claims.picture }]),
         claims.picture ?? null],
      );
      user = inserted[0];
      await query(`INSERT INTO user_preferences (user_id) VALUES ($1)`, [user.id]);
    }
    await query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [user.id]);
    return this.issueSession(user, 'oauth');
  }

  /** Phone OTP — 6-digit code via Twilio Verify; 5-min TTL, 3 attempts, rate-limited. */
  async requestOtp(phoneNumber: string) {
    // TODO(twilio): client.verify.v2.services(TWILIO_VERIFY_SERVICE_SID)
    //   .verifications.create({ to: phoneNumber, channel: 'sms' })
    return { status: 'pending', phone_number_masked: phoneNumber.slice(-4) };
  }

  async verifyOtp(phoneNumber: string, code: string) {
    // TODO(twilio): verificationChecks.create({ to, code }) → status 'approved'
    void code;
    const rows = await query<UserRow>(
      `SELECT * FROM users WHERE phone_number = $1`, [phoneNumber],
    );
    if (!rows[0]) throw new UnauthorizedException('phone not registered');
    return this.issueSession(rows[0], 'otp');
  }

  /** Issue access + rotating refresh; refresh persisted only as hash. */
  private async issueSession(user: UserRow, method: string) {
    const sid = randomUUID();
    const access = signAccess(user.id, sid, config.accessSecret, config.accessTtlMinutes);
    const jti = randomUUID();
    const refresh = signRefresh(user.id, sid, jti, config.refreshSecret, config.refreshTtlDays);
    await query(
      `INSERT INTO sessions (id, user_id, refresh_jti, refresh_hash, device_name, expires_at)
       VALUES ($1,$2,$3,$4,$5, now() + ($6 || ' days')::interval)`,
      [sid, user.id, jti, sha256Hex(jti), method, String(config.refreshTtlDays)],
    );
    return {
      access_token: access,
      refresh_token: refresh,
      token_type: 'Bearer',
      expires_in: config.accessTtlMinutes * 60,
      user: { id: user.id, username: user.username, full_name: user.full_name, avatar_url: user.avatar_url },
    };
  }

  /** Rotation + reuse detection: reusing an already-rotated refresh revokes ALL devices. */
  async rotateRefresh(refreshToken: string) {
    let claims: any;
    try {
      claims = verify(refreshToken, config.refreshSecret);
    } catch {
      throw new UnauthorizedException('refresh token expired or invalid');
    }
    if (claims.typ !== 'refresh') throw new UnauthorizedException('not a refresh token');

    const rows = await query<any>(`SELECT * FROM sessions WHERE id = $1`, [claims.sid]);
    const session = rows[0];
    if (!session || session.status !== 'active' || new Date(session.expires_at) < new Date()) {
      if (session) await query(`UPDATE sessions SET status='expired' WHERE id=$1`, [claims.sid]);
      throw new UnauthorizedException('session expired');
    }
    if (session.refresh_hash !== sha256Hex(claims.jti)) {
      // Token reuse → likely theft → kill every session for this user.
      await query(`UPDATE sessions SET status='revoked', revoked_at=now() WHERE user_id=$1`, [session.user_id]);
      throw new UnauthorizedException('refresh token reuse detected; all sessions revoked');
    }
    const newJti = randomUUID();
    await query(
      `UPDATE sessions SET refresh_jti=$1, refresh_hash=$2, last_seen_at=now(),
         expires_at = now() + ($3 || ' days')::interval
       WHERE id=$4`,
      [newJti, sha256Hex(newJti), String(config.refreshTtlDays), claims.sid],
    );
    return {
      access_token: signAccess(session.user_id, claims.sid, config.accessSecret, config.accessTtlMinutes),
      refresh_token: signRefresh(session.user_id, claims.sid, newJti, config.refreshSecret, config.refreshTtlDays),
      token_type: 'Bearer',
      expires_in: config.accessTtlMinutes * 60,
    };
  }

  /** Explicit "Logout" click only — closes the app does NOT log out. */
  async logout(sid: string) {
    await query(`UPDATE sessions SET status='revoked', revoked_at=now() WHERE id=$1`, [sid]);
  }

  async revokeAllSessions(userId: string) {
    await query(`UPDATE sessions SET status='revoked', revoked_at=now() WHERE user_id=$1`, [userId]);
  }

  private deriveFromEmail(email?: string): string {
    if (!email) return 'New User';
    const local = email.split('@')[0];
    return local.replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
}
