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

/**
 * Values remembered for a while and then forgotten, such as how far behind a
 * stream had to play. Forgetting lets the value be found again, in case what
 * it depended on has changed.
 */
export class ExpiringMap<Value> {
  private readonly entries = new Map<string, { value: Value; until: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Remembers `value` under `key` for the next `ttlMs`. */
  set(key: string, value: Value): void {
    this.entries.set(key, { value, until: this.now() + this.ttlMs });
  }

  /** The value set under `key` less than `ttlMs` ago, or undefined. */
  get(key: string): Value | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (this.now() < entry.until) return entry.value;
    this.entries.delete(key);
    return undefined;
  }

  clear(): void {
    this.entries.clear();
  }
}
