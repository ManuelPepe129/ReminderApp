import { buildApp } from './app';
import { loadConfig } from './config';
import { createPostgres, runMigrations, waitForDatabase } from './db';
import { createSmtpMailer } from './lib/mailer';
import { PgRealtime } from './lib/realtime';
import { createWebPushSender } from './notifications/push';

const config = loadConfig();
await waitForDatabase(config.databaseUrl);
if (process.env.MIGRATE_ON_START !== 'false') await runMigrations(config.databaseUrl);

const { db, client } = createPostgres(config.databaseUrl);
const realtime = new PgRealtime(client);
await realtime.start();

const app = await buildApp({
  config,
  db,
  mailer: createSmtpMailer(config.smtpUrl, config.mailFrom),
  realtime,
  push: createWebPushSender(config.vapid),
  now: () => new Date(),
});

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await app.close();
  await realtime.close();
  await client.end({ timeout: 5 });
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

await app.listen({ host: config.host, port: config.port });
