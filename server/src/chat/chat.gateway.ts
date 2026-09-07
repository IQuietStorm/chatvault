import {
  ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect,
  SubscribeMessage, WebSocketGateway, WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { verify, AccessClaims } from '../auth/jwt';
import { config } from '../config';
import { ChatService } from './chat.service';
import { MediaService } from '../media/media.service';
import type {
  SendTextPayload, SendMediaPayload, ViewOnceRequestPayload, ViewOnceConsumedPayload, TypingPayload,
} from '@chatvault/shared';

const rooms = { conv: (id: string) => `conv:${id}`, user: (id: string) => `user:${id}` };

@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;

  constructor(
    private readonly chat: ChatService,
    private readonly media: MediaService,
  ) {}

  /** WS handshake auth — access JWT only (refresh tokens can never open sockets). */
  async handleConnection(socket: Socket) {
    try {
      const token = (socket.handshake.auth?.token ?? socket.handshake.headers.authorization?.replace('Bearer ', '')) as string;
      const claims = verify<AccessClaims>(token, config.accessSecret);
      if (claims.typ !== 'access') throw new Error('wrong token type');
      socket.data.userId = claims.sub;
      socket.data.sid = claims.sid;
      await socket.join(rooms.user(claims.sub));
      this.server.to(rooms.user(claims.sub)).emit('presence.update', { user_id: claims.sub, status: 'online', last_seen_at: null });
    } catch {
      socket.emit('auth.error', { code: 'unauthorized' });
      socket.disconnect(true);
    }
  }

  handleDisconnect(socket: Socket) {
    if (socket.data.userId) {
      this.server.to(rooms.user(socket.data.userId)).emit('presence.update', {
        user_id: socket.data.userId, status: 'offline', last_seen_at: new Date().toISOString(),
      });
    }
  }

  @SubscribeMessage('message.send')
  async onMessageSend(@ConnectedSocket() socket: Socket, @MessageBody() payload: SendTextPayload | SendMediaPayload) {
    const senderId = socket.data.userId as string;
    const msg =
      payload.type === 'text'
        ? { conversation_id: payload.conversation_id, sender_id: senderId, type: 'text' as const, body: payload.body, client_msg_id: payload.client_msg_id, reply_to_message_id: payload.reply_to_message_id }
        : { conversation_id: payload.conversation_id, sender_id: senderId, type: 'media' as const, body: payload.caption ?? null, media_attachment_id: payload.media.attachment_id, client_msg_id: payload.client_msg_id, is_view_once: payload.media.view_policy === 'view_once' };

    const saved = await this.chat.saveMessage(msg);

    // Ack sender (echo cid → idempotent correlation)
    socket.emit('message.ack', { status: 'ok', message_id: saved.id, created_at: saved.created_at, cid: payload.client_msg_id });

    // Fan-out to the conversation room
    this.server.to(rooms.conv(payload.conversation_id)).emit('message.new', {
      message_id: saved.id,
      conversation_id: payload.conversation_id,
      sender_id: saved.sender_id,
      type: saved.type,
      body: saved.body,
      is_view_once: saved.is_view_once,
      reply_to_message_id: saved.reply_to_message_id,
      client_msg_id: saved.client_msg_id,
      created_at: saved.created_at,
    });
  }

  @SubscribeMessage('conversation.join')
  async onJoin(@ConnectedSocket() socket: Socket, @MessageBody() body: { conversation_id: string }) {
    await socket.join(rooms.conv(body.conversation_id));
  }

  @SubscribeMessage('typing.start')
  onTyping(@ConnectedSocket() socket: Socket, @MessageBody() payload: TypingPayload) {
    socket.to(rooms.conv(payload.conversation_id)).emit('typing.start', { conversation_id: payload.conversation_id, user_id: socket.data.userId });
  }

  @SubscribeMessage('message.read')
  async onRead(@ConnectedSocket() socket: Socket, @MessageBody() body: { conversation_id: string; message_ids: string[] }) {
    await this.chat.markRead(body.conversation_id, socket.data.userId, body.message_ids);
    this.server.to(rooms.conv(body.conversation_id)).emit('message.read', {
      conversation_id: body.conversation_id, user_id: socket.data.userId, message_ids: body.message_ids,
    });
  }

  /* -------------------- View-once lifecycle -------------------- */
  // 1. Recipient taps the blurred bubble
  @SubscribeMessage('media.view_once.request')
  async onViewOnceRequest(@ConnectedSocket() socket: Socket, @MessageBody() payload: ViewOnceRequestPayload) {
    try {
      const grant = await this.media.armViewOnce(payload.attachment_id, payload.message_id, socket.data.userId);
      socket.emit('media.view_once.grant', { ...payload, ...grant });
    } catch (e: any) {
      socket.emit('media.view_once.grant', { status: 'error', code: e.message ?? 'forbidden', ...payload });
    }
  }

  // 3. Client confirms successful decode/playback
  @SubscribeMessage('media.view_once.consumed')
  async onViewOnceConsumed(@ConnectedSocket() socket: Socket, @MessageBody() payload: ViewOnceConsumedPayload) {
    const result = await this.media.consumeViewOnce(payload.attachment_id, payload.message_id, socket.data.userId);
    if (result) {
      this.server.to(rooms.conv(result.conversation_id)).emit('media.view_once.destroyed', {
        attachment_id: payload.attachment_id, message_id: payload.message_id, opened_at: result.opened_at,
      });
    }
  }
}
