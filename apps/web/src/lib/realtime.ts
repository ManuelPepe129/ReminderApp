import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { invalidateActions, keys } from '../api/hooks';

interface ChangeMessage {
  listId: string;
  kind: 'actions' | 'members' | 'list' | 'list_deleted';
  actionId?: string;
}

/**
 * Subscribes to the server's SSE stream and refreshes the affected queries.
 * EventSource reconnects automatically; queries also poll as a fallback.
 */
export function useRealtime(enabled: boolean): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;
    const es = new EventSource('/api/events/stream', { withCredentials: true });
    let opened = false;
    es.onmessage = (e: MessageEvent<string>) => {
      let msg: ChangeMessage;
      try {
        msg = JSON.parse(e.data) as ChangeMessage;
      } catch {
        return;
      }
      if (msg.kind === 'actions') {
        invalidateActions(qc, msg.actionId);
      } else {
        void qc.invalidateQueries({ queryKey: keys.lists });
        void qc.invalidateQueries({ queryKey: keys.members(msg.listId) });
        invalidateActions(qc);
      }
    };
    // After a reconnection we may have missed events: refresh everything.
    es.onopen = () => {
      if (opened) invalidateActions(qc);
      opened = true;
    };
    return () => es.close();
  }, [enabled, qc]);
}
