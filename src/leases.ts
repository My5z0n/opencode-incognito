export const MARKER = 'opencode-incognito.owner';
export const LEASE_MS = 180_000;
export const HEARTBEAT_MS = 15_000;

export interface Lease {
  owner: string;
  sessionID: string;
  expiresAt: number;
}

export interface LeaseBackend {
  save(leases: Lease[]): Promise<void>;
  ownerOf(sessionID: string): Promise<string | undefined>;
  remove(sessionID: string): Promise<void>;
}

/** Serialized writes prevent heartbeats, creates and the sweeper losing updates. */
export class LeaseManager {
  private leases: Lease[];
  private queue: Promise<unknown> = Promise.resolve();
  private backend: LeaseBackend;
  private now: () => number;

  constructor(
    leases: Lease[],
    backend: LeaseBackend,
    now: () => number = Date.now,
  ) {
    this.leases = leases.map(lease => ({ ...lease }));
    this.backend = backend;
    this.now = now;
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task);
    this.queue = result.catch(() => {});
    return result;
  }

  private async commit(next: Lease[]): Promise<void> {
    await this.backend.save(next);
    this.leases = next;
  }

  /** Persist ownership BEFORE creating the session, covering interrupted creates. */
  track(owner: string, sessionID: string): Promise<void> {
    return this.serial(async () => {
      await this.commit([
        ...this.leases,
        { owner, sessionID, expiresAt: this.now() + LEASE_MS },
      ]);
    });
  }

  heartbeat(owner: string): Promise<void> {
    return this.serial(async () => {
      if (!this.leases.some(lease => lease.owner === owner)) return;
      await this.commit(this.leases.map(lease => lease.owner === owner && lease.expiresAt > 0
        ? { ...lease, expiresAt: this.now() + LEASE_MS }
        : lease));
    });
  }

  release(owner: string): Promise<void> {
    return this.serial(() => this.clean(lease => lease.owner === owner));
  }

  close(owner: string, sessionID: string): Promise<void> {
    return this.serial(async () => {
      const matches = (lease: Lease) => lease.owner === owner && lease.sessionID === sessionID;
      if (!this.leases.some(matches)) return;
      // Persist closing intent before deletion. Heartbeats must not renew it.
      await this.commit(this.leases.map(lease => matches(lease) ? { ...lease, expiresAt: 0 } : lease));
      await this.clean(matches);
    });
  }

  sweep(): Promise<void> {
    return this.serial(() => this.clean(lease => lease.expiresAt <= this.now()));
  }

  private async clean(matches: (lease: Lease) => boolean): Promise<void> {
    const removed = new Set<string>();
    const failures: unknown[] = [];
    await Promise.all(this.leases.filter(matches).map(async lease => {
      try {
        // Never delete based on title, directory, session age or history listing.
        if (await this.backend.ownerOf(lease.sessionID) === lease.owner) {
          await this.backend.remove(lease.sessionID);
        }
        removed.add(lease.sessionID);
      } catch (error) {
        // Keep failures in the registry so the next sweep can retry.
        failures.push(error);
      }
    }));
    if (removed.size) await this.commit(this.leases.filter(lease => !removed.has(lease.sessionID)));
    if (failures.length) throw new AggregateError(failures, 'Incognito cleanup incomplete; will retry');
  }
}

export function parseLeases(value: unknown): Lease[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(lease =>
    !lease || typeof lease.owner !== 'string' || typeof lease.sessionID !== 'string'
    || typeof lease.expiresAt !== 'number' || !Number.isFinite(lease.expiresAt))) {
    throw new Error('Invalid incognito registry; refusing to delete sessions');
  }
  return value;
}
