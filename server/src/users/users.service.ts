import { Injectable } from '@nestjs/common';
import { query } from '../db/database';

@Injectable()
export class UsersService {
  async profile(userId: string) {
    const rows = await query(`SELECT id, username, full_name, email, phone_number, avatar_url, gender, created_at FROM users WHERE id=$1`, [userId]);
    return rows[0] ?? null;
  }

  /** Editable username (unique) + custom avatar — the two profile customization knobs. */
  async update(userId: string, body: { username?: string; avatar_url?: string }) {
    if (body.username && !/^[a-zA-Z0-9_]{3,32}$/.test(body.username)) {
      throw Object.assign(new Error('username must be 3-32 chars of a-z, 0-9, _'), { status: 400 });
    }
    try {
      const rows = await query(
        `UPDATE users SET username = COALESCE($2, username), avatar_url = COALESCE($3, avatar_url), updated_at = now()
         WHERE id = $1 RETURNING id, username, avatar_url`,
        [userId, body.username ?? null, body.avatar_url ?? null],
      );
      return rows[0];
    } catch (e: any) {
      if (String(e.code) === '23505') throw Object.assign(new Error('username already taken'), { status: 409 });
      throw e;
    }
  }

  /** Exactly one preference row per user; chat_wallpaper_url is the SINGLE global wallpaper. */
  async upsertPreferences(userId: string, body: { theme?: string; chat_wallpaper_url?: string }) {
    const rows = await query(
      `INSERT INTO user_preferences (user_id, theme, chat_wallpaper_url)
       VALUES ($1, COALESCE($2,'system'), $3)
       ON CONFLICT (user_id) DO UPDATE SET
         theme = COALESCE(EXCLUDED.theme, user_preferences.theme),
         chat_wallpaper_url = COALESCE(EXCLUDED.chat_wallpaper_url, user_preferences.chat_wallpaper_url),
         updated_at = now()
       RETURNING *`,
      [userId, body.theme, body.chat_wallpaper_url ?? null],
    );
    return rows[0];
  }
}
