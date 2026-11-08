import { expect, test } from '@playwright/test';
import { createAction, register } from './helpers';

test('opens offline with the last known data (production build)', async ({ page, context }) => {
  test.skip(!process.env.E2E_BASE_URL, 'requires the production build with the service worker');
  await register(page, 'Offline');
  await createAction(page, { title: 'Azione offline', due: new Date(Date.now() + 86_400_000) });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // now controlled by the SW: API responses get cached
  await expect(page.getByText('Azione offline')).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText(/Sei offline/)).toBeVisible();
  await expect(page.getByText('Azione offline')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nuova azione' })).toBeDisabled();
  await context.setOffline(false);
});
