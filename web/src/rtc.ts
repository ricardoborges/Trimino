// Malha WebRTC: uma RTCPeerConnection por participante.
// Quem entra na sala oferta para quem já estava; o outro lado só responde.

import type { IceServer, SignalData } from "@trimino/shared";

interface Peer {
  pc: RTCPeerConnection;
  stream: MediaStream;
  pendingIce: RTCIceCandidateInit[];
}

export class Mesh {
  local: MediaStream | null = null;
  private peers = new Map<string, Peer>();
  iceServers: IceServer[] = [];

  constructor(
    private sendSignal: (to: string, data: SignalData) => void,
    private onRemote: (peerId: string, stream: MediaStream | null) => void,
  ) {}

  async startLocal(): Promise<MediaStream | null> {
    try {
      this.local = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } },
      });
    } catch {
      try {
        this.local = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        this.local = null;
      }
    }
    return this.local;
  }

  setEnabled(kind: "audio" | "video", enabled: boolean): void {
    this.local?.getTracks().filter((t) => t.kind === kind).forEach((t) => (t.enabled = enabled));
  }

  isEnabled(kind: "audio" | "video"): boolean {
    const t = this.local?.getTracks().find((t) => t.kind === kind);
    return !!t && t.enabled;
  }

  hasTrack(kind: "audio" | "video"): boolean {
    return !!this.local?.getTracks().some((t) => t.kind === kind);
  }

  private create(peerId: string): Peer {
    this.close(peerId);
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const peer: Peer = { pc, stream: new MediaStream(), pendingIce: [] };
    this.peers.set(peerId, peer);

    pc.onicecandidate = (e) => {
      if (e.candidate)
        this.sendSignal(peerId, { type: "ice", candidate: e.candidate.candidate, sdpMid: e.candidate.sdpMid, sdpMLineIndex: e.candidate.sdpMLineIndex });
    };
    pc.ontrack = (e) => {
      peer.stream.addTrack(e.track);
      e.track.onended = () => peer.stream.removeTrack(e.track);
      this.onRemote(peerId, peer.stream);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") this.onRemote(peerId, null);
    };
    return peer;
  }

  /** Chamado por quem acabou de entrar, uma vez para cada participante existente. */
  async call(peerId: string): Promise<void> {
    const { pc } = this.create(peerId);
    for (const kind of ["audio", "video"] as const) {
      const track = this.local?.getTracks().find((t) => t.kind === kind);
      if (track) pc.addTransceiver(track, { direction: "sendrecv", streams: [this.local!] });
      else pc.addTransceiver(kind, { direction: "recvonly" });
    }
    await pc.setLocalDescription(await pc.createOffer());
    this.sendSignal(peerId, { type: "offer", sdp: pc.localDescription!.sdp });
  }

  async onSignal(from: string, data: SignalData): Promise<void> {
    if (data.type === "offer") {
      const peer = this.create(from);
      const { pc } = peer;
      await pc.setRemoteDescription({ type: "offer", sdp: data.sdp });
      // Reaproveita os transceptores criados pela oferta para enviar nossa mídia.
      for (const tr of pc.getTransceivers()) {
        const kind = tr.receiver.track.kind;
        const track = this.local?.getTracks().find((t) => t.kind === kind);
        if (track) {
          await tr.sender.replaceTrack(track);
          tr.sender.setStreams?.(this.local!);
          tr.direction = "sendrecv";
        }
      }
      await pc.setLocalDescription(await pc.createAnswer());
      this.sendSignal(from, { type: "answer", sdp: pc.localDescription!.sdp });
      await this.flushIce(peer);
    } else if (data.type === "answer") {
      const peer = this.peers.get(from);
      if (!peer || peer.pc.signalingState !== "have-local-offer") return;
      await peer.pc.setRemoteDescription({ type: "answer", sdp: data.sdp });
      await this.flushIce(peer);
    } else if (data.type === "ice") {
      const peer = this.peers.get(from);
      if (!peer) return;
      const init: RTCIceCandidateInit = { candidate: data.candidate, sdpMid: data.sdpMid, sdpMLineIndex: data.sdpMLineIndex };
      if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(init).catch(() => {});
      else peer.pendingIce.push(init);
    }
  }

  private async flushIce(peer: Peer): Promise<void> {
    for (const c of peer.pendingIce.splice(0)) await peer.pc.addIceCandidate(c).catch(() => {});
  }

  close(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    peer.pc.close();
    this.peers.delete(peerId);
    this.onRemote(peerId, null);
  }

  closeAll(): void {
    for (const id of [...this.peers.keys()]) this.close(id);
  }
}
