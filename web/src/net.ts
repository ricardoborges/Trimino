import type { ClientMessage, ServerMessage } from "@trimino/shared";

/** WebSocket com reconexão automática; reenvia o `join` a cada conexão. */
export class Connection {
  private ws: WebSocket | null = null;
  private retry = 0;
  private closed = false;

  constructor(
    private join: Extract<ClientMessage, { t: "join" }>,
    private onMessage: (msg: ServerMessage) => void,
    private onStatus: (online: boolean) => void,
  ) {
    this.open();
  }

  private open(): void {
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.onStatus(true);
      ws.send(JSON.stringify(this.join));
    };
    ws.onmessage = (e) => this.onMessage(JSON.parse(e.data));
    ws.onclose = (e) => {
      this.onStatus(false);
      if (e.code === 4000) this.onKicked?.();
      if (this.closed || e.code === 4000) return;
      const delay = Math.min(10_000, 500 * 2 ** this.retry++);
      setTimeout(() => this.open(), delay);
    };
  }

  /** O servidor fechou porque a mesma identidade conectou em outro lugar. */
  onKicked?: () => void;

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
  }
}
