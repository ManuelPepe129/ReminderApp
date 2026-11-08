import { EventEmitter } from 'node:events';
import type { Sql } from 'postgres';

export interface ChangeEvent {
  listId: string;
  kind: 'actions' | 'members' | 'list' | 'list_deleted';
  actionId?: string;
  /** Users whose membership changed (e.g. removed members must refresh their lists). */
  userIds?: string[];
}

export interface Realtime {
  publish(event: ChangeEvent): Promise<void>;
  subscribe(listener: (event: ChangeEvent) => void): () => void;
  close(): Promise<void>;
}

const CHANNEL = 'reminder_changes';

/** In-process bus: enough for a single API instance and for tests. */
export class LocalRealtime implements Realtime {
  protected readonly emitter = new EventEmitter();
  constructor() {
    this.emitter.setMaxListeners(0);
  }
  async publish(event: ChangeEvent): Promise<void> {
    this.emitter.emit('change', event);
  }
  subscribe(listener: (event: ChangeEvent) => void): () => void {
    this.emitter.on('change', listener);
    return () => this.emitter.off('change', listener);
  }
  async close(): Promise<void> {
    this.emitter.removeAllListeners();
  }
}

/** Postgres LISTEN/NOTIFY bus: works across multiple API instances. */
export class PgRealtime extends LocalRealtime {
  private unlisten: (() => Promise<void>) | null = null;
  constructor(private readonly sql: Sql) {
    super();
  }
  async start(): Promise<void> {
    const sub = await this.sql.listen(CHANNEL, (payload) => {
      try {
        this.emitter.emit('change', JSON.parse(payload) as ChangeEvent);
      } catch {
        /* ignore malformed payloads */
      }
    });
    this.unlisten = sub.unlisten;
  }
  override async publish(event: ChangeEvent): Promise<void> {
    await this.sql.notify(CHANNEL, JSON.stringify(event));
  }
  override async close(): Promise<void> {
    await this.unlisten?.();
    await super.close();
  }
}
