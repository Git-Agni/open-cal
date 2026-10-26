# open-cal

Booking pages that run on your own Google Calendar. One Next.js app, one Supabase database, one Google service account. No per-seat pricing.

I built this to replace Calendly for my team. Calendly charges per seat for something that is, underneath, one call to Google's free/busy API plus an event insert. So this does exactly that and nothing else.

![Booking page](docs/screenshots/booking.png)
<!-- screenshot placeholder: the month grid + times on a host's event page -->

## What you get

- **Booking pages.** `yourdomain.com/<person>` lists their event types, `yourdomain.com/<person>/<event>` is the picker. Guests see times in their own time zone (detected, changeable, 12h or 24h).
- **Real availability.** Slots come from live Google free/busy across every calendar you tick, including calendars from other accounts shared with "See only free/busy". Nothing about your calendar is stored or shown to guests, only open start times.
- **Google does the invites.** The booking is created on the host's calendar with the host as organizer and a Google Meet link. Google sends the invite, the reminders, the update when a time moves and the cancellation. There is no guest email code in this repo.
- **Reschedule and cancel links.** Every invite carries a private link (`/b/<token>`) where the guest moves or cancels the meeting. Moving re-checks free/busy and patches the same Google event.
- **A form like Calendly's.** Name, email, "Add guests" (up to 10), plus your own questions (short text, long text, link, phone, pick one). Answers go into the invite, the admin and the optional host email.
- **Rules per event type.** Length, start-time grid, minimum notice, how far ahead, buffers before and after, max bookings per day, extra attendees on every call.
- **Weekly hours and date overrides** in the host's time zone. DST is handled with `Intl` only, no date library. The slot engine is pure functions with unit tests (`src/lib/core.ts`).
- **Race-safe.** A partial unique index means two guests can never book the same start. The loser gets "that time was just taken".
- **Basic abuse guards.** A honeypot field, and a limit of 5 bookings per network per hour (IPs are stored as a keyed hash, never raw).
- **Admin page** at `/admin` behind one password. Manage pages, event types, hours, calendars and bookings for everyone on the deploy.
- **Optional host email.** A short note to the host with the guest's answers, sent from the host's own Gmail through the API.

![Admin](docs/screenshots/admin.png)
<!-- screenshot placeholder: the admin Event types tab -->

## What it is not

It needs **Google Workspace** (any paid plan). Acting as each host on their own calendar uses domain-wide delegation, which personal Gmail accounts do not have. A personal Gmail calendar still works as a busy calendar if you share it with a Workspace host.

No payments, no round-robin, no team pooling, no Zoom, no embeds, no SMS. Fork it and add what you need.

## How it works

```
guest -> /<host>/<event>               month grid + times (client)
      -> GET  /api/public/slots         weekly hours - Google free/busy - buffers = open starts
      -> POST /api/public/book          re-check the slot live, insert the row (unique index),
                                        create the Google event as the host with Meet,
                                        delete the row again if Google fails
      -> /b/<token>                     reschedule (PATCH the event) or cancel (DELETE it)
```

One service account, many hosts. Each Google call is made as the host (`subject` = their email), so free/busy sees exactly what that person sees and the event is theirs.

## Setup

You need about 20 minutes, a Google Workspace super admin, a Supabase account and a Vercel account.

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Open the SQL editor, paste [`supabase/schema.sql`](supabase/schema.sql) and run it. It creates `cal_hosts`, `cal_event_types` and `cal_bookings` with row level security on and no policies, so only the service-role key can read them.
3. From Project settings > API, copy the project URL (`SUPABASE_URL`) and the `service_role` key (`SUPABASE_SERVICE_ROLE_KEY`). Keep that key server-side only.

### 2. Google Cloud project

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create a project (or pick one).
2. APIs & Services > Library: enable the **Google Calendar API**. If you want host emails, enable the **Gmail API** too.
3. IAM & Admin > Service accounts > Create service account. Give it a name, skip the roles.
4. Open the service account > Keys > Add key > JSON. Download it. From the file:
   - `client_email` goes in `GOOGLE_SA_CLIENT_EMAIL`
   - `private_key` goes in `GOOGLE_SA_PRIVATE_KEY` (paste it as is; the app accepts literal `\n` and surrounding quotes)
5. On the service account's Details tab, copy the **Unique ID** (a long number, the OAuth client ID). You need it next.

If your organization blocks key creation (`iam.disableServiceAccountKeyCreation`), a Workspace admin has to allow it for this project first.

### 3. Workspace domain-wide delegation

1. Sign in to [admin.google.com](https://admin.google.com) as a super admin.
2. Security > Access and data control > API controls > Manage domain-wide delegation > Add new.
3. Client ID: the Unique ID from step 2.5. OAuth scopes:
   ```
   https://www.googleapis.com/auth/calendar
   ```
   Add `https://www.googleapis.com/auth/gmail.send` too (comma separated) only if you turn on host emails.
4. Save. It can take a few minutes, sometimes up to an hour, before Google honours it. Until then the admin shows "Google Calendar is not authorized for the service account yet".

The `calendar` scope lets the service account act on the calendar of any user in your Workspace. That is how this works, and it is also why the key is sensitive: treat `GOOGLE_SA_PRIVATE_KEY` like a password.

### 4. Deploy on Vercel

1. Fork or push this repo to your GitHub, then import it at [vercel.com/new](https://vercel.com/new). The framework preset is Next.js; no build settings to change.
2. Add the environment variables below, then deploy.
3. Open `https://<your-deploy>/admin`, sign in with `ADMIN_PASSWORD`, and create the first page: the host's Workspace email, their name, a link slug and their time zone.
4. Calendars tab: tick every calendar that should block time. Event types tab: add one (say a 30-minute intro call). Open the link and book yourself to test.

### 5. Custom domain

1. Vercel project > Settings > Domains > add `cal.yourdomain.com`.
2. At your DNS provider, add the record Vercel shows (usually `CNAME cal -> cname.vercel-dns.com`).
3. Set `NEXT_PUBLIC_SITE_URL=https://cal.yourdomain.com` and redeploy, so manage links and admin links use it.

The app owns the whole domain: `/<host>` and `/<host>/<event>` are public, `/b/<token>` is the guest's manage page, `/admin` is yours. Set `DEFAULT_HOST` to send the bare domain to one person's page.

## Environment variables

| Name | Required | What it is |
| --- | --- | --- |
| `SUPABASE_URL` | yes | Your Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | The `service_role` key. Server only. |
| `GOOGLE_SA_CLIENT_EMAIL` | yes | `client_email` from the service account JSON. |
| `GOOGLE_SA_PRIVATE_KEY` | yes | `private_key` from the service account JSON. |
| `ADMIN_PASSWORD` | yes | Password for `/admin`, 12 characters or more. Changing it signs everyone out. |
| `NEXT_PUBLIC_SITE_URL` | recommended | Public base URL, e.g. `https://cal.yourdomain.com`. Falls back to the Vercel production domain. |
| `DEFAULT_HOST` | no | A host slug. The bare domain redirects to that page. |
| `HOST_EMAILS` | no | See below. |
| `IP_HASH_SALT` | no | Key for hashing guest IPs (rate limit). Defaults to `ADMIN_PASSWORD`. |

`HOST_EMAILS=gmail` turns on the host notification: each new, moved or cancelled booking sends the host a plain-text note from their own mailbox with the guest's answers, reply-to the guest. Needs the Gmail API enabled and the `gmail.send` scope on the delegation entry. Leave it unset and Google's own calendar notifications are all you get.

Copy [`.env.example`](.env.example) to `.env.local` for local dev.

## Local development

```bash
npm install
cp .env.example .env.local   # fill it in
npm run dev                  # http://localhost:3000
npm run typecheck
npm run lint
npm test                     # slot engine, auth, mail: no network needed
```

Local dev talks to the real Google calendars of the hosts you configure, so a test booking is a real invite. Book yourself.

## Code map

- `src/lib/core.ts` time zones, slot generation, input checks. Pure, unit tested.
- `src/lib/google.ts` Calendar (free/busy, calendar list, insert / patch / delete event) and the optional Gmail send, as each host via delegation.
- `src/lib/cal.ts` data access and the booking flow (check, insert, Google, roll back on failure).
- `src/lib/auth.ts` the admin password and its signed cookie.
- `src/app/[host]`, `src/app/b/[token]`, `src/app/Booker.tsx` the guest pages.
- `src/app/admin` the admin. `src/app/api/public` and `src/app/api/admin` the routes.
- `supabase/schema.sql` the three tables.

## Security notes

- Every table is deny-all under RLS; only the server's service-role client reads or writes.
- The public slots endpoint returns open start times only, never event titles or busy blocks.
- Manage links are 24 random bytes. Anyone with the link can move or cancel that one booking, same as Calendly.
- Admin writes check the request origin on top of a `SameSite=Lax` httpOnly cookie. Login is slowed after 5 wrong tries per IP.
- The admin is single-password by design. If several people need their own logins, put your auth provider in front of `/admin` and `/api/admin`.

## License

[MIT](LICENSE)
