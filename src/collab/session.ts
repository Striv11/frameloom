import type { Replica, Op } from '../crdt/replica';
import type { SceneDocument } from '../model/document';
import { reconcile } from './reconcile';
import type { OpStore } from './store';
import type { Message, Transport } from './transport';

export interface Peer {
  id: string;
  x: number;
  y: number;
  color: string;
  name: string;
  /** performance.now()-style timestamp of the last message. */
  seen: number;
}

export interface SessionOptions {
  doc: SceneDocument;
  replica: Replica;
  transport: Transport;
  store?: OpStore | undefined;
  /** Called after remote changes were merged into `doc`. */
  onRemoteChange?: () => void;
  onPresence?: () => void;
  now?: () => number;
}

/**
 * Keeps a live `SceneDocument` and a CRDT `Replica` in step, and talks to peers.
 *
 * - `localChanged()` diffs the document against the replica, turns the
 *   difference into ops, broadcasts them and queues them for persistence.
 * - Incoming ops are merged into the replica and the document is reconciled to
 *   the replica's materialized state.
 * - A fresh session says `hello`; peers answer with a snapshot.
 */
export class CollabSession {
  readonly peers = new Map<string, Peer>();
  private readonly o: SessionOptions;
  private pending: Op[] = [];
  private saving: Promise<void> = Promise.resolve();

  constructor(options: SessionOptions) {
    this.o = options;
    options.transport.onMessage((m) => this.receive(m));
  }

  /** Loads persisted state into the replica and document, then announces itself. */
  async start(): Promise<void> {
    const { store, replica, doc } = this.o;
    if (store) {
      const saved = await store.load();
      replica.applyAll(saved);
    }
    if (replica.isEmpty) {
      // First ever run: the current document becomes the shared starting state.
      this.localChanged();
    } else {
      reconcile(doc, replica.toDocument());
    }
    this.o.transport.send({ t: 'hello', from: replica.id });
  }

  /** Mirrors local document edits into the replica. Returns the ops produced. */
  localChanged(): Op[] {
    const { replica, doc } = this.o;
    const ops: Op[] = [];
    reconcile(replica.toDocument(), doc, {
      add: (n, parent, index) => {
        const { id, type, parentId: _p, children: _c, ...props } = n;
        void _p;
        void _c;
        ops.push(...replica.put(id, type, props, parent, index));
      },
      update: (id, patch) => ops.push(...replica.set(id, patch)),
      move: (id, parent, index) => ops.push(...replica.move(id, parent, index)),
      remove: (id) => ops.push(...replica.remove(id)),
    });
    if (ops.length > 0) {
      this.o.transport.send({ t: 'ops', ops });
      this.persist(ops);
    }
    return ops;
  }

  sendCursor(x: number, y: number, color: string, name: string): void {
    this.o.transport.send({ t: 'cursor', from: this.o.replica.id, x, y, color, name });
  }

  /** Resolves when everything queued so far has been written to the store. */
  flush(): Promise<void> {
    return this.saving;
  }

  close(): void {
    this.o.transport.send({ t: 'bye', from: this.o.replica.id });
    this.o.transport.close();
  }

  private receive(msg: Message): void {
    const now = (this.o.now ?? Date.now)();
    switch (msg.t) {
      case 'ops': {
        let changed = false;
        for (const op of msg.ops) changed = this.o.replica.apply(op) || changed;
        this.persist(msg.ops);
        if (changed) {
          reconcile(this.o.doc, this.o.replica.toDocument());
          this.o.onRemoteChange?.();
        }
        break;
      }
      case 'hello':
        this.o.transport.send({ t: 'ops', ops: this.o.replica.snapshot() });
        break;
      case 'cursor':
        this.peers.set(msg.from, {
          id: msg.from,
          x: msg.x,
          y: msg.y,
          color: msg.color,
          name: msg.name,
          seen: now,
        });
        this.o.onPresence?.();
        break;
      case 'bye':
        if (this.peers.delete(msg.from)) this.o.onPresence?.();
        break;
    }
  }

  private persist(ops: readonly Op[]): void {
    const store = this.o.store;
    if (!store) return;
    this.pending.push(...ops);
    // Coalesce everything queued in the same tick into one transaction.
    if (this.pending.length === ops.length) {
      this.saving = this.saving
        .then(async () => {
          const batch = this.pending;
          this.pending = [];
          await store.save(batch);
        })
        .catch((err: unknown) => {
          console.warn('frameloom: persisting ops failed', err);
        });
    }
  }
}
