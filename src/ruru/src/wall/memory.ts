/**
 * Keys remembered for a while and then forgotten, such as a server whose
 * WebRTC did not connect. Forgetting lets Ruru try again once the cause may
 * have been fixed, without asking the user to restart.
 */
export class ExpiringSet {
  private readonly until = new Map<string, number>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Remembers `key` for the next `ttlMs`. */
  add(key: string): void {
    this.until.set(key, this.now() + this.ttlMs);
  }

  /** Whether `key` was added less than `ttlMs` ago. */
  has(key: string): boolean {
    const until = this.until.get(key);
    if (until === undefined) return false;
    if (this.now() < until) return true;
    this.until.delete(key);
    return false;
  }

  clear(): void {
    this.until.clear();
  }
}
