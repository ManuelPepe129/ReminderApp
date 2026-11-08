import type { FastifyInstance } from 'fastify';
import {
  actionCreateSchema,
  actionQuerySchema,
  actionUpdateSchema,
  calendarQuerySchema,
  completeSchema,
  snoozeSchema,
  uuidSchema,
} from '@reminder/shared';
import { z } from 'zod';
import type { AppDeps } from '../deps';
import { requireUser } from '../auth/session';
import { parse } from '../lib/validate';
import {
  calendar,
  completeAction,
  createAction,
  deleteAction,
  getActionDto,
  listActions,
  listCategories,
  listEvents,
  snoozeAction,
  updateAction,
} from '../services/actions';
import { requireActionAccess } from '../services/access';

const idParams = z.object({ id: uuidSchema });

export async function actionRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const { db, realtime } = deps;
  const changed = (listId: string, actionId: string) =>
    realtime.publish({ listId, kind: 'actions', actionId });

  app.get('/api/actions', async (req) => {
    const user = requireUser(req);
    return listActions(db, user.id, parse(actionQuerySchema, req.query));
  });

  app.get('/api/categories', async (req) => listCategories(db, requireUser(req).id));

  app.get('/api/calendar', async (req) => {
    const user = requireUser(req);
    return calendar(db, user.id, parse(calendarQuerySchema, req.query), deps.now());
  });

  app.post('/api/actions', async (req, reply) => {
    const user = requireUser(req);
    const dto = await createAction(db, user.id, parse(actionCreateSchema, req.body), deps.now());
    await changed(dto.listId, dto.id);
    return reply.code(201).send(dto);
  });

  app.get('/api/actions/:id', async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    await requireActionAccess(db, id, user.id);
    return getActionDto(db, id);
  });

  app.patch('/api/actions/:id', async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const { dto, previousListId } = await updateAction(
      db,
      user.id,
      id,
      parse(actionUpdateSchema, req.body),
      deps.now(),
    );
    await changed(dto.listId, id);
    if (previousListId !== dto.listId) await changed(previousListId, id);
    return dto;
  });

  app.delete('/api/actions/:id', async (req, reply) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const listId = await deleteAction(db, user.id, id);
    await changed(listId, id);
    return reply.code(204).send();
  });

  app.post('/api/actions/:id/complete', async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const dto = await completeAction(db, user.id, id, parse(completeSchema, req.body), deps.now());
    await changed(dto.listId, id);
    return dto;
  });

  app.post('/api/actions/:id/snooze', async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const dto = await snoozeAction(db, user.id, id, parse(snoozeSchema, req.body), deps.now());
    await changed(dto.listId, id);
    return dto;
  });

  app.get('/api/actions/:id/events', async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    return listEvents(db, user.id, id);
  });
}
