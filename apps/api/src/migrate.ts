import { loadConfig } from './config';
import { runMigrations, waitForDatabase } from './db';

const config = loadConfig();
await waitForDatabase(config.databaseUrl);
await runMigrations(config.databaseUrl);
console.log('Migrations applied');
