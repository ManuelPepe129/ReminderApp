import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup } from '@testing-library/react';
import type { ActionDto } from '@reminder/shared';
import i18n from '../i18n';
import { ActionCard } from './ActionCard';
import { ToastProvider } from './Toast';

afterEach(cleanup);

const base: ActionDto = {
  id: 'a1',
  listId: 'l1',
  title: 'Innaffiare le piante',
  notes: null,
  category: 'Casa',
  intervalValue: 1,
  intervalUnit: 'week',
  mode: 'fixed_schedule',
  timezone: 'Europe/Rome',
  anchorAt: '2025-06-07T07:00:00.000Z',
  dueAt: '2025-06-07T07:00:00.000Z',
  snoozedUntil: null,
  effectiveDueAt: '2025-06-07T07:00:00.000Z',
  status: 'active',
  leadMinutes: null,
  assignee: { id: 'u2', displayName: 'Bruno' },
  lastCompletedAt: null,
  lastCompletedBy: null,
  createdAt: '2025-06-01T00:00:00.000Z',
  updatedAt: '2025-06-01T00:00:00.000Z',
};

function renderCard(action: ActionDto, now: Date) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <MemoryRouter>
          <ul>
            <ActionCard action={action} now={now} />
          </ul>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('ActionCard', () => {
  it('shows an overdue badge and accessible quick actions', async () => {
    await i18n.changeLanguage('it');
    renderCard(base, new Date('2025-06-10T07:00:00Z'));
    const item = screen.getByRole('listitem', { name: 'Innaffiare le piante' });
    expect(item.className).toContain('is-overdue');
    expect(within(item).getByText('Scaduta da 3 giorni')).toBeTruthy();
    expect(within(item).getByText('Ogni settimana')).toBeTruthy();
    expect(within(item).getByText('Assegnata a Bruno')).toBeTruthy();
    expect(
      within(item).getByRole('button', { name: 'Segna “Innaffiare le piante” come fatta' }),
    ).toBeTruthy();
    expect(
      within(item).getByRole('button', { name: 'Rimanda' }).getAttribute('aria-haspopup'),
    ).toBe('menu');
  });

  it('does not offer quick actions for paused actions', async () => {
    renderCard({ ...base, status: 'paused' }, new Date('2025-06-10T07:00:00Z'));
    const item = screen.getByRole('listitem');
    expect(item.className).not.toContain('is-overdue');
    expect(within(item).queryByRole('button', { name: /fatta/ })).toBeNull();
    expect(within(item).getByText('In pausa')).toBeTruthy();
  });
});
