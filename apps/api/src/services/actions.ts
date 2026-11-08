import { and, asc, desc, eq, gte, inArray, isNull, lt, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  computeNextDue,
  effectiveDue,
  projectOccurrences,
  type ActionCreateInput,
  type ActionDto,
  type ActionEventDto,
  type ActionEventType,
  type ActionUpdateInput,
  type CalendarOccurrenceDto,
  type CompleteInput,
  type ScheduleState,
  type SnoozeInput,
} from '@reminder/shared';
import type { Db } from '../db';
import { actionEvents, actions, listMembers, users, type ActionRow } from '../db/schema';
import { badRequest, conflict, notFound } from '../lib/errors';
import { getRole, requireActionAccess, requireListRole } from './access';

const assignee = alias(users, 'assignee');
const completer = alias(users, 'completer');

const CLOCK_SKEW_MS = 5 * 60_000;
const MAX_SNOOZE_MS = 5 * 365 * 86_400_000;

export interface ActionFilters {
  listId?: string | undefined;
  category?: string | undefined;
  /** user id, 'me' or 'none' */
  assigneeId?: string | undefined;
  status?: ActionRow['status'] | undefined;
}

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

function toDto(row: {
  action: ActionRow;
  assigneeName: string | null;
  completerName: string | null;
}): ActionDto {
  const a = row.action;
  return {
    id: a.id,
    listId: a.listId,
    title: a.title,
    notes: a.notes,
    category: a.category,
    intervalValue: a.intervalValue,
    intervalUnit: a.intervalUnit,
    mode: a.mode,
    timezone: a.timezone,
    anchorAt: a.anchorAt.toISOString(),
    dueAt: a.dueAt.toISOString(),
    snoozedUntil: iso(a.snoozedUntil),
    effectiveDueAt: effectiveDue(a).toISOString(),
    status: a.status,
    leadMinutes: a.leadMinutes,
    assignee: a.assigneeId ? { id: a.assigneeId, displayName: row.assigneeName ?? '' } : null,
    lastCompletedAt: iso(a.lastCompletedAt),
    lastCompletedBy: a.lastCompletedBy
      ? { id: a.lastCompletedBy, displayName: row.completerName ?? '' }
      : null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

export function toScheduleState(a: ActionRow): ScheduleState {
  return {
    rule: {
      interval: { value: a.intervalValue, unit: a.intervalUnit },
      mode: a.mode,
      anchor: a.anchorAt,
      timezone: a.timezone,
    },
    dueAt: a.dueAt,
    snoozedUntil: a.snoozedUntil,
  };
}

function baseSelect(db: Db) {
  return db
    .select({
      action: actions,
      assigneeName: assignee.displayName,
      completerName: completer.displayName,
    })
    .from(actions)
    .leftJoin(assignee, eq(assignee.id, actions.assigneeId))
    .leftJoin(completer, eq(completer.id, actions.lastCompletedBy));
}

export async function getActionDto(db: Db, id: string): Promise<ActionDto> {
  const rows = await baseSelect(db).where(eq(actions.id, id));
  const row = rows[0];
  if (!row) throw notFound('action_not_found');
  return toDto(row);
}

function filterConditions(userId: string, f: ActionFilters): SQL[] {
  const conds: SQL[] = [
    // Authorization: only lists the user is a member of.
    inArray(
      actions.listId,
      sql`(select ${listMembers.listId} from ${listMembers} where ${listMembers.userId} = ${userId})`,
    ),
  ];
  if (f.listId) conds.push(eq(actions.listId, f.listId));
  if (f.category) conds.push(eq(actions.category, f.category));
  if (f.assigneeId === 'none') conds.push(isNull(actions.assigneeId));
  else if (f.assigneeId === 'me') conds.push(eq(actions.assigneeId, userId));
  else if (f.assigneeId) conds.push(eq(actions.assigneeId, f.assigneeId));
  return conds;
}

export async function listActions(db: Db, userId: string, f: ActionFilters): Promise<ActionDto[]> {
  const conds = filterConditions(userId, f);
  conds.push(
    f.status ? eq(actions.status, f.status) : inArray(actions.status, ['active', 'paused']),
  );
  const rows = await baseSelect(db)
    .where(and(...conds))
    .orderBy(asc(actions.effectiveDueAt), asc(actions.title));
  return rows.map(toDto);
}

export async function listCategories(db: Db, userId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ category: actions.category })
    .from(actions)
    .where(and(...filterConditions(userId, {}), sql`${actions.category} is not null`))
    .orderBy(asc(actions.category));
  return rows.map((r) => r.category).filter((c): c is string => !!c);
}

async function assertAssignee(db: Db, listId: string, assigneeId: string | null | undefined) {
  if (!assigneeId) return;
  if (!(await getRole(db, listId, assigneeId))) throw badRequest('assignee_not_member');
}

async function logEvent(
  db: Db,
  a: Pick<ActionRow, 'id' | 'listId'>,
  type: ActionEventType,
  userId: string,
  extra: {
    occurredAt?: Date;
    dueAt?: Date | null;
    newDueAt?: Date | null;
    note?: string | null;
  } = {},
) {
  await db.insert(actionEvents).values({
    actionId: a.id,
    listId: a.listId,
    type,
    userId,
    occurredAt: extra.occurredAt ?? new Date(),
    dueAt: extra.dueAt ?? null,
    newDueAt: extra.newDueAt ?? null,
    note: extra.note ?? null,
  });
}

export async function createAction(
  db: Db,
  userId: string,
  input: ActionCreateInput,
  now: Date,
): Promise<ActionDto> {
  await requireListRole(db, input.listId, userId);
  await assertAssignee(db, input.listId, input.assigneeId);
  const id = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(actions)
      .values({
        listId: input.listId,
        title: input.title,
        notes: input.notes || null,
        category: input.category || null,
        intervalValue: input.intervalValue,
        intervalUnit: input.intervalUnit,
        mode: input.mode,
        timezone: input.timezone,
        anchorAt: input.firstDueAt,
        dueAt: input.firstDueAt,
        leadMinutes: input.leadMinutes ?? null,
        assigneeId: input.assigneeId ?? null,
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!row) throw new Error('insert failed');
    await logEvent(tx, row, 'created', userId, { occurredAt: now, newDueAt: row.dueAt });
    return row.id;
  });
  return getActionDto(db, id);
}

export async function updateAction(
  db: Db,
  userId: string,
  id: string,
  input: ActionUpdateInput,
  now: Date,
): Promise<{ dto: ActionDto; previousListId: string }> {
  const { action } = await requireActionAccess(db, id, userId);
  const targetList = input.listId ?? action.listId;
  if (input.listId && input.listId !== action.listId) {
    await requireListRole(db, input.listId, userId);
  }
  const assigneeId = input.assigneeId !== undefined ? input.assigneeId : action.assigneeId;
  if (input.assigneeId !== undefined || input.listId) {
    try {
      await assertAssignee(db, targetList, assigneeId);
    } catch (err) {
      // Moving to another list where the assignee is not a member: drop the assignment.
      if (input.assigneeId !== undefined) throw err;
      input = { ...input, assigneeId: null };
    }
  }

  const patch: Partial<typeof actions.$inferInsert> = { updatedAt: now };
  for (const key of [
    'listId',
    'title',
    'intervalValue',
    'intervalUnit',
    'mode',
    'timezone',
    'status',
  ] as const) {
    if (input[key] !== undefined) (patch as Record<string, unknown>)[key] = input[key];
  }
  if (input.notes !== undefined) patch.notes = input.notes || null;
  if (input.category !== undefined) patch.category = input.category || null;
  if (input.assigneeId !== undefined) patch.assigneeId = input.assigneeId;
  if (input.leadMinutes !== undefined) patch.leadMinutes = input.leadMinutes;
  if (input.nextDueAt) {
    patch.anchorAt = input.nextDueAt;
    patch.dueAt = input.nextDueAt;
    patch.snoozedUntil = null;
  }

  let eventType: ActionEventType = 'updated';
  if (input.status && input.status !== action.status) {
    eventType =
      input.status === 'paused' ? 'paused' : input.status === 'archived' ? 'archived' : 'resumed';
  }
  await db.transaction(async (tx) => {
    await tx.update(actions).set(patch).where(eq(actions.id, id));
    await logEvent(tx, { id, listId: targetList }, eventType, userId, {
      occurredAt: now,
      newDueAt: input.nextDueAt ?? null,
    });
  });
  return { dto: await getActionDto(db, id), previousListId: action.listId };
}

export async function deleteAction(db: Db, userId: string, id: string): Promise<string> {
  const { action } = await requireActionAccess(db, id, userId);
  await db.delete(actions).where(eq(actions.id, id));
  return action.listId;
}

export async function completeAction(
  db: Db,
  userId: string,
  id: string,
  input: CompleteInput,
  now: Date,
): Promise<ActionDto> {
  const completedAt = input.completedAt ?? now;
  if (completedAt.getTime() > now.getTime() + CLOCK_SKEW_MS) {
    throw badRequest('completed_in_future');
  }
  await requireActionAccess(db, id, userId);
  await db.transaction(async (tx) => {
    // Row lock: two members pressing "Done" at the same time must not skip two occurrences.
    const [a] = await tx.select().from(actions).where(eq(actions.id, id)).for('update');
    if (!a) throw notFound('action_not_found');
    if (a.status !== 'active') throw conflict('action_not_active');
    const current = effectiveDue(a);
    if (input.expectedDueAt && input.expectedDueAt.getTime() !== current.getTime()) {
      throw conflict('stale_occurrence', { effectiveDueAt: current.toISOString() });
    }
    const next = computeNextDue(toScheduleState(a), completedAt);
    await tx
      .update(actions)
      .set({
        dueAt: next,
        snoozedUntil: null,
        lastCompletedAt: completedAt,
        lastCompletedBy: userId,
        updatedAt: now,
      })
      .where(eq(actions.id, id));
    await logEvent(tx, a, 'completed', userId, {
      occurredAt: completedAt,
      dueAt: current,
      newDueAt: next,
      note: input.note ?? null,
    });
  });
  return getActionDto(db, id);
}

export async function snoozeAction(
  db: Db,
  userId: string,
  id: string,
  input: SnoozeInput,
  now: Date,
): Promise<ActionDto> {
  if (input.until.getTime() <= now.getTime()) throw badRequest('snooze_in_past');
  if (input.until.getTime() > now.getTime() + MAX_SNOOZE_MS) throw badRequest('snooze_too_far');
  await requireActionAccess(db, id, userId);
  await db.transaction(async (tx) => {
    const [a] = await tx.select().from(actions).where(eq(actions.id, id)).for('update');
    if (!a) throw notFound('action_not_found');
    if (a.status !== 'active') throw conflict('action_not_active');
    await tx
      .update(actions)
      .set({ snoozedUntil: input.until, updatedAt: now })
      .where(eq(actions.id, id));
    await logEvent(tx, a, 'snoozed', userId, {
      occurredAt: now,
      dueAt: effectiveDue(a),
      newDueAt: input.until,
    });
  });
  return getActionDto(db, id);
}

export async function listEvents(
  db: Db,
  userId: string,
  actionId: string,
  limit = 100,
): Promise<ActionEventDto[]> {
  await requireActionAccess(db, actionId, userId);
  const rows = await db
    .select({ ev: actionEvents, name: users.displayName })
    .from(actionEvents)
    .leftJoin(users, eq(users.id, actionEvents.userId))
    .where(eq(actionEvents.actionId, actionId))
    .orderBy(desc(actionEvents.occurredAt), desc(actionEvents.seq))
    .limit(limit);
  return rows.map(({ ev, name }) => ({
    id: ev.id,
    actionId: ev.actionId,
    type: ev.type,
    user: ev.userId ? { id: ev.userId, displayName: name ?? '' } : null,
    occurredAt: ev.occurredAt.toISOString(),
    dueAt: iso(ev.dueAt),
    newDueAt: iso(ev.newDueAt),
    note: ev.note,
  }));
}

/**
 * Calendar occurrences in [from, to): completed occurrences come from the
 * history; pending/future ones are projected from the recurrence rule (never
 * stored one by one).
 */
export async function calendar(
  db: Db,
  userId: string,
  q: ActionFilters & { from: Date; to: Date },
  now: Date,
): Promise<CalendarOccurrenceDto[]> {
  const conds = filterConditions(userId, q);
  const active = await db
    .select()
    .from(actions)
    .where(and(...conds, eq(actions.status, 'active')));

  const out: CalendarOccurrenceDto[] = [];
  for (const a of active) {
    for (const occ of projectOccurrences(toScheduleState(a), q.from, q.to, now, 500)) {
      out.push({
        actionId: a.id,
        listId: a.listId,
        title: a.title,
        category: a.category,
        at: occ.at.toISOString(),
        status: occ.current && occ.at.getTime() < now.getTime() ? 'overdue' : 'planned',
        current: occ.current,
        completedBy: null,
      });
    }
  }

  const done = await db
    .select({
      ev: actionEvents,
      title: actions.title,
      category: actions.category,
      userName: users.displayName,
    })
    .from(actionEvents)
    .innerJoin(actions, eq(actions.id, actionEvents.actionId))
    .leftJoin(users, eq(users.id, actionEvents.userId))
    .where(
      and(
        ...conds,
        eq(actionEvents.type, 'completed'),
        gte(actionEvents.occurredAt, q.from),
        lt(actionEvents.occurredAt, q.to),
      ),
    );
  for (const d of done) {
    out.push({
      actionId: d.ev.actionId,
      listId: d.ev.listId,
      title: d.title,
      category: d.category,
      at: d.ev.occurredAt.toISOString(),
      status: 'completed',
      current: false,
      completedBy: d.ev.userId ? { id: d.ev.userId, displayName: d.userName ?? '' } : null,
    });
  }
  out.sort((x, y) => x.at.localeCompare(y.at) || x.title.localeCompare(y.title));
  return out;
}
