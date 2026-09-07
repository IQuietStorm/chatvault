import { io, Socket } from 'socket.io-client';

const WS_URL = import.meta.env.VITE_WS_URL ?? 'http://localhost:3000';

/**
 * ChatVault Socket.IO client with JWT handshake auth (access token only),
 * WebSocket-first transport with long-polling fallback and resilient reconnect.
 */
export function createChatSocket(accessToken: string): Socket {
  const socket = io(WS_URL, {
    auth: { token: accessToken },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });
  socket.on('auth.error', () => {
    // Access token expired/invalid — the app layer refreshes and reconnects.
    console.warn('[ws] auth rejected');
  });
  return socket;
}
