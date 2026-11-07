import type { Op } from '../crdt/replica';

/** Messages exchanged between tabs/peers. */
export type Message =
  /** CRDT register writes (a delta or a full snapshot). */
  | { t: 'ops'; ops: Op[] }
  /** A newly joined peer asks everyone for a snapshot. */
  | { t: 'hello'; from: string }
  /** Ephemeral presence: pointer position in world space. */
  | { t: 'cursor'; from: string; x: number; y: number; color: string; name: string }
  /** Peer left (tab closed). */
  | { t: 'bye'; from: string };

export interface Transport {
  send(msg: Message): void;
  /** Registers the (single) receiver; own messages are never echoed back. */
  onMessage(cb: (msg: Message) => void): void;
  close(): void;
}

/** Same-origin tabs through `BroadcastChannel` (which never echoes to the sender). */
export class BroadcastTransport implements Transport {
  private readonly channel: BroadcastChannel;

  constructor(name = 'frameloom-doc') {
    this.channel = new BroadcastChannel(name);
  }
  send(msg: Message): void {
    this.channel.postMessage(msg);
  }
  onMessage(cb: (msg: Message) => void): void {
    this.channel.onmessage = (e: MessageEvent<Message>) => cb(e.data);
  }
  close(): void {
    this.channel.close();
  }
}

/**
 * In-memory hub for tests: `join()` returns transports that deliver to every
 * other member. Messages are structured-cloned like a real channel, and can be
 * held back (`pause`) to simulate latency and reordering.
 */
export class MemoryHub {
  private readonly members = new Set<MemoryTransport>();
  private paused = false;
  private queue: (() => void)[] = [];

  join(): Transport {
    const t = new MemoryTransport(this);
    this.members.add(t);
    return t;
  }
  pause(): void {
    this.paused = true;
  }
  /** Delivers held messages (optionally in reverse order) and resumes. */
  flush(reverse = false): void {
    this.paused = false;
    const q = reverse ? this.queue.reverse() : this.queue;
    this.queue = [];
    for (const f of q) f();
  }
  /** @internal */
  broadcast(from: MemoryTransport, msg: Message): void {
    const copy = structuredClone(msg);
    for (const m of this.members) {
      if (m === from) continue;
      const deliver = (): void => m.receive(copy);
      if (this.paused) this.queue.push(deliver);
      else deliver();
    }
  }
  /** @internal */
  leave(t: MemoryTransport): void {
    this.members.delete(t);
  }
}

class MemoryTransport implements Transport {
  private cb: ((msg: Message) => void) | null = null;
  constructor(private readonly hub: MemoryHub) {}
  send(msg: Message): void {
    this.hub.broadcast(this, msg);
  }
  onMessage(cb: (msg: Message) => void): void {
    this.cb = cb;
  }
  close(): void {
    this.hub.leave(this);
  }
  receive(msg: Message): void {
    this.cb?.(msg);
  }
}
