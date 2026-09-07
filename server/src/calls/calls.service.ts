import { Injectable } from '@nestjs/common';
import { createHmac } from 'crypto';
import { config } from '../config';

/**
 * Coturn REST API credentials (RFC 7635-style ephemeral TURN auth).
 * username = "<unix-expiry>:<user-id>", credential = base64(HMAC-SHA1(secret, username)).
 * Coturn validates the expiry server-side, so credentials need no storage.
 */
@Injectable()
export class CallsService {
  generateTURNCredentials(userId: string, ttlSeconds = 3600) {
    const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
    const username = `${expiry}:${userId}`;
    const credential = createHmac('sha1', config.turn.secret).update(username).digest('base64');
    return {
      ice_servers: [
        { urls: ['stun:stun.chatvault.app:3478'] },
        { urls: config.turn.urls, username, credential },
      ],
    };
  }
}
