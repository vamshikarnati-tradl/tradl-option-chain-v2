import type { WsServerMessage } from './types';
import type { DataStore } from './data-store';

export interface WsClientOptions {
  symbol: string;
  store: DataStore;
  url?: string;        // override (default: derived from window.location)
  reconnectMs?: number;
}

export class WsClient {
  private ws: WebSocket | null = null;
  private closed = false;
  private reconnectMs: number;
  private reconnectTimer: number | null = null;

  constructor(private opts: WsClientOptions) {
    this.reconnectMs = opts.reconnectMs ?? 2000;
  }

  start(): void {
    if (this.closed) return;
    const url = this.opts.url ?? this.deriveUrl();
    this.opts.store.setStatus('connecting');
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.opts.store.setStatus('open');
    });

    ws.addEventListener('message', (e) => {
      try {
        const msg = JSON.parse(e.data as string) as WsServerMessage;
        if (msg.type === 'snapshot') {
          this.opts.store.applySnapshot(msg.payload);
        } else if (msg.type === 'error') {
          this.opts.store.setStatus('error', msg.message);
        }
      } catch (err) {
        this.opts.store.setStatus('error', err instanceof Error ? err.message : String(err));
      }
    });

    ws.addEventListener('close', () => {
      if (this.closed) return;
      this.opts.store.setStatus('closed');
      this.scheduleReconnect();
    });

    ws.addEventListener('error', () => {
      // 'close' will follow
    });
  }

  stop(): void {
    this.closed = true;
    if (this.reconnectTimer != null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer != null) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.start();
    }, this.reconnectMs);
  }

  private deriveUrl(): string {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${window.location.host}/ws/option-chain/${this.opts.symbol}`;
  }
}
