import { and, eq, lt, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import type { AppDeps } from '../deps';
import { authTokens, notificationLog, pushSubscriptions, sessions } from '../db/schema';
import { dueEmail, strings } from '../lib/mailer';
import type { PushPayload } from './push';

export type WorkerDeps = Pick<AppDeps, 'db' | 'mailer' | 'push' | 'config' | 'now'>;

/** Notifications for occurrences older than this are not sent (e.g. after a long outage). */
const MAX_DUE_AGE_DAYS = 7;
const MAX_PUSH_FAILURES = 10;
const BATCH = 500;

/**
 * True when `now` falls in the user's quiet hours ("HH:MM"–"HH:MM" in their
 * time zone). Supports windows crossing midnight (e.g. 22:00–07:00).
 */
export function isQuietTime(now: Date, tz: string, start: string | null, end: string | null): boolean {
  if (!start || !end || start === end) return false;
  const local = DateTime.fromJSDate(now, { zone: tz });
  const minutes = local.hour * 60 + local.minute;
  const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const s = toMin(start);
  const e = toMin(end);
  return s < e ? minutes >= s && minutes < e : minutes >= s || minutes < e;
}

interface Candidate {
  actionId: string;
  title: string;
  listName: string;
  dueAt: Date;
  kind: 'due' | 'lead';
  userId: string;
  email: string;
  locale: string;
  timezone: string;
  pushEnabled: boolean;
  emailEnabled: boolean;
  quietStart: string | null;
  quietEnd: string | null;
}

/**
 * Finds occurrences that need a notification and are not yet in the log.
 * Recipients: the assignee if set, otherwise every member of the list.
 */
async function findCandidates(deps: WorkerDeps, now: Date): Promise<Candidate[]> {
  // ISO strings + explicit casts: portable across drivers (postgres.js, PGlite).
  const minDue = new Date(now.getTime() - MAX_DUE_AGE_DAYS * 86_400_000).toISOString();
  const nowIso = now.toISOString();
  const rows = await deps.db.execute(sql`
    with recipients as (
      select a.id as action_id, a.title, l.name as list_name, a.effective_due_at as due_at,
             coalesce(a.lead_minutes, u.default_lead_minutes) as lead,
             u.id as user_id, u.email, u.locale, u.timezone, u.push_enabled, u.email_enabled,
             u.quiet_start, u.quiet_end
      from actions a
      join lists l on l.id = a.list_id
      join list_members m on m.list_id = a.list_id
      join users u on u.id = m.user_id
      where a.status = 'active'
        and (a.assignee_id is null or a.assignee_id = u.id)
        and a.effective_due_at > ${minDue}::timestamptz
    )
    select r.*, k.kind from recipients r
    cross join lateral (
      select 'due'::text as kind where r.due_at <= ${nowIso}::timestamptz
      union all
      select 'lead'::text where r.lead > 0
        and r.due_at > ${nowIso}::timestamptz
        and r.due_at - make_interval(mins => r.lead) <= ${nowIso}::timestamptz
    ) k
    where not exists (
      select 1 from ${notificationLog} n
      where n.user_id = r.user_id and n.action_id = r.action_id
        and n.due_at = r.due_at and n.kind = k.kind
    )
    order by r.due_at
    limit ${BATCH}
  `);
  const list = (Array.isArray(rows) ? rows : (rows as { rows: unknown[] }).rows) as Record<string, unknown>[];
  return list.map((r) => ({
    actionId: String(r.action_id),
    title: String(r.title),
    listName: String(r.list_name),
    dueAt: new Date(r.due_at as string | Date),
    kind: r.kind as 'due' | 'lead',
    userId: String(r.user_id),
    email: String(r.email),
    locale: String(r.locale),
    timezone: String(r.timezone),
    pushEnabled: Boolean(r.push_enabled),
    emailEnabled: Boolean(r.email_enabled),
    quietStart: (r.quiet_start as string | null) ?? null,
    quietEnd: (r.quiet_end as string | null) ?? null,
  }));
}

function formatWhen(d: Date, tz: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'it-IT', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: tz,
  }).format(d);
}

export interface TickResult {
  candidates: number;
  deferred: number;
  sent: number;
  push: number;
  email: number;
}

/**
 * One scheduler pass. Safe to run concurrently on several workers: each
 * notification is "claimed" by inserting into notification_log, whose UNIQUE
 * (user, action, due_at, kind) constraint guarantees it is sent at most once.
 */
export async function runNotificationTick(deps: WorkerDeps): Promise<TickResult> {
  const now = deps.now();
  const result: TickResult = { candidates: 0, deferred: 0, sent: 0, push: 0, email: 0 };
  const candidates = await findCandidates(deps, now);
  result.candidates = candidates.length;

  for (const c of candidates) {
    if (isQuietTime(now, c.timezone, c.quietStart, c.quietEnd)) {
      result.deferred += 1; // picked up again by a later tick
      continue;
    }
    const claimed = await deps.db
      .insert(notificationLog)
      .values({ userId: c.userId, actionId: c.actionId, dueAt: c.dueAt, kind: c.kind })
      .onConflictDoNothing()
      .returning({ id: notificationLog.id });
    const logId = claimed[0]?.id;
    if (!logId) continue;

    const s = strings(c.locale);
    const when = formatWhen(c.dueAt, c.timezone, c.locale);
    const url = `/azioni/${c.actionId}`;
    const payload: PushPayload = {
      title: c.kind === 'due' ? s.dueSubject(c.title) : s.leadSubject(c.title),
      body: `${when} · ${c.listName}`,
      url,
      tag: `action-${c.actionId}`,
      actionId: c.actionId,
    };

    let pushStatus = 'skipped';
    let delivered = 0;
    if (c.pushEnabled && deps.push.enabled) {
      const subs = await deps.db
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, c.userId));
      for (const sub of subs) {
        const res = await deps.push.send(sub, payload);
        if (res === 'ok') {
          delivered += 1;
          await deps.db
            .update(pushSubscriptions)
            .set({ lastSuccessAt: now, failureCount: 0 })
            .where(eq(pushSubscriptions.id, sub.id));
        } else if (res === 'gone' || sub.failureCount + 1 >= MAX_PUSH_FAILURES) {
          await deps.db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
        } else {
          await deps.db
            .update(pushSubscriptions)
            .set({ failureCount: sub.failureCount + 1 })
            .where(eq(pushSubscriptions.id, sub.id));
        }
      }
      pushStatus = subs.length === 0 ? 'no_subscription' : delivered > 0 ? 'sent' : 'failed';
    }
    result.push += delivered;

    // E-mail is the fallback channel: used when no push reached the user.
    let emailStatus = 'skipped';
    if (c.emailEnabled && delivered === 0) {
      try {
        await deps.mailer.send(
          dueEmail(c.email, c.kind, c.title, when, `${deps.config.appOrigin}${url}`, c.locale),
        );
        emailStatus = 'sent';
        result.email += 1;
      } catch {
        emailStatus = 'failed';
      }
    }
    await deps.db
      .update(notificationLog)
      .set({ pushStatus, emailStatus })
      .where(eq(notificationLog.id, logId));
    if (delivered > 0 || emailStatus === 'sent') result.sent += 1;
  }
  return result;
}

/** Periodic housekeeping: expired sessions/tokens and old notification logs. */
export async function cleanup(deps: Pick<WorkerDeps, 'db' | 'now'>): Promise<void> {
  const now = deps.now();
  await deps.db.delete(sessions).where(lt(sessions.expiresAt, now));
  await deps.db
    .delete(authTokens)
    .where(lt(authTokens.expiresAt, new Date(now.getTime() - 86_400_000)));
  await deps.db
    .delete(notificationLog)
    .where(and(lt(notificationLog.createdAt, new Date(now.getTime() - 90 * 86_400_000))));
}
