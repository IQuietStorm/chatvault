import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { CallsService } from './calls.service';
import type { CallOfferPayload, CallAnswerPayload, CallIcePayload, CallEndPayload } from '@chatvault/shared';

interface CallRecord {
  caller_id: string;
  callee_id: string;
}

/**
 * VoIP signaling relay — SDP/ICE pass through rooms user:{id}; media flows
 * P2P (or via TURN when symmetric NATs block P2P). No media bytes touch the
 * server. Auth is enforced by the shared WS handshake guard.
 */
@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class CallsGateway {
  @WebSocketServer() server!: Server;

  /** Single-node call registry; swap for a Redis hash (call:{call_id}) when scaling out. */
  private calls = new Map<string, CallRecord>();

  constructor(private readonly callsSvc: CallsService) {}

  @SubscribeMessage('call.offer')
  onOffer(@ConnectedSocket() socket: Socket, @MessageBody() payload: CallOfferPayload) {
    this.calls.set(payload.call_id, { caller_id: payload.caller_id, callee_id: payload.callee_id });
    const ice = this.callsSvc.generateTURNCredentials(payload.caller_id);
    this.server.to(`user:${payload.callee_id}`).emit('call.incoming', {
      call_id: payload.call_id,
      caller_id: payload.caller_id,
      kind: payload.kind,
      sdp: payload.sdp,
      ice_servers: ice.ice_servers,
    });
    socket.emit('call.ringing', { call_id: payload.call_id });
  }

  @SubscribeMessage('call.answer')
  onAnswer(@MessageBody() payload: CallAnswerPayload) {
    const rec = this.calls.get(payload.call_id);
    if (!rec) return;
    const ice = this.callsSvc.generateTURNCredentials(rec.callee_id);
    this.server.to(`user:${rec.caller_id}`).emit('call.connected', {
      call_id: payload.call_id,
      callee_id: rec.callee_id,
      sdp: payload.sdp,
      ice_servers: ice.ice_servers,
    });
  }

  @SubscribeMessage('call.ice')
  onIce(@MessageBody() payload: CallIcePayload) {
    const rec = this.calls.get(payload.call_id);
    if (!rec) return;
    const peer = payload.from === rec.caller_id ? rec.callee_id : rec.caller_id;
    this.server.to(`user:${peer}`).emit('call.ice', payload);
  }

  @SubscribeMessage('call.end')
  onEnd(@MessageBody() payload: CallEndPayload) {
    const rec = this.calls.get(payload.call_id);
    this.calls.delete(payload.call_id);
    if (!rec) return;
    this.server.to(`user:${rec.caller_id}`).emit('call.end', payload);
    this.server.to(`user:${rec.callee_id}`).emit('call.end', payload);
  }
}
