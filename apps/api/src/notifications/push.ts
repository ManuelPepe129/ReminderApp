import { WebPushError, sendNotification } from 'web-push';

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushPayload {
  title: string;
  body: string;
  /** App-relative URL opened when the notification is clicked. */
  url: string;
  tag?: string;
  actionId?: string;
}

/** `gone` means the subscription is expired/unsubscribed and must be deleted. */
export type PushResult = 'ok' | 'gone' | 'error';

export interface PushSender {
  readonly enabled: boolean;
  readonly publicKey: string | null;
  send(target: PushTarget, payload: PushPayload): Promise<PushResult>;
}

export function createWebPushSender(
  vapid: { publicKey: string; privateKey: string; subject: string } | null,
): PushSender {
  return {
    enabled: vapid !== null,
    publicKey: vapid?.publicKey ?? null,
    async send(target, payload) {
      if (!vapid) return 'error';
      try {
        await sendNotification(
          { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
          JSON.stringify(payload),
          {
            TTL: 60 * 60 * 24,
            urgency: 'high',
            vapidDetails: {
              subject: vapid.subject,
              publicKey: vapid.publicKey,
              privateKey: vapid.privateKey,
            },
          },
        );
        return 'ok';
      } catch (err) {
        if (err instanceof WebPushError && (err.statusCode === 404 || err.statusCode === 410)) {
          return 'gone';
        }
        return 'error';
      }
    },
  };
}

export class MemoryPushSender implements PushSender {
  readonly enabled = true;
  readonly publicKey = 'test-public-key';
  readonly sent: { target: PushTarget; payload: PushPayload }[] = [];
  /** Endpoints that should report `gone`. */
  readonly goneEndpoints = new Set<string>();
  async send(target: PushTarget, payload: PushPayload): Promise<PushResult> {
    if (this.goneEndpoints.has(target.endpoint)) return 'gone';
    this.sent.push({ target, payload });
    return 'ok';
  }
}
