-- Migration 008 — Decommissioning Cost Index
-- Stores periodic DCI Spot publications for Europe Wind and US Wind series.
-- One row per series per publication date.

-- ── Series taxonomy ──────────────────────────────────────────────────────────
-- europe_wind   Headline Europe series (EUR, weighted European composite)
-- us_wind       Headline US series (USD, separate reference asset)
-- uk_wind       UK sub-series (GBP or EUR, under Europe umbrella)
-- eu_exuk_wind  EU ex-UK sub-series

create type dci_series as enum (
  'europe_wind',
  'us_wind',
  'uk_wind',
  'eu_exuk_wind'
);

-- ── Publications ─────────────────────────────────────────────────────────────

create table dci_publications (
  id                    uuid        primary key default gen_random_uuid(),

  -- Series and publication
  series                dci_series  not null,
  publication_date      date        not null,
  is_headline           boolean     not null default true,   -- false for sub-series

  -- Headline index value
  -- DCI Spot(t) = Net liability(t) / Net liability(base) × 100
  index_value           numeric(10,2),   -- e.g. 100.00 at base, 107.30 later
  index_base_date       date,            -- the base period date for this series

  -- Absolute figures (EUR/MW for Europe, USD/MW for US)
  currency              text        not null,    -- EUR | USD | GBP
  net_liability         numeric(12,2),           -- net liability per MW
  net_liability_low     numeric(12,2),           -- confidence range low
  net_liability_high    numeric(12,2),           -- confidence range high

  -- Cost components (all in same currency as net_liability, per MW)
  gross_cost            numeric(12,2),

  -- Material recovery
  recovery_ferrous      numeric(12,2),
  recovery_copper       numeric(12,2),
  recovery_aluminium    numeric(12,2),
  material_recovery     numeric(12,2),  -- sum of above three

  -- Disposal / negative items
  blade_transport       numeric(12,2),
  blade_gate_fees       numeric(12,2),
  scrap_haulage         numeric(12,2),
  disposal_costs        numeric(12,2),  -- sum of above three

  -- Net material position = material_recovery − disposal_costs
  net_material_position numeric(12,2),

  -- Publication metadata
  methodology_version   text,
  is_published          boolean     not null default false,
  notes                 text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  unique (series, publication_date)
);

create index dci_publications_series_date_idx
  on dci_publications (series, publication_date desc);

create index dci_publications_published_idx
  on dci_publications (is_published, publication_date desc);

-- ── RLS ─────────────────────────────────────────────────────────────────────

alter table dci_publications enable row level security;

-- Authenticated users can read published values only
create policy "Authenticated users can read published DCI"
  on dci_publications for select
  using (auth.role() = 'authenticated' and is_published = true);

-- ── Trigger: updated_at ──────────────────────────────────────────────────────

create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger dci_publications_updated_at
  before update on dci_publications
  for each row execute function update_updated_at();
