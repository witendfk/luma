/** Bounded process-local cache for pure deterministic computations, not student responses. */
export class ResultCache<T> {
  private entries = new Map<string, { value: T; expires: number }>();
  private inFlight = new Map<string, Promise<T>>();
  private hits = 0;
  private misses = 0;
  constructor(private maxEntries: number, private ttlMs = 3600000, private now = Date.now) {}
  stats() { return { hits: this.hits, misses: this.misses, entries: this.entries.size, inFlight: this.inFlight.size }; }
  async get(key: string, compute: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && hit.expires > this.now()) {
      this.entries.delete(key); this.entries.set(key, hit); this.hits++; return hit.value;
    }
    this.entries.delete(key);
    const pending = this.inFlight.get(key);
    if (pending) { this.hits++; return pending; }
    this.misses++;
    const promise = Promise.resolve().then(compute).then((value) => {
      if (this.entries.size >= this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
      this.entries.set(key, { value, expires: this.now() + this.ttlMs });
      return value;
    }).finally(() => { if (this.inFlight.get(key) === promise) this.inFlight.delete(key); });
    // Prevent unbounded pending-key retention on a cold concurrent burst.
    if (this.inFlight.size < this.maxEntries) this.inFlight.set(key, promise);
    return promise;
  }
}
