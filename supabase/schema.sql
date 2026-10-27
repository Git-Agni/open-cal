-- open-cal schema. Run once in the Supabase SQL editor (or `supabase db push`).
-- Three tables: booking pages (hosts), event types per host, bookings. Availability is read
-- live from Google free/busy, so no busy times are stored here.
--
-- SECURITY: row level security on, no policies (deny-all). The app reads and writes with the
-- service-role key only, on the server; the anon key can read nothing.
--
-- Idempotent: safe to run more than once.

create table if not exists cal_hosts (
  id                 uuid primary key default gen_random_uuid(),
  email              text not null unique,               -- the Workspace user we act as (organizer)
  slug               text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  name               text not null,
  headline           text,                               -- one line under the name on the page
  bio                text,                               -- a few lines about the host, [label](https://...) links
  avatar_url         text,
  timezone           text not null default 'UTC',
  -- {"1":[{"start":"08:00","end":"13:00"}], ... } keyed by weekday 0 (Sun) - 6 (Sat), host-local
  weekly_hours       jsonb not null default '{}'::jsonb,
  -- {"2026-12-24": [] (closed) | [{"start":"10:00","end":"12:00"}]}
  date_overrides     jsonb not null default '{}'::jsonb,
  busy_calendar_ids  text[] not null default '{}',       -- calendars that block slots
  target_calendar_id text,                               -- where bookings are written (null = primary)
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists cal_event_types (
  id               uuid primary key default gen_random_uuid(),
  host_id          uuid not null references cal_hosts(id) on delete cascade,
  slug             text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,60}$'),
  name             text not null,
  description      text,
  duration_min     int  not null check (duration_min between 5 and 480),
  increment_min    int  not null default 30 check (increment_min between 5 and 240),
  buffer_before_min int not null default 0 check (buffer_before_min between 0 and 240),
  buffer_after_min int  not null default 0 check (buffer_after_min between 0 and 240),
  min_notice_min   int  not null default 1440 check (min_notice_min between 0 and 43200),
  max_days_ahead   int  not null default 60 check (max_days_ahead between 1 and 365),
  max_per_day      int  check (max_per_day is null or max_per_day between 1 and 50),
  -- [{"id":"company","label":"Company","kind":"text","required":true}, ...]
  questions        jsonb not null default '[]'::jsonb,
  extra_attendees  text[] not null default '{}',         -- also invited (e.g. a teammate)
  color            text,
  -- Own hours for this event; null = the host's. Its date overrides sit on top of the host's.
  weekly_hours     jsonb,
  date_overrides   jsonb,
  timezone         text,                                 -- zone for the own hours; null = the host's
  allow_guests     boolean not null default true,        -- the form's "Add guests"
  extra_busy_calendar_ids text[] not null default '{}',  -- calendars only this event also checks
  previous_slugs   text[] not null default '{}',         -- old links, redirected to slug
  position         int not null default 0,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (host_id, slug)
);

create table if not exists cal_bookings (
  id              uuid primary key default gen_random_uuid(),
  host_id         uuid not null references cal_hosts(id) on delete cascade,
  event_type_id   uuid references cal_event_types(id) on delete set null,
  event_name      text not null,                         -- kept if the type is renamed or deleted
  start_at        timestamptz not null,
  end_at          timestamptz not null,
  status          text not null default 'confirmed' check (status in ('confirmed','cancelled')),
  guest_name      text not null,
  guest_email     text not null,
  guest_timezone  text,
  answers         jsonb not null default '{}'::jsonb,    -- question id -> answer
  meta            jsonb not null default '{}'::jsonb,    -- utm_*, referrer, page
  manage_token    text not null unique,                  -- the guest's reschedule / cancel link
  google_event_id text,
  meet_url        text,
  ip_hash         text,
  cancelled_at    timestamptz,
  cancelled_by    text,                                  -- 'guest', 'host' or 'calendar' (deleted in Google)
  cancel_reason   text,
  rescheduled_from timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (end_at > start_at)
);

-- Two live bookings can never start at the same minute for one host (the race guard).
create unique index if not exists cal_bookings_host_start_live
  on cal_bookings (host_id, start_at) where status = 'confirmed';
create index if not exists cal_bookings_host_start_idx on cal_bookings (host_id, start_at desc);
create index if not exists cal_bookings_ip_recent_idx on cal_bookings (ip_hash, created_at desc);

-- Databases created from an earlier version of this file: add the later columns.
alter table cal_hosts       add column if not exists bio text;
alter table cal_event_types add column if not exists weekly_hours jsonb;
alter table cal_event_types add column if not exists date_overrides jsonb;
alter table cal_event_types add column if not exists timezone text;
alter table cal_event_types add column if not exists allow_guests boolean not null default true;
alter table cal_event_types add column if not exists extra_busy_calendar_ids text[] not null default '{}';
alter table cal_event_types add column if not exists previous_slugs text[] not null default '{}';
-- An event can send its invites from another Workspace address; each booking keeps the address
-- its Google event was made as, so moves and cancels act as the same one.
alter table cal_event_types add column if not exists organizer_email text;
alter table cal_bookings    add column if not exists organizer_email text;
-- The Google Calendar colour ("1".."11") every booking of this event gets.
alter table cal_event_types add column if not exists calendar_color text;

alter table cal_hosts       enable row level security;
alter table cal_event_types enable row level security;
alter table cal_bookings    enable row level security;
