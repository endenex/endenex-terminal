-- ── Watch module ───────────────────────────────────────────────────────────────
-- Curated market intelligence feed: repowering events, regulatory changes,
-- commodity signals, and supply chain activity.

create type watch_category as enum (
  'market',       -- asset-level repowering / decommissioning activity
  'regulatory',   -- policy, planning framework, subsidy changes
  'commodity',    -- scrap prices, supply disruptions, processing capacity
  'supply_chain'  -- recyclers, crane operators, blade processors, logistics
);

-- ── Sources ─────────────────────────────────────────────────────────────────

create table watch_sources (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,                        -- e.g. "Windbranche.de"
  url         text,                                 -- homepage / base URL
  source_type text,                                 -- 'trade press' | 'regulator' | 'market data' | 'news' | 'company'
  regions     text[],                               -- regions primarily covered
  notes       text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- ── Events ──────────────────────────────────────────────────────────────────

create table watch_events (
  id            uuid primary key default gen_random_uuid(),
  category      watch_category not null,
  event_type    text not null,                      -- free-text from agreed taxonomy
  scope         text not null,                      -- EU | GB | US | DE | DK | FR | ES | Global
  headline      text not null,                      -- 1-line summary shown in feed
  notes         text,                               -- 1-2 sentence detail shown in panel
  -- market-event fields (nullable for other categories)
  site_name     text,
  developer     text,
  capacity_mw   numeric,
  turbine_count integer,
  -- supply chain / commodity field
  company_name  text,
  -- source
  source_id     uuid references watch_sources(id),
  source_url    text,                               -- specific article / document URL
  -- metadata
  event_date    date not null,
  confidence    text not null check (confidence in ('High', 'Medium', 'Low')),
  last_reviewed date not null default current_date,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create index watch_events_category_idx   on watch_events(category);
create index watch_events_scope_idx      on watch_events(scope);
create index watch_events_event_date_idx on watch_events(event_date desc);

-- ── RLS ─────────────────────────────────────────────────────────────────────

alter table watch_sources enable row level security;
alter table watch_events  enable row level security;

create policy "Authenticated users can read watch_sources"
  on watch_sources for select
  using (auth.role() = 'authenticated');

create policy "Authenticated users can read watch_events"
  on watch_events for select
  using (auth.role() = 'authenticated');
