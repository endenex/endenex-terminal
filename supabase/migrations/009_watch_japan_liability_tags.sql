-- Migration 009 — Watch: Japan scope + liability-impact tags
-- Adds liability_tags column and expands scope coverage to include JP.

-- ── Liability-impact tags ────────────────────────────────────────────────────
-- Every signal carries one or more tags from this taxonomy (brief §6.7.2):
--   COST_UP  — cost-increasing
--   COST_DN  — cost-decreasing
--   REC_UP   — recovery-increasing
--   REC_DN   — recovery-decreasing
--   CAP      — capacity-related
--   POL      — policy / regulatory
--   PROV     — provision disclosure

alter table watch_events
  add column if not exists liability_tags text[] default '{}';

create index if not exists watch_events_liability_tags_idx
  on watch_events using gin(liability_tags);

comment on column watch_events.scope is
  'Jurisdiction code: EU | GB | US | JP | DE | DK | FR | ES | NL | SE | IT | AU | Global';

comment on column watch_events.liability_tags is
  'Liability-impact tags: COST_UP | COST_DN | REC_UP | REC_DN | CAP | POL | PROV';

-- ── Japan watch sources ──────────────────────────────────────────────────────
-- Seed known Japan-coverage sources so they resolve correctly in the UI.
-- On conflict (same name) update the metadata fields.

insert into watch_sources (name, url, source_type, regions, notes)
values
  ('METI Japan',
   'https://www.meti.go.jp',
   'regulator',
   array['JP'],
   'Ministry of Economy, Trade and Industry — FIT registry, reserve disclosures, policy'),

  ('PV Magazine Japan',
   'https://www.pv-magazine-japan.com',
   'trade press',
   array['JP'],
   'Solar PV trade publication — Japan edition'),

  ('Renewable Energy Institute Japan',
   'https://www.renewable-ei.org',
   'trade body',
   array['JP'],
   'Japanese renewable energy think-tank and advocacy'),

  ('Nikkei Energy',
   'https://www.nikkei.com',
   'news',
   array['JP'],
   'Nikkei — energy and infrastructure coverage'),

  ('Japan Wind Power Association',
   'https://jwpa.jp',
   'trade body',
   array['JP'],
   'JWPA — Japanese wind industry association'),

  ('Find a Tender Service',
   'https://www.find-tender.service.gov.uk',
   'procurement',
   array['GB'],
   'UK public procurement notices — decommissioning and repowering tenders'),

  ('TED Europa',
   'https://ted.europa.eu',
   'procurement',
   array['EU'],
   'Tenders Electronic Daily — EU public procurement'),

  ('SAM.gov',
   'https://sam.gov',
   'procurement',
   array['US'],
   'US federal procurement and contract awards')

on conflict (name) do update
  set url         = excluded.url,
      source_type = excluded.source_type,
      regions     = excluded.regions,
      notes       = excluded.notes,
      updated_at  = now();
