// Malha WebRTC: uma RTCPeerConnection por participante, com resolução de colisão (glare)
// e reconexão automática quando a conexão P2P oscila durante a partida.

import type { IceServer, SignalData } from "@trimino/shared";

interface Peer {
  pc: RTCPeerConnection;
  stream: MediaStream;
  pendingIce: RTCIceCandidateInit[];
  reconnectTimer: number;
  createdAt: number;
}

const STUCK_CONNECTING_MS = 12_000;

export class Mesh {
  local: MediaStream | null = null;
  myId = "";
  iceServers: IceServer[] = [];
  private peers = new Map<string, Peer>();
  private queues = new Map<string, Promise<void>>();
  private enabled = { audio: true, video: true };
  private hadVideo = false;

  constructor(
    private sendSignal: (to: string, data: SignalData) => void,
    private onRemote: (peerId: string, stream: MediaStream | null) => void,
  ) {}

  async startLocal(): Promise<MediaStream | null> {
    this.local?.getTracks().forEach((t) => t.stop());
    try {
      this.local = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } },
      });
      this.hadVideo = true;
    } catch {
      try {
        this.local = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        this.local = null;
      }
    }
    if (this.local) {
      for (const kind of ["audio", "video"] as const) {
        this.local.getTracks().filter((t) => t.kind === kind).forEach((t) => (t.enabled = this.enabled[kind]));
      }
    }
    return this.local;
  }

  /**
   * Em celulares, bloquear a tela ou trocar de aplicativo pode encerrar (`ended`) as trilhas da câmera/microfone.
   * Reabre a captura quando necessário e substitui as trilhas nas conexões ativas.
   */
  async ensureLocal(): Promise<MediaStream | null> {
    const tracks = this.local?.getTracks() ?? [];
    const alive = tracks.some((t) => t.readyState === "live");
    const videoEnded = this.hadVideo && !tracks.some((t) => t.kind === "video" && t.readyState === "live");
    if (this.local && alive && !videoEnded) return this.local;
    await this.startLocal();
    if (this.local) {
      for (const [peerId, peer] of this.peers) {
        for (const tr of peer.pc.getTransceivers()) {
          const kind = tr.receiver.track?.kind;
          const track = this.local.getTracks().find((t) => t.kind === kind && t.readyState === "live");
          if (track) {
            await tr.sender.replaceTrack(track).catch(() => {});
          }
        }
        if (peer.pc.connectionState === "failed" || peer.pc.connectionState === "disconnected") {
          this.scheduleReconnect(peerId, 300);
        }
      }
    }
    return this.local;
  }

  setEnabled(kind: "audio" | "video", enabled: boolean): void {
    this.enabled[kind] = enabled;
    this.local?.getTracks().filter((t) => t.kind === kind).forEach((t) => (t.enabled = enabled));
  }

  isEnabled(kind: "audio" | "video"): boolean {
    const t = this.local?.getTracks().find((t) => t.kind === kind && t.readyState === "live");
    return !!t && t.enabled;
  }

  hasTrack(kind: "audio" | "video"): boolean {
    return !!this.local?.getTracks().some((t) => t.kind === kind && t.readyState === "live");
  }

  peerState(peerId: string): RTCPeerConnectionState | null {
    return this.peers.get(peerId)?.pc.connectionState ?? null;
  }

  private enqueue(peerId: string, task: () => Promise<void>): Promise<void> {
    const prev = this.queues.get(peerId) ?? Promise.resolve();
    const next = prev.then(task).catch((err) => console.error(`[rtc ${peerId}]`, err));
    this.queues.set(peerId, next);
    return next;
  }

  private disposePeer(peerId: string): void {
    const prev = this.peers.get(peerId);
    if (!prev) return;
    clearTimeout(prev.reconnectTimer);
    prev.pc.onicecandidate = null;
    prev.pc.ontrack = null;
    prev.pc.onconnectionstatechange = null;
    prev.pc.oniceconnectionstatechange = null;
    try { prev.pc.close(); } catch { /* ignora */ }
    this.peers.delete(peerId);
  }

  private create(peerId: string): Peer {
    this.disposePeer(peerId);
    const pc = new RTCPeerConnection({ iceServers: this.iceServers, iceCandidatePoolSize: 4 });
    const peer: Peer = { pc, stream: new MediaStream(), pendingIce: [], reconnectTimer: 0, createdAt: Date.now() };
    this.peers.set(peerId, peer);

    pc.onicecandidate = (e) => {
      if (this.peers.get(peerId)?.pc !== pc) return;
      if (e.candidate)
        this.sendSignal(peerId, { type: "ice", candidate: e.candidate.candidate, sdpMid: e.candidate.sdpMid, sdpMLineIndex: e.candidate.sdpMLineIndex });
    };
    pc.ontrack = (e) => {
      if (this.peers.get(peerId)?.pc !== pc) return;
      const track = e.track;
      if (!peer.stream.getTracks().includes(track)) peer.stream.addTrack(track);
      const notify = () => {
        if (this.peers.get(peerId)?.pc === pc) this.onRemote(peerId, peer.stream);
      };
      track.onunmute = notify;
      track.onmute = notify;
      track.onended = () => {
        peer.stream.removeTrack(track);
        notify();
      };
      notify();
    };
    const checkState = () => {
      if (this.peers.get(peerId)?.pc !== pc) return;
      const state = pc.connectionState;
      const ice = pc.iceConnectionState;
      if (state === "connected" || ice === "connected" || ice === "completed") {
        clearTimeout(peer.reconnectTimer);
        peer.reconnectTimer = 0;
        this.onRemote(peerId, peer.stream);
      } else if (state === "failed" || ice === "failed") {
        this.onRemote(peerId, peer.stream);
        this.scheduleReconnect(peerId, this.myId && this.myId < peerId ? 1000 : 2200);
      } else if (state === "disconnected" || ice === "disconnected") {
        this.onRemote(peerId, peer.stream);
        this.scheduleReconnect(peerId, this.myId && this.myId < peerId ? 3500 : 5000);
      }
    };
    pc.onconnectionstatechange = checkState;
    pc.oniceconnectionstatechange = checkState;
    return peer;
  }

  private scheduleReconnect(peerId: string, delayMs: number): void {
    const peer = this.peers.get(peerId);
    if (peer?.reconnectTimer) return;
    const timer = window.setTimeout(() => {
      const cur = this.peers.get(peerId);
      if (cur) cur.reconnectTimer = 0;
      const st = cur?.pc.connectionState;
      const ice = cur?.pc.iceConnectionState;
      if (st === "connected" || ice === "connected" || ice === "completed") return;
      void this.call(peerId);
    }, delayMs);
    if (peer) peer.reconnectTimer = timer;
  }

  /**
   * Garante que exista uma conexão ativa ou em andamento com `peerId` (ex.: após oscilação de rede).
   */
  ensurePeer(peerId: string): void {
    if (!peerId || peerId === this.myId) return;
    const peer = this.peers.get(peerId);
    if (!peer) {
      const delay = this.myId && this.myId < peerId ? 600 : 1800;
      const dummy = this.create(peerId);
      this.scheduleReconnect(peerId, delay);
      this.onRemote(peerId, dummy.stream);
      return;
    }
    const st = peer.pc.connectionState;
    const ice = peer.pc.iceConnectionState;
    const stuck = (st === "new" || st === "connecting") && Date.now() - peer.createdAt > STUCK_CONNECTING_MS;
    if (st === "failed" || st === "closed" || ice === "failed" || stuck) {
      this.scheduleReconnect(peerId, this.myId && this.myId < peerId ? 800 : 2000);
    }
  }

  /** Chamado por quem acabou de entrar (ou reconectar), uma vez para cada participante existente. */
  call(peerId: string): Promise<void> {
    return this.enqueue(peerId, async () => {
      const peer = this.create(peerId);
      const { pc } = peer;
      for (const kind of ["audio", "video"] as const) {
        const track = this.local?.getTracks().find((t) => t.kind === kind && t.readyState === "live");
        if (track && this.local) pc.addTransceiver(track, { direction: "sendrecv", streams: [this.local] });
        else pc.addTransceiver(kind, { direction: "recvonly" });
      }
      await pc.setLocalDescription(await pc.createOffer());
      this.sendSignal(peerId, { type: "offer", sdp: pc.localDescription!.sdp });
      this.onRemote(peerId, peer.stream);
    });
  }

  onSignal(from: string, data: SignalData): Promise<void> {
    return this.enqueue(from, async () => {
      if (data.type === "renegotiate") {
        await this.call(from);
        return;
      }
      if (data.type === "offer") {
        // Colisão de ofertas (glare): o par com menor ID mantém a própria oferta; o outro aceita a recebida.
        const existing = this.peers.get(from);
        if (existing && existing.pc.signalingState === "have-local-offer" && this.myId && this.myId < from) {
          return;
        }
        const peer = this.create(from);
        const { pc } = peer;
        await pc.setRemoteDescription({ type: "offer", sdp: data.sdp });
        // Reaproveita os transceptores criados pela oferta para enviar nossa mídia.
        for (const tr of pc.getTransceivers()) {
          const kind = tr.receiver.track.kind;
          const track = this.local?.getTracks().find((t) => t.kind === kind && t.readyState === "live");
          if (track && this.local) {
            await tr.sender.replaceTrack(track);
            tr.sender.setStreams?.(this.local);
            tr.direction = "sendrecv";
          }
        }
        await pc.setLocalDescription(await pc.createAnswer());
        this.sendSignal(from, { type: "answer", sdp: pc.localDescription!.sdp });
        await this.flushIce(peer);
        this.onRemote(from, peer.stream);
      } else if (data.type === "answer") {
        const peer = this.peers.get(from);
        if (!peer || peer.pc.signalingState !== "have-local-offer") return;
        await peer.pc.setRemoteDescription({ type: "answer", sdp: data.sdp });
        await this.flushIce(peer);
        this.onRemote(from, peer.stream);
      } else if (data.type === "ice") {
        const peer = this.peers.get(from);
        if (!peer) return;
        const init: RTCIceCandidateInit = { candidate: data.candidate, sdpMid: data.sdpMid, sdpMLineIndex: data.sdpMLineIndex };
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(init).catch(() => {});
        else peer.pendingIce.push(init);
      }
    });
  }

  private async flushIce(peer: Peer): Promise<void> {
    for (const c of peer.pendingIce.splice(0)) await peer.pc.addIceCandidate(c).catch(() => {});
  }

  close(peerId: string): void {
    if (!this.peers.has(peerId)) return;
    this.disposePeer(peerId);
    this.onRemote(peerId, null);
  }

  closeAll(): void {
    for (const id of [...this.peers.keys()]) this.close(id);
  }
}
