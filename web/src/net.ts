import type { ClientMessage, ServerMessage } from "@trimino/shared";

const PING_INTERVAL_MS = 15_000;
const PONG_TIMEOUT_MS = 8_000;
const RESUME_CHECK_MS = 4_000;
const CONNECT_TIMEOUT_MS = 8_000;

/** WebSocket com reconexão automática, heartbeat (ping/pong) e reação imediata quando a rede volta. */
export class Connection {
  private ws: WebSocket | null = null;
  private retry = 0;
  private closed = false;
  private retryTimer = 0;
  private pingTimer = 0;
  private pongTimer = 0;
  private connectTimer = 0;

  private readonly handleOnline = () => this.probeOrReconnect();
  private readonly handleVisibility = () => {
    if (!document.hidden) this.probeOrReconnect();
  };

  constructor(
    private join: Extract<ClientMessage, { t: "join" }>,
    private onMessage: (msg: ServerMessage) => void,
    private onStatus: (online: boolean) => void,
  ) {
    window.addEventListener("online", this.handleOnline);
    document.addEventListener("visibilitychange", this.handleVisibility);
    this.open();
  }

  private open(): void {
    if (this.closed) return;
    this.clearTimers();
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?sala=${encodeURIComponent(this.join.room)}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    this.connectTimer = window.setTimeout(() => {
      if (this.ws === ws && ws.readyState === WebSocket.CONNECTING) {
        try { ws.close(); } catch { /* ignora */ }
      }
    }, CONNECT_TIMEOUT_MS);

    ws.onopen = () => {
      if (this.ws !== ws) return;
      clearTimeout(this.connectTimer);
      this.retry = 0;
      this.onStatus(true);
      ws.send(JSON.stringify(this.join));
      this.startHeartbeat(ws);
    };
    ws.onmessage = (e) => {
      if (this.ws !== ws) return;
      clearTimeout(this.pongTimer);
      this.pongTimer = 0;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.t === "pong") return;
      this.onMessage(msg);
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.clearTimers();
      this.onStatus(false);
      if (e.code === 4000) this.onKicked?.();
      if (e.code === 4003) this.onRefused?.(e.reason);
      if (this.closed || e.code === 4000 || e.code === 4003) return;
      const delay = Math.min(8_000, 400 * 2 ** Math.min(this.retry++, 5));
      this.retryTimer = window.setTimeout(() => this.open(), delay);
    };
  }

  private startHeartbeat(ws: WebSocket): void {
    this.pingTimer = window.setInterval(() => {
      if (this.ws !== ws || ws.readyState !== WebSocket.OPEN) return;
      this.pingNow(ws, PONG_TIMEOUT_MS);
    }, PING_INTERVAL_MS);
  }

  private pingNow(ws: WebSocket, timeoutMs: number): void {
    try {
      ws.send(JSON.stringify({ t: "ping" } satisfies ClientMessage));
    } catch {
      this.reconnectNow();
      return;
    }
    if (this.pongTimer) return;
    this.pongTimer = window.setTimeout(() => {
      if (this.ws !== ws) return;
      this.reconnectNow();
    }, timeoutMs);
  }

  /** Chamado quando a internet do aparelho volta ou a aba volta ao primeiro plano. */
  private probeOrReconnect(): void {
    if (this.closed) return;
    const ws = this.ws;
    if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
      this.reconnectNow();
    } else if (ws.readyState === WebSocket.OPEN) {
      this.pingNow(ws, RESUME_CHECK_MS);
    }
  }

  private reconnectNow(): void {
    if (this.closed) return;
    const old = this.ws;
    this.ws = null;
    this.clearTimers();
    this.retry = 0;
    this.onStatus(false);
    try { old?.close(); } catch { /* ignora */ }
    this.open();
  }

  private clearTimers(): void {
    clearTimeout(this.retryTimer);
    clearInterval(this.pingTimer);
    clearTimeout(this.pongTimer);
    clearTimeout(this.connectTimer);
    this.retryTimer = 0;
    this.pingTimer = 0;
    this.pongTimer = 0;
    this.connectTimer = 0;
  }

  /** O servidor fechou porque a mesma identidade conectou em outro lugar. */
  onKicked?: () => void;
  /** O servidor recusou a entrada (convidado numa mesa que não está aberta). */
  onRefused?: (reason: string) => void;

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close(): void {
    this.closed = true;
    window.removeEventListener("online", this.handleOnline);
    document.removeEventListener("visibilitychange", this.handleVisibility);
    this.clearTimers();
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }
}
