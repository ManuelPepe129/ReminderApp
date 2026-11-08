import { loadConfig } from './config';
import { createPostgres, waitForDatabase } from './db';
import { createSmtpMailer } from './lib/mailer';
import { cleanup, runNotificationTick } from './notifications/scheduler';
import { createWebPushSender } from './notifications/push';

/**
 * Notification worker: every WORKER_INTERVAL_SECONDS computes due/advance
 * notifications and sends them (Web Push, e-mail fallback). Several workers
 * may run at once: de-duplication is enforced by the database.
 */
const config = loadConfig();
await waitForDatabase(config.databaseUrl);
const { db, client } = createPostgres(config.databaseUrl, 3);
const deps = {
  db,
  config,
  mailer: createSmtpMailer(config.smtpUrl, config.mailFrom),
  push: createWebPushSender(config.vapid),
  now: () => new Date(),
};

const log = (msg: string, extra: object = {}) =>
  console.log(JSON.stringify({ time: new Date().toISOString(), msg, ...extra }));

if (!config.vapid) log('VAPID keys not configured: push disabled, e-mail only');

let running = false;
let lastCleanup = 0;
async function tick() {
  if (running) return;
  running = true;
  try {
    const r = await runNotificationTick(deps);
    if (r.candidates > 0) log('notification tick', r);
    if (Date.now() - lastCleanup > 3_600_000) {
      await cleanup(deps);
      lastCleanup = Date.now();
    }
  } catch (err) {
    log('notification tick failed', { error: String(err) });
  } finally {
    running = false;
  }
}

const timer = setInterval(() => void tick(), config.workerIntervalSeconds * 1000);
void tick();
log('worker started', { intervalSeconds: config.workerIntervalSeconds });

async function shutdown() {
  clearInterval(timer);
  await client.end({ timeout: 5 });
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
