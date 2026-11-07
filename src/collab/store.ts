import { compareStamps, type Op } from '../crdt/replica';

/** Durable storage of winning register writes. Merging is by stamp, so saves are idempotent. */
export interface OpStore {
  load(): Promise<Op[]>;
  save(ops: readonly Op[]): Promise<void>;
}

export class MemoryStore implements OpStore {
  private readonly regs = new Map<string, Op>();
  load(): Promise<Op[]> {
    return Promise.resolve([...this.regs.values()].map((o) => structuredClone(o)));
  }
  save(ops: readonly Op[]): Promise<void> {
    for (const op of ops) {
      const k = `${op.id}\u0000${op.key}`;
      const cur = this.regs.get(k);
      if (!cur || compareStamps(cur.stamp, op.stamp) < 0) this.regs.set(k, structuredClone(op));
    }
    return Promise.resolve();
  }
}

const STORE = 'registers';

/** IndexedDB-backed store: one record per (node, property) register. */
export class IndexedDbStore implements OpStore {
  private db: Promise<IDBDatabase> | null = null;

  constructor(private readonly name = 'frameloom') {}

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(this.name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    });
    return this.db;
  }

  async load(): Promise<Op[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result as Op[]);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed'));
    });
  }

  async save(ops: readonly Op[]): Promise<void> {
    if (ops.length === 0) return;
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      for (const op of ops) {
        const key = `${op.id}\u0000${op.key}`;
        // Read-compare-write inside one transaction so a stale write can't clobber a newer one.
        const get = store.get(key);
        get.onsuccess = () => {
          const cur = get.result as Op | undefined;
          if (!cur || compareStamps(cur.stamp, op.stamp) < 0) store.put(op, key);
        };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'));
    });
  }
}
