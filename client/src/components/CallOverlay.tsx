import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { CallIcePayload, IceServerConfig, SessionDescriptionInit } from '@chatvault/shared';
import { randomUUID } from '../lib/id';

interface IncomingCall {
  call_id: string;
  caller_id: string;
  kind: 'audio' | 'video';
  sdp?: SessionDescriptionInit;
  ice_servers?: IceServerConfig[];
}

interface Props {
  socket: Socket;
  myId: string;
  peerId: string;
}

/**
 * WebRTC 1:1 call overlay. Signaling (SDP/ICE) relays through the ChatVault
 * Socket.IO layer; media flows P2P with TURN fallback via the RFC-7635
 * ephemeral credentials issued by the server's CallsService.
 */
export function CallOverlay({ socket, myId, peerId }: Props) {
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);
  const [active, setActive] = useState<IncomingCall | null>(null);
  const [timer, setTimer] = useState(0);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);
  const streamsRef = useRef<MediaStream[]>([]);

  const teardown = useCallback(
    (callId: string, reason: 'caller_hangup' | 'callee_reject' | 'failed') => {
      pcRef.current?.close();
      pcRef.current = null;
      streamsRef.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
      streamsRef.current = [];
      socket.emit('call.end', { call_id: callId, reason, duration_ms: timer });
      setActive(null);
      setIncoming(null);
    },
    [socket, timer],
  );

  useEffect(() => {
    if (!active) return;
    const iv = setInterval(() => setTimer((t) => t + 1), 1000);
    return () => clearInterval(iv);
  }, [active]);

  /* ---- answer an incoming call ---- */
  const accept = useCallback(async () => {
    if (!incoming) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: incoming.kind === 'video', audio: true,
      });
      streamsRef.current = [stream];
      if (localRef.current) localRef.current.srcObject = stream;

      const pc = new RTCPeerConnection({ iceServers: (incoming.ice_servers ?? []).map((s) => ({ urls: s.urls, username: s.username, credential: s.credential })) });
      pcRef.current = pc;
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      pc.onicecandidate = (e) => {
        if (e.candidate) socket.emit('call.ice', { call_id: incoming.call_id, from: myId, candidate: e.candidate.toJSON() });
      };
      pc.ontrack = (e) => {
        if (remoteRef.current) remoteRef.current.srcObject = e.streams[0];
      };

      await pc.setRemoteDescription(incoming.sdp!);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('call.answer', { call_id: incoming.call_id, caller_id: incoming.caller_id, callee_id: myId, sdp: pc.localDescription });
      setActive(incoming);
      setIncoming(null);
    } catch {
      teardown(incoming.call_id, 'failed');
    }
  }, [incoming, myId, socket, teardown]);

  /* ---- ring listener + ICE relay for the answered leg ---- */
  useEffect(() => {
    const onIncoming = (p: IncomingCall) => setIncoming(p);
    const onIce = (p: CallIcePayload) => {
      void pcRef.current?.addIceCandidate(p.candidate).catch(() => {});
    };
    const onEnd = (p: { call_id: string }) => {
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
        streamsRef.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
        streamsRef.current = [];
      }
      setActive(null);
      setIncoming(null);
      void p;
    };
    socket.on('call.incoming', onIncoming);
    socket.on('call.ice', onIce);
    socket.on('call.end', onEnd);
    return () => {
      socket.off('call.incoming', onIncoming);
      socket.off('call.ice', onIce);
      socket.off('call.end', onEnd);
    };
  }, [socket]);

  /* ---- start an outgoing call ---- */
  const start = useCallback(
    async (kind: 'audio' | 'video') => {
      const callId = `call_${randomUUID().slice(0, 8)}`;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: kind === 'video', audio: true });
        streamsRef.current = [stream];
        if (localRef.current) localRef.current.srcObject = stream;
        const pc = new RTCPeerConnection();
        pcRef.current = pc;
        stream.getTracks().forEach((t) => pc.addTrack(t, stream));
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('call.offer', { call_id: callId, caller_id: myId, callee_id: peerId, kind, sdp: pc.localDescription });
        socket.once('call.connected', async (p: { call_id: string; callee_id: string; sdp: SessionDescriptionInit }) => {
          await pc.setRemoteDescription(p.sdp);
          setActive({ call_id: callId, caller_id: myId, kind });
        });
        pc.onicecandidate = (e) => {
          if (e.candidate) socket.emit('call.ice', { call_id: callId, from: myId, candidate: e.candidate.toJSON() });
        };
      } catch {
        teardown(callId, 'failed');
      }
    },
    [myId, peerId, socket, teardown],
  );

  if (!incoming && !active) {
    return (
      <div style={{ position: 'fixed', right: 16, bottom: 16, display: 'flex', gap: 8, zIndex: 10 }}>
        <button className="cv-btn" style={{ borderRadius: '50%', width: 46, height: 46, fontSize: 18 }} onClick={() => start('audio')} title="Audio call">{'📞'}</button>
        <button className="cv-btn" style={{ borderRadius: '50%', width: 46, height: 46, fontSize: 18 }} onClick={() => start('video')} title="Video call">{'🎥'}</button>
      </div>
    );
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(8,12,24,.92)', zIndex: 100, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
      {incoming ? (
        <>
          <div style={{ fontSize: 18, marginBottom: 6 }}>{incoming.kind === 'video' ? '📹 Incoming video call' : '📞 Incoming audio call'}</div>
          <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 20 }}>{incoming.caller_id}</div>
          <div style={{ display: 'flex', gap: 24 }}>
            <button className="cv-btn" style={{ background: '#EF4444', width: 110 }} onClick={() => teardown(incoming.call_id, 'callee_reject')}>Decline</button>
            <button className="cv-btn" style={{ background: '#10B981', width: 110 }} onClick={accept}>Accept</button>
          </div>
        </>
      ) : (
        <>
          <video ref={localRef} muted playsInline autoPlay style={{ width: '34%', maxWidth: 320, borderRadius: 12, border: '1px solid rgba(255,255,255,.25)', marginBottom: 10 }} />
          <video ref={remoteRef} playsInline autoPlay style={{ width: '60%', maxWidth: 560, borderRadius: 12, background: '#000', minHeight: 180 }} />
          <div style={{ margin: '6px 0 14px', fontSize: 13, opacity: 0.85 }}>
            Call in progress · {String(Math.floor(timer / 60)).padStart(2, '0')}:{String(timer % 60).padStart(2, '0')}
          </div>
          <button className="cv-btn" style={{ background: '#EF4444', width: 140 }} onClick={() => active && teardown(active.call_id, 'caller_hangup')}>
            End call
          </button>
        </>
      )}
    </div>
  );
}
