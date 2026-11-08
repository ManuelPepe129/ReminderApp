import { loadConfig } from './config';
import { runMigrations } from './db';

const config = loadConfig();
await runMigrations(config.databaseUrl);
console.log('Migrations applied');
