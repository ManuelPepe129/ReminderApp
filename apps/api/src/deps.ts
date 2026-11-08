import type { Config } from './config';
import type { Db } from './db';
import type { Mailer } from './lib/mailer';
import type { Realtime } from './lib/realtime';
import type { PushSender } from './notifications/push';

/** Everything the HTTP app and the worker need; injected so tests can swap implementations. */
export interface AppDeps {
  config: Config;
  db: Db;
  mailer: Mailer;
  realtime: Realtime;
  push: PushSender;
  /** Injectable clock (tests). */
  now: () => Date;
}
