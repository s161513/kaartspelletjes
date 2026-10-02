import type { ClientMessage, ServerMessage } from "@app/shared";
import { session } from "./session.js";

type Handler<T extends ServerMessage["type"]> = (
  msg: Extract<ServerMessage, { type: T }>,
) => void;

/**
 * A single reconnecting WebSocket with typed send/on.
 * On every (re)open it auto-sends `rejoin` if we already have a seat, so an
 * accidental reload or network blip restores the player to their room/game.
 */
export class GameSocket {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<(m: ServerMessage) => void>>();
  private openHandlers = new Set<() => void>();
  private queue: ClientMessage[] = [];
  private reconnectTimer: number | null = null;
  private manualClose = false;

  constructor() {
    this.connect();
  }

  private url(): string {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.host}/ws`;
  }

  private connect(): void {
    const ws = new WebSocket(this.url());
    this.ws = ws;

    ws.onopen = () => {
      // Restore an existing seat first, then flush anything queued.
      if (session.roomCode && session.playerId) {
        this.sendNow({
          type: "rejoin",
          roomCode: session.roomCode,
          playerId: session.playerId,
        });
      }
      for (const m of this.queue.splice(0)) this.sendNow(m);
      for (const h of this.openHandlers) h();
    };

    ws.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(ev.data) as ServerMessage;
      } catch {
        return;
      }
      const set = this.handlers.get(msg.type);
      if (set) for (const h of set) h(msg);
    };

    ws.onclose = () => {
      this.ws = null;
      if (this.manualClose) return;
      // Backoff-ish reconnect.
      if (this.reconnectTimer === null) {
        this.reconnectTimer = window.setTimeout(() => {
          this.reconnectTimer = null;
          this.connect();
        }, 1000);
      }
    };
  }

  private sendNow(msg: ClientMessage): void {
    this.ws?.send(JSON.stringify(msg));
  }
  /** Game renderers can avoid buffering time-sensitive moves during a drop. */
  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Send now if open, otherwise queue until the socket (re)connects. */
  send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendNow(msg);
    } else {
      this.queue.push(msg);
    }
  }

  on<T extends ServerMessage["type"]>(type: T, handler: Handler<T>): void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as (m: ServerMessage) => void);
  }

  /** Run on every (re)connect, e.g. to renew a subscription the old socket held. */
  onOpen(handler: () => void): void {
    this.openHandlers.add(handler);
    if (this.connected) handler();
  }

  close(): void {
    this.manualClose = true;
    this.ws?.close();
  }
}
