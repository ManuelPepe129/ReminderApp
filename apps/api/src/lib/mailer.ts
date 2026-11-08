import nodemailer from 'nodemailer';
import type { Locale } from '@reminder/shared';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export function createSmtpMailer(smtpUrl: string, from: string): Mailer {
  const transport = nodemailer.createTransport(smtpUrl);
  return {
    async send(message) {
      await transport.sendMail({ from, ...message });
    },
  };
}

/** Collects messages in memory (tests and local tooling). */
export class MemoryMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }
  last(): MailMessage | undefined {
    return this.sent.at(-1);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function layout(title: string, bodyHtml: string, cta?: { label: string; url: string }): string {
  const button = cta
    ? `<p style="margin:24px 0"><a href="${escapeHtml(cta.url)}" style="background:#1d4ed8;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">${escapeHtml(cta.label)}</a></p>
       <p style="font-size:12px;color:#555">${escapeHtml(cta.url)}</p>`
    : '';
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#111;max-width:560px;margin:auto;padding:24px">
<h1 style="font-size:20px">${escapeHtml(title)}</h1>${bodyHtml}${button}</body></html>`;
}

const STRINGS = {
  it: {
    magicSubject: 'Il tuo link di accesso',
    magicBody:
      'Usa questo link per accedere. Scade tra 15 minuti ed è utilizzabile una sola volta.',
    magicCta: 'Accedi',
    inviteSubject: (inviter: string, list: string) =>
      `${inviter} ti ha invitato nella lista "${list}"`,
    inviteBody: (inviter: string, list: string) =>
      `${inviter} ti ha invitato a condividere la lista "${list}". L'invito scade tra 7 giorni.`,
    inviteCta: 'Apri invito',
    dueSubject: (title: string) => `Scaduta: ${title}`,
    leadSubject: (title: string) => `In arrivo: ${title}`,
    dueBody: (title: string, when: string) => `L'azione "${title}" è in scadenza (${when}).`,
    openCta: "Apri l'app",
  },
  en: {
    magicSubject: 'Your sign-in link',
    magicBody: 'Use this link to sign in. It expires in 15 minutes and can be used once.',
    magicCta: 'Sign in',
    inviteSubject: (inviter: string, list: string) => `${inviter} invited you to "${list}"`,
    inviteBody: (inviter: string, list: string) =>
      `${inviter} invited you to share the list "${list}". The invitation expires in 7 days.`,
    inviteCta: 'Open invitation',
    dueSubject: (title: string) => `Due: ${title}`,
    leadSubject: (title: string) => `Coming up: ${title}`,
    dueBody: (title: string, when: string) => `"${title}" is due (${when}).`,
    openCta: 'Open the app',
  },
} as const;

export function strings(locale: string) {
  return STRINGS[(locale as Locale) in STRINGS ? (locale as Locale) : 'it'];
}

export function magicLinkEmail(to: string, url: string, locale: string): MailMessage {
  const s = strings(locale);
  return {
    to,
    subject: s.magicSubject,
    text: `${s.magicBody}\n\n${url}`,
    html: layout(s.magicSubject, `<p>${escapeHtml(s.magicBody)}</p>`, { label: s.magicCta, url }),
  };
}

export function invitationEmail(
  to: string,
  url: string,
  inviter: string,
  listName: string,
  locale: string,
): MailMessage {
  const s = strings(locale);
  return {
    to,
    subject: s.inviteSubject(inviter, listName),
    text: `${s.inviteBody(inviter, listName)}\n\n${url}`,
    html: layout(
      s.inviteSubject(inviter, listName),
      `<p>${escapeHtml(s.inviteBody(inviter, listName))}</p>`,
      {
        label: s.inviteCta,
        url,
      },
    ),
  };
}

export function dueEmail(
  to: string,
  kind: 'due' | 'lead',
  title: string,
  when: string,
  url: string,
  locale: string,
): MailMessage {
  const s = strings(locale);
  const subject = kind === 'due' ? s.dueSubject(title) : s.leadSubject(title);
  return {
    to,
    subject,
    text: `${s.dueBody(title, when)}\n\n${url}`,
    html: layout(subject, `<p>${escapeHtml(s.dueBody(title, when))}</p>`, {
      label: s.openCta,
      url,
    }),
  };
}
