import { expect, test } from '@playwright/test';
import { createAction, register } from './helpers';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

test('create → overdue → done → rescheduled', async ({ page }) => {
  await register(page, 'Flusso');
  await expect(page.getByText('Non hai ancora azioni')).toBeVisible();

  // Fixed weekly schedule whose first due date was 2 days ago: it is immediately overdue.
  await createAction(page, { title: 'Innaffiare le piante', due: new Date(Date.now() - 2 * DAY) });

  const overdue = page.getByRole('region', { name: /Scadute/ });
  await expect(overdue).toBeVisible();
  const card = overdue.getByRole('listitem').filter({ hasText: 'Innaffiare le piante' });
  await expect(card.getByText('Scaduta da 2 giorni')).toBeVisible();

  await card.getByRole('button', { name: /Segna “Innaffiare le piante” come fatta/ }).click();
  await expect(page.getByText(/“Innaffiare le piante” fatta\. Prossima:/)).toBeVisible();

  // No longer overdue: rescheduled on the weekly grid (5 days from now).
  await expect(page.getByRole('region', { name: /Scadute/ })).toHaveCount(0);
  await expect(page.getByText('Nessuna azione scaduta')).toBeVisible();
  const upcoming = page.getByRole('region', { name: 'In arrivo' });
  await expect(
    upcoming.getByRole('listitem').filter({ hasText: 'Innaffiare le piante' }),
  ).toContainText('Tra 4 giorni');

  // History records who did it.
  await upcoming.getByRole('link', { name: 'Innaffiare le piante' }).click();
  await expect(page.getByRole('heading', { name: 'Innaffiare le piante' })).toBeVisible();
  await expect(page.getByText('Fatta da Flusso')).toBeVisible();
  await expect(page.getByText('Creata da Flusso')).toBeVisible();
});

test('snooze with a shortcut keeps the rule', async ({ page }) => {
  await register(page, 'Rimanda');
  await createAction(page, {
    title: 'Cambiare le pile',
    due: new Date(Date.now() - 3 * HOUR),
    every: 6,
    unit: 'month',
    mode: 'completion',
  });
  const overdue = page.getByRole('region', { name: /Scadute/ });
  const card = overdue.getByRole('listitem').filter({ hasText: 'Cambiare le pile' });
  await card.getByRole('button', { name: 'Rimanda' }).click();
  await page.getByRole('menuitem', { name: 'Domani alle 9:00' }).click();

  await expect(page.getByText(/rimandata a domani, 09:00/)).toBeVisible();
  const upcoming = page.getByRole('region', { name: 'In arrivo' });
  const moved = upcoming.getByRole('listitem').filter({ hasText: 'Cambiare le pile' });
  await expect(moved).toContainText('Ogni 6 mesi');
  await expect(moved).toContainText('Rimandata a domani, 09:00');
});

test('calendar shows completed and projected occurrences', async ({ page }) => {
  await register(page, 'Calendario');
  await createAction(page, {
    title: 'Pulizie',
    due: new Date(Date.now() - HOUR),
    every: 1,
    unit: 'day',
  });
  await page.getByRole('button', { name: /Segna “Pulizie” come fatta/ }).click();
  await expect(page.getByText('Nessuna azione scaduta')).toBeVisible();

  await page.getByRole('link', { name: 'Calendario' }).click();
  await expect(page.getByRole('button', { name: 'Mese' })).toHaveAttribute('aria-pressed', 'true');
  // Today's panel lists the completed occurrence.
  const dayPanel = page.locator('section').filter({ has: page.locator('#day-title') });
  await expect(dayPanel.getByText(/fatta da Calendario/)).toBeVisible();

  await page.getByRole('button', { name: 'Settimana' }).click();
  // Next week: a daily action is projected on all 7 days.
  await page.getByRole('button', { name: 'Successivo' }).click();
  await expect(page.getByRole('link', { name: 'Pulizie' })).toHaveCount(7);
});
