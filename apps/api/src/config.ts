import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().default('postgres://reminder:reminder@localhost:5433/reminder'),
  /** Public URL of the web app, used for links in e-mails and for the Origin check. */
  APP_ORIGIN: z.url().default('http://localhost:5173'),
  /** Set to true behind a reverse proxy (nginx) so req.ip/protocol are correct. */
  TRUST_PROXY: bool.default(false),
  COOKIE_SECURE: bool.optional(),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  SMTP_URL: z.string().default('smtp://localhost:1025'),
  MAIL_FROM: z.string().default('Promemoria <noreply@localhost>'),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:admin@localhost'),
  WORKER_INTERVAL_SECONDS: z.coerce.number().int().min(5).default(60),
  INVITE_RATE_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(20),
  AUTH_RATE_LIMIT_PER_15MIN: z.coerce.number().int().positive().default(20),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export interface Config {
  env: Env['NODE_ENV'];
  host: string;
  port: number;
  logLevel: Env['LOG_LEVEL'];
  databaseUrl: string;
  appOrigin: string;
  trustProxy: boolean;
  cookieSecure: boolean;
  sessionTtlDays: number;
  smtpUrl: string;
  mailFrom: string;
  vapid: { publicKey: string; privateKey: string; subject: string } | null;
  workerIntervalSeconds: number;
  inviteRateLimitPerHour: number;
  authRateLimitPer15Min: number;
  google: { clientId: string; clientSecret: string } | null;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const e = parsed.data;
  return {
    env: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    databaseUrl: e.DATABASE_URL,
    appOrigin: e.APP_ORIGIN.replace(/\/$/, ''),
    trustProxy: e.TRUST_PROXY,
    cookieSecure: e.COOKIE_SECURE ?? e.APP_ORIGIN.startsWith('https://'),
    sessionTtlDays: e.SESSION_TTL_DAYS,
    smtpUrl: e.SMTP_URL,
    mailFrom: e.MAIL_FROM,
    vapid:
      e.VAPID_PUBLIC_KEY && e.VAPID_PRIVATE_KEY
        ? { publicKey: e.VAPID_PUBLIC_KEY, privateKey: e.VAPID_PRIVATE_KEY, subject: e.VAPID_SUBJECT }
        : null,
    workerIntervalSeconds: e.WORKER_INTERVAL_SECONDS,
    inviteRateLimitPerHour: e.INVITE_RATE_LIMIT_PER_HOUR,
    authRateLimitPer15Min: e.AUTH_RATE_LIMIT_PER_15MIN,
    google:
      e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET
        ? { clientId: e.GOOGLE_CLIENT_ID, clientSecret: e.GOOGLE_CLIENT_SECRET }
        : null,
  };
}
