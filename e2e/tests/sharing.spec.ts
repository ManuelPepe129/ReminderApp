import { expect, test } from '@playwright/test';
import { createAction, register } from './helpers';

test('share a list with a link; the member completes; the owner sees it live', async ({
  browser,
}) => {
  const ownerCtx = await browser.newContext();
  const memberCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  const member = await memberCtx.newPage();

  await register(owner, 'Proprietaria');
  await createAction(owner, {
    title: 'Portare fuori il vetro',
    due: new Date(Date.now() - 60 * 60_000),
  });

  // Owner creates a shareable invitation link.
  await owner.getByRole('link', { name: 'Liste' }).click();
  await owner.getByRole('link', { name: /Personale/ }).click();
  await owner.getByRole('button', { name: 'Crea link condivisibile' }).click();
  const link = await owner.getByRole('textbox', { name: 'Link di invito' }).inputValue();
  expect(link).toContain('/inviti/');
  await owner.goto('/');
  await expect(owner.getByRole('region', { name: /Scadute/ })).toContainText(
    'Portare fuori il vetro',
  );

  // Member opens the link, signs up and joins.
  await member.goto(new URL(link).pathname);
  await expect(
    member.getByText(/Proprietaria ti ha invitato nella lista “Personale”/),
  ).toBeVisible();
  await member.getByRole('link', { name: 'Crea account' }).click();
  await register(member, 'Membro', new URL(link).pathname);
  await member.getByRole('button', { name: 'Unisciti alla lista' }).click();
  await expect(member.getByRole('heading', { name: 'Personale' }).first()).toBeVisible();
  await expect(member.getByText('Proprietaria', { exact: false }).first()).toBeVisible();

  // Member completes the shared action.
  await member.goto('/');
  const card = member
    .getByRole('region', { name: /Scadute/ })
    .getByRole('listitem')
    .filter({ hasText: 'Portare fuori il vetro' });
  await card.getByRole('button', { name: /come fatta/ }).click();
  await expect(member.getByText('Nessuna azione scaduta')).toBeVisible();

  // Owner's open page updates in near real time (SSE, with polling fallback).
  await expect(owner.getByText('Nessuna azione scaduta')).toBeVisible({ timeout: 20_000 });
  await owner.getByRole('link', { name: 'Portare fuori il vetro' }).click();
  await expect(owner.getByText('Fatta da Membro')).toBeVisible();

  await ownerCtx.close();
  await memberCtx.close();
});

test('a user cannot open another user’s action', async ({ browser }) => {
  const aCtx = await browser.newContext();
  const bCtx = await browser.newContext();
  const a = await aCtx.newPage();
  const b = await bCtx.newPage();
  await register(a, 'Alfa');
  await createAction(a, { title: 'Privata', due: new Date(Date.now() + 86_400_000) });
  await a.getByRole('link', { name: 'Privata' }).click();
  const url = a.url();

  await register(b, 'Beta');
  await b.goto(new URL(url).pathname);
  await expect(b.getByText('Azione non trovata o non accessibile.')).toBeVisible();
  await aCtx.close();
  await bCtx.close();
});
