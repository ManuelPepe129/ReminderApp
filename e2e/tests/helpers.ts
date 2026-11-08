import { expect, type Page } from '@playwright/test';

export function uniqueEmail(prefix: string): string {
  return `${prefix}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.com`;
}

export async function register(page: Page, name: string, next = '/') {
  const email = uniqueEmail(name.toLowerCase());
  await page.goto(`/registrati?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Nome').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Crea account' }).click();
  await expect(page).not.toHaveURL(/registrati/);
  return email;
}

/** Local "yyyy-MM-ddTHH:mm" (Europe/Rome, the context time zone) for a datetime-local input. */
export function localInput(date: Date): string {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
  return parts.replace(' ', 'T');
}

export async function createAction(
  page: Page,
  opts: { title: string; due: Date; every?: number; unit?: string; mode?: 'fixed' | 'completion' },
) {
  await page.getByRole('button', { name: 'Nuova azione' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Nuova azione' });
  await dialog.getByLabel('Titolo').fill(opts.title);
  await dialog.getByLabel('Prima scadenza').fill(localInput(opts.due));
  await dialog.getByLabel('Numero').fill(String(opts.every ?? 1));
  if (opts.unit) await dialog.getByLabel('Unità').selectOption(opts.unit);
  if (opts.mode === 'completion') await dialog.getByText('Dall’ultima esecuzione').click();
  await dialog.getByRole('button', { name: 'Crea' }).click();
  await expect(dialog).toBeHidden();
}
