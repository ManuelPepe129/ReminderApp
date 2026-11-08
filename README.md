# Promemoria ricorrenti

PWA per tenere traccia di **azioni ricorrenti** (innaffiare le piante ogni settimana, cambiare le pile ogni 6 mesi, una scadenza annuale…), usabile da mobile e da PC, con liste condivise tra più persone, calendario e notifiche (Web Push con fallback email).

- **Home**: azioni scadute in evidenza (pannello rosso, dalla più in ritardo, "scaduta da 3 giorni"), poi le imminenti raggruppate (oggi, domani, prossimi 7 giorni, più avanti). Su ogni card: **Fatto** e **Rimanda** (tra 1 ora, domani alle 9, tra una settimana, data personalizzata). Filtri per lista, categoria e assegnatario.
- **Calendario** mese/settimana/giorno: le occorrenze future sono **proiettate dalla regola** (non salvate una per una) e distinte in scadute non confermate, previste e completate.
- **Liste condivise**: inviti via email (monouso) o link (riutilizzabile per 7 giorni), ruoli proprietario/editor, aggiornamenti in quasi tempo reale (SSE), storico con chi ha fatto cosa.
- **Notifiche**: alla scadenza e con preavviso configurabile, orari silenziosi, nessun duplicato.
- Interfaccia in italiano (inglese incluso, i18n tipizzato), tema chiaro/scuro, installabile, funzionamento offline di base.

---

## Stack e motivazioni

| Livello          | Scelta                                                                                                                                     | Perché                                                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client           | **React 19 + TypeScript + Vite 7**, React Router, TanStack Query, react-i18next, `vite-plugin-pwa` (service worker Workbox personalizzato) | PWA leggera e installabile; TanStack Query gestisce cache, aggiornamenti ottimistici e refetch; il service worker personalizzato gestisce push e cache offline |
| Backend          | **Fastify 5 + TypeScript + Drizzle ORM + PostgreSQL 17**                                                                                   | Le regole di autorizzazione restano codice TypeScript testabile; le migrazioni SQL sono versionate; un solo codebase per API e worker                          |
| Logica condivisa | `packages/shared` (Luxon + zod)                                                                                                            | Il motore di ricorrenza e la validazione sono **gli stessi** su server e client (aggiornamento ottimistico di "Fatto", prossime occorrenze)                    |
| Realtime         | SSE + Postgres `LISTEN/NOTIFY`                                                                                                             | Funziona dietro nginx, scala su più istanze API; polling come fallback                                                                                         |
| Notifiche        | Worker separato, `web-push` (VAPID), nodemailer                                                                                            | Deduplicazione garantita dal database (vincolo UNIQUE)                                                                                                         |
| Test             | Vitest (unit + integrazione su **PGlite**, cioè Postgres in WASM), Playwright (e2e)                                                        | I test di permessi e API girano su un Postgres vero senza Docker                                                                                               |

Ho scelto un backend proprio invece di Supabase per tre motivi: Supabase in locale richiede molti container; l'autorizzazione per lista (con test dedicati) è più semplice da verificare in codice che in policy RLS; il job delle notifiche condivide il codice dell'API.

## Struttura del repository

```
apps/
  api/            Fastify API + worker notifiche
    src/db/         schema Drizzle, client, migrazioni
    src/routes/     auth, lists, invitations, actions, me (preferenze, push), events (SSE)
    src/services/   autorizzazione (access.ts), logica azioni, utenti
    src/notifications/  scheduler (job), push
    drizzle/        migrazioni SQL generate
    test/           test di integrazione (PGlite)
  web/            PWA React
    src/pages/      Home, Calendario, Liste, Dettaglio azione, Impostazioni, Auth, Invito
    src/components/ ActionCard, SnoozeMenu, ActionEditor, Dialog, Toast, Filters…
    src/i18n/       it.ts (default), en.ts
    src/sw.ts       service worker (precache, cache API offline, push)
    docker/         configurazione nginx
packages/
  shared/         motore di ricorrenza, schemi zod, DTO
e2e/              test Playwright
docker-compose.yml
```

## Modello dati (sintesi)

- `users`: profilo, fuso orario, lingua, preferenze notifiche (canali, orari silenziosi, preavviso predefinito)
- `sessions`: hash SHA-256 del token di sessione (il token in chiaro vive solo nel cookie httpOnly)
- `auth_tokens`: magic link (hash, monouso, 15 minuti)
- `lists`, `list_members (role: owner | editor)`, `invitations` (hash del token, email opzionale, scadenza, revoca)
- `actions`: titolo, note, categoria, assegnatario, `interval_value` + `interval_unit` (`hour|day|week|month|year`), `mode` (`from_completion|fixed_schedule`), `timezone`, `anchor_at`, `due_at`, `snoozed_until`, `effective_due_at` (colonna generata = `coalesce(snoozed_until, due_at)`), `status` (`active|paused|archived`), `lead_minutes`
- `action_events`: storico (creata, fatta, rimandata, modificata, pausa…) con utente e scadenza di riferimento
- `push_subscriptions`, `notification_log` (UNIQUE su utente + azione + occorrenza + tipo, per non inviare duplicati)

## Regole di ricorrenza

Tutti gli istanti sono salvati in **UTC**. Ogni azione ha un **fuso IANA** (di default quello del profilo) in cui si fanno i calcoli di calendario:

- **ore**: tempo assoluto ("ogni 4 ore" = 4 ore reali, anche nella notte del cambio d'ora);
- **giorni, settimane, mesi, anni**: calendario locale ("ogni giorno alle 9:00" resta alle 9:00 anche dopo il cambio dell'ora legale; un orario che non esiste, ad esempio le 02:30 nel giorno del passaggio all'ora legale, viene spostato in avanti).

Le due modalità:

- **Dall'ultima esecuzione**: prossima scadenza = momento in cui l'azione è stata fatta + intervallo.
- **A calendario fisso**: le scadenze sono `ancora + n × intervallo`, calcolate **sempre dall'ancora** (mai a catena), così il fine mese non "deriva": il 31 gennaio diventa 28/29 febbraio, poi 31 marzo, poi 30 aprile. Un'azione annuale del 29 febbraio diventa 28 febbraio negli anni non bisestili e torna 29 febbraio nei bisestili. Quando la segni come fatta, la prossima scadenza è la prima occorrenza della griglia dopo `max(scadenza corrente, adesso)`: farla in anticipo copre solo l'occorrenza corrente, farla in ritardo salta quelle perse.
- **Rimanda**: imposta `snoozed_until` per l'occorrenza corrente senza cambiare la regola. La scadenza effettiva è `snoozed_until ?? due_at`.
- **Modifica della prossima scadenza** dal form: riposiziona ancora e scadenza (la griglia riparte da lì).
- Se due persone premono "Fatto" quasi insieme, un lock di riga e il controllo `expectedDueAt` impediscono di saltare due occorrenze: il secondo riceve un messaggio "già aggiornata da qualcun altro".

Tutti i casi limite sono coperti da test in `packages/shared/test/recurrence.test.ts`.

---

## Avvio locale (sviluppo)

Prerequisiti: **Node.js ≥ 20.11** (consigliato 22), **Docker** (per Postgres e Mailpit).

```bash
cp .env.example .env               # valori pronti per lo sviluppo
npm install
npm run infra:up                    # Postgres (porta 5433) + Mailpit
npm run vapid:generate -w @reminder/api   # opzionale: incolla le chiavi in .env per provare le push
npm run dev                         # API :3000, worker, web :5173
```

- App: <http://localhost:5173> (Vite fa da proxy verso `/api`). Le migrazioni vengono applicate all'avvio dell'API (`npm run db:migrate` per farlo a mano).
- Email (magic link, inviti, notifiche): <http://localhost:8025> (Mailpit).
- Postgres è esposto sulla **5433** per non entrare in conflitto con un'eventuale installazione locale sulla 5432.

### Stack completo con Docker (come in produzione)

```bash
docker compose up -d --build
```

App su <http://localhost:8080>: nginx serve la PWA compilata e fa da proxy verso l'API; il worker è un container separato. Compose legge `.env` per le variabili condivise (chiavi VAPID, rate limit). L'URL pubblico e l'SMTP visti dai container si impostano con `PUBLIC_ORIGIN` e `DOCKER_SMTP_URL` (default `http://localhost:8080` e Mailpit).

## Variabili d'ambiente

| Variabile                                                                                          | Default                                                | Descrizione                                                                |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------- |
| `DATABASE_URL`                                                                                     | `postgres://reminder:reminder@localhost:5433/reminder` | Connessione PostgreSQL                                                     |
| `APP_ORIGIN`                                                                                       | `http://localhost:5173`                                | URL pubblico della web app: link nelle email e **controllo Origin (CSRF)** |
| `PORT` / `HOST`                                                                                    | `3000` / `0.0.0.0`                                     | Ascolto dell'API                                                           |
| `TRUST_PROXY`                                                                                      | `false`                                                | `true` dietro reverse proxy (IP reale per il rate limit)                   |
| `COOKIE_SECURE`                                                                                    | auto (`true` se `APP_ORIGIN` è https)                  | Flag `Secure` sui cookie                                                   |
| `SESSION_TTL_DAYS`                                                                                 | `30`                                                   | Durata sessione (rinnovo automatico a metà)                                |
| `SMTP_URL`                                                                                         | `smtp://localhost:1025`                                | Server SMTP (es. `smtps://user:pass@smtp.example.com:465`)                 |
| `MAIL_FROM`                                                                                        | `Promemoria <noreply@localhost>`                       | Mittente                                                                   |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`                                                           | vuote                                                  | Chiavi Web Push; se mancano le push sono disattivate e si usa solo l'email |
| `VAPID_SUBJECT`                                                                                    | `mailto:admin@localhost`                               | Contatto VAPID (mailto: o URL)                                             |
| `WORKER_INTERVAL_SECONDS`                                                                          | `60`                                                   | Frequenza del job notifiche                                                |
| `AUTH_RATE_LIMIT_PER_15MIN`                                                                        | `20` (200 in `.env.example`)                           | Tentativi di login/registrazione/magic link per IP                         |
| `INVITE_RATE_LIMIT_PER_HOUR`                                                                       | `20`                                                   | Inviti creabili per utente all'ora                                         |
| `MIGRATE_ON_START`                                                                                 | `true`                                                 | Applica le migrazioni all'avvio dell'API                                   |
| `LOG_LEVEL`                                                                                        | `info`                                                 | Livello di log                                                             |
| Solo Compose: `PUBLIC_ORIGIN`, `DOCKER_SMTP_URL`, `POSTGRES_PASSWORD`, `POSTGRES_PORT`, `WEB_PORT` |                                                        | Vedi `docker-compose.yml`                                                  |

Nessun segreto è nel repository: `.env` è in `.gitignore`.

## Test e qualità

```bash
npm test              # unit + integrazione: shared (ricorrenza, schemi), api (auth, permessi, azioni, inviti, worker), web
npm run typecheck     # TypeScript strict in tutti i workspace (incluso il service worker)
npm run lint          # ESLint (+ react-hooks)
npm run format:check  # Prettier
npm run check         # tutto quanto sopra

# End-to-end (Playwright), richiede `npm run infra:up`:
npx playwright install chromium     # la prima volta
npm run test:e2e                    # avvia o riusa API :3000 e web :5173
E2E_BASE_URL=http://localhost:8080 npm run test:e2e   # contro lo stack Docker (include il test offline)
```

Cosa coprono i test:

- **Ricorrenza** (`packages/shared`): fine mese senza deriva, 29 febbraio, ora legale in entrambe le direzioni (Roma e New York), intervalli orari, griglia fissa con completamento in anticipo/ritardo, rimandi, proiezione, scorciatoie del "Rimanda".
- **Permessi** (`apps/api/test/permissions.test.ts`): un non membro riceve 404 su ogni lettura e scrittura (lista, membri, inviti, azioni, storico, calendario, filtri per `listId`), non può spostare azioni in liste altrui né essere assegnatario; un editor non può fare operazioni da proprietario; ultimo proprietario protetto; la rimozione di un membro toglie accesso e assegnazioni.
- **Auth**: CSRF (Origin + double submit), magic link monouso e con scadenza, nessuna enumerazione di account, rate limit, header di sicurezza.
- **Worker**: invio una sola volta anche con tick concorrenti, nuova notifica dopo completamento o rimando, preavviso, orari silenziosi, fallback email, solo assegnatario o tutti i membri, rimozione delle iscrizioni scadute.
- **E2E**: crea → scaduta → Fatto → riprogrammata; Rimanda; calendario; condivisione via link con aggiornamento in tempo reale e storico; isolamento tra utenti; offline (build di produzione). Ogni test gira in viewport mobile e desktop.

## Notifiche

- Il worker (`npm run dev:worker`, o il container `worker`) gira ogni `WORKER_INTERVAL_SECONDS` e trova:
  - **scadenza**: occorrenze con scadenza effettiva passata (fino a 7 giorni prima, per non inondare di notifiche dopo un fermo);
  - **preavviso**: `lead_minutes` dell'azione oppure il preavviso predefinito del profilo.
- Destinatari: l'assegnatario se presente, altrimenti tutti i membri della lista.
- **Nessun duplicato**: prima di inviare, il worker "prenota" la notifica con `INSERT … ON CONFLICT DO NOTHING` su `notification_log`. Più worker in parallelo sono sicuri.
- **Canali**: Web Push su tutti i dispositivi registrati; se nessuna push arriva (nessuna iscrizione, push disattivate o tutte fallite) e l'email è attiva, parte l'**email di fallback**.
- **Orari silenziosi** (nel fuso dell'utente, anche a cavallo della mezzanotte): la notifica viene rimandata, non persa.
- Attivazione push: _Impostazioni → Notifiche → Attiva su questo dispositivo_ (serve HTTPS o localhost; su iPhone/iPad l'app va prima aggiunta alla schermata Home, iOS ≥ 16.4).

## Sicurezza

- Autorizzazione centralizzata (`apps/api/src/services/access.ts`): ogni query su una lista passa dall'appartenenza dell'utente; i non membri ricevono 404 per non rivelare l'esistenza delle risorse.
- Sessioni: token casuale a 256 bit, salvato solo come hash; cookie `httpOnly`, `SameSite=Lax`, `Secure` in HTTPS; rotazione al login.
- CSRF: controllo dell'header `Origin` più token double-submit (`x-csrf-token`) su tutte le richieste che modificano dati.
- XSS: React fa l'escape dei contenuti; CSP restrittiva (`script-src 'self'`, nessuno script inline); email HTML con escape.
- Input validati con zod (lato server, condivisi con il client); limite di 64 KB sul body.
- Rate limit: globale, auth e inviti (per utente). Password con argon2id (parametri OWASP). Magic link e inviti salvati come hash, magic link monouso.
- Redirect post-login solo verso percorsi relativi dell'app.

## Deploy

Il percorso più semplice è una VM (o un qualsiasi host Docker) con Docker Compose dietro un reverse proxy HTTPS.

1. Clona il repository e crea `.env` con valori di produzione:
   ```env
   PUBLIC_ORIGIN=https://promemoria.example.com
   COOKIE_SECURE=true
   POSTGRES_PASSWORD=<password lunga e casuale>
   DOCKER_SMTP_URL=smtps://utente:password@smtp.example.com:465
   MAIL_FROM=Promemoria <noreply@example.com>
   VAPID_PUBLIC_KEY=...    # npm run vapid:generate -w @reminder/api
   VAPID_PRIVATE_KEY=...
   VAPID_SUBJECT=mailto:admin@example.com
   AUTH_RATE_LIMIT_PER_15MIN=20
   ```
2. In produzione non esporre Postgres e Mailpit: rimuovi le loro sezioni `ports` (oppure usa un file di override) e togli il servizio `mailpit` se usi un SMTP reale.
3. `docker compose up -d --build`.
4. Metti davanti un terminatore TLS che inoltra a `web:80` (porta `WEB_PORT`), ad esempio Caddy:
   ```
   promemoria.example.com {
     reverse_proxy localhost:8080
   }
   ```
   Se il proxy bufferizza le risposte, disattiva il buffering per `/api/events/stream` (SSE).
5. **Backup**: `docker compose exec db pg_dump -U reminder reminder > backup.sql` (pianificalo, ad esempio con cron).
6. **Aggiornamenti**: `git pull && docker compose up -d --build`. Le migrazioni vengono applicate all'avvio dell'API.

In alternativa, l'API (`node dist/server.js`), il worker (`node dist/worker.js`) e la PWA statica (`apps/web/dist`) girano su qualsiasi piattaforma Node e hosting statico, con un Postgres gestito. Requisiti: web e `/api` sullo **stesso dominio** (i cookie sono same-origin), `APP_ORIGIN` uguale all'URL pubblico, `TRUST_PROXY=true`. Si possono avviare più istanze API (il realtime passa da Postgres) e più worker.

## Localizzazione

I testi stanno in `apps/web/src/i18n/it.ts`; `en.ts` è tipizzato sulle stesse chiavi, quindi il compilatore segnala le traduzioni mancanti. Per aggiungere una lingua:

1. crea `xx.ts` con il tipo `DeepString<Messages>`;
2. registrala in `i18n/index.ts` e in `LOCALES` (`packages/shared/src/schemas`);
3. aggiungi le stringhe server (email, push) in `apps/api/src/lib/mailer.ts`.

Date e orari usano `Intl` con il fuso del profilo.

## Limiti noti e possibili evoluzioni

- **Login Google**: non implementato. Lo schema ha già `users.google_sub` e la configurazione prevede `GOOGLE_CLIENT_ID/SECRET`, ma il flusso OAuth è da scrivere.
- Offline: consultazione dei dati già caricati; le modifiche richiedono connessione (non c'è una coda di sincronizzazione).
- Nessun "annulla" dopo "Fatto": si può correggere modificando la prossima scadenza.
- `npm audit` segnala vulnerabilità solo in dipendenze di sviluppo (vitest, drizzle-kit/esbuild, workbox-build); `npm audit --omit=dev` non ne riporta.
