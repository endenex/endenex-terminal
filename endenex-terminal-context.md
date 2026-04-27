# Endenex Terminal — Build Context File
## For use in Claude Code build session
### Prepared: April 2026

---

## 1. Who Alex Gospodinov Is

Alex Gospodinov is the founder and sole director of Endenex Limited (Company No. 17061688), registered at 6th Floor, 37 Lombard Street, London EC3V 9BQ.

Background: principal investing at Macquarie Capital, offshore wind investment at BP, European energy infrastructure development. Postgraduate Diploma from Oxford's Saïd Business School.

Alex is not a developer. He directs the build; Claude Code does the work. Claude Code should flag proactively when a specific task would be meaningfully better served by Cursor — not theoretically better, but where the benefit is concrete and material.

---

## 2. What Endenex Is

Endenex is a **market infrastructure business** — modelled on exchanges and price reporting agencies (PRAs) like Argus Media, LSEG, Nasdaq, S&P Global. It is not an advisory firm, consultancy, or SaaS product.

**Core product:** The Decommissioning Cost Index (DCI) — an independent benchmark for clean energy asset decommissioning costs across onshore wind, offshore wind, solar PV, and battery storage.

**The thesis:** A structural gap exists between operator-reported decommissioning provisions and actual costs. No independent benchmark exists. Endenex is building it.

**The repowering insight:** The vast majority of wind turbine decommissioning events are triggered by repowering decisions — not standalone end-of-life events. Decommissioning is the old-asset side of a repowering business case. This means:
- The DCI is the independent decommissioning cost reference for repowering business cases
- The repowering wave is the forward demand signal for the DCI
- Repowering intelligence and decommissioning intelligence are the same market viewed from two angles

**Strategic positioning:** The long-term acquirer thesis centres on PRAs — Argus Media identified as the strongest fit. IOSCO alignment, contributor agreements, and gross/net cost separation all strengthen the acquisition case.

**Current state:** Pre-revenue, pre-publication. Legal framework complete (DCA, PAP, Privacy Notice, Website Terms of Use). Website live at endenex.com (plain HTML/CSS/JS on Netlify, 12 pages). Data collection platform with Airtable CRM. Market intelligence agent (Python, GitHub Actions). Interactive tools suite on endenex.com.

---

## 3. What Endenex Terminal Is

**Name:** Endenex Terminal
**Domain:** terminal.endenex.com
**Tagline:** Market intelligence for ageing clean energy assets

Endenex Terminal is the paid, gated product surface of Endenex. It is a professional data terminal — not a dashboard, not a report, not a SaaS tool — providing institutional-grade intelligence on clean energy asset decommissioning, repowering activity, liability benchmarking, and secondary material flows.

**Reference products for UI direction:**
- Interactive Brokers (IBKR) — multi-module structure, data density, professional user expectation
- Koyfin — modern execution of professional data terminal aesthetic
- Bloomberg — cultural touchstone, not direct copy

**The standard "Terminal" creates:** Current, queryable, dense, trusted, workflow-relevant. Every number needs source, timestamp, methodology, and confidence. Export functionality must be institutional grade.

---

## 4. Geographic Positioning

**Non-negotiable principle:** Endenex Terminal covers European (aggregated) and US markets without skew or hierarchy to any country.

No country is positioned as primary, lead, or reference — not in marketing, methodology, UI defaults, or outreach. The build sequence prioritises markets with richest data internally but this is never communicated externally.

**DCI geographic structure:**
- DCI Europe: European aggregated index, expressed in EUR, constructed from a weighted composite of European contributing markets
- DCI US: Separate index, expressed in USD
- These are the two published units — not country-level indices

**Asset data geographic coverage for Phase 1:**

| Country | Primary Source | Priority |
|---|---|---|
| Germany | Marktstammdatenregister (MaStR) | Phase 1 — richest data, largest fleet |
| UK | REPD (Renewable Energy Planning Database) | Phase 1 — clean data, established buyers |
| US | USWTDB (US Wind Turbine Database, USGS/LBNL) | Phase 1 — anchor for US DCI |
| Denmark | Energistyrelsen Stamdataregister | Phase 2 — oldest European fleet |
| France | ODRÉ (RTE open data) | Phase 2 — site level, European aggregate |
| Spain | Global Energy Monitor Wind Power Tracker | Phase 2 — workaround for missing national registry |

All six countries are part of the European/US product. Phase 1 builds Germany + UK + US data layers first because the data is richest. The Terminal launches as a multi-market product.

---

## 5. Asset Class Scope

**Phase 1:** Onshore wind only across all modules
**Phase 2:** Solar PV
**Phase 3:** BESS (Battery Energy Storage Systems)
**Phase 4:** Offshore wind

The platform architecture accommodates all four asset classes from day one. Asset class is a filter and parameter, not a structural rebuild.

---

## 6. The Three Workspaces

The Terminal presents three user-facing workspaces. Six underlying modules power them. Users see workspaces; the module architecture is internal.

### Workspace 1: Market Monitor
**Pain it solves:** "I cannot see what is happening across the market in any structured way."
**What it contains:**
- Live Repowering Tracker — announced repowerings, planning applications, consents, construction starts, commissioning events
- Decommissioning campaign activity
- Contractor mobilisations
- Processor utilisation signals
- Country-filterable, asset-class-filterable
- Source attribution on every record, timestamp, confidence level, last reviewed date
- Weekly update cadence initially (manual curation), automated pipeline as scale permits

**Primary users:** All cohorts

### Workspace 2: Asset Screener
**Pain it solves:** "I cannot systematically identify forward opportunities or risks across the asset base."
**What it contains:**
- Repowering Intelligence — predictive forward pipeline of likely repowering candidates before announcement
- Signal-stack classification per site (NOT a 0–100 score):

| Signal | Classification |
|---|---|
| Age signal | Strong / Medium / Weak |
| Support scheme expiry | Confirmed / Inferred / Unavailable |
| Planning signal | Active / Dormant / None |
| Grid connection value | High / Medium / Low |
| Owner behaviour | Repowering-active / Unknown |
| Physical constraint | Constrained / Unconstrained / Unknown |
| **Overall** | **Watchlist / Candidate / Active / Confirmed** |

- Filterable by country, vintage, owner, capacity, asset class
- Owner/operator identification where derivable from public sources (Companies House, MaStR operator records, USWTDB project developers)
- Saved views and watchlists as first-class features

**Primary users:** Developers, fund managers, M&A advisors, contractors, recyclers

### Workspace 3: Liability and Materials Workbench
**Pain it solves:** "I cannot benchmark my specific assets against independent reference data."
**What it contains:**

**A. DCI Methodology and Market Reference**
- Full methodology documentation (version-controlled, exportable, citable)
- DCI Spot values for onshore wind, Europe and US — with confidence ranges, not point estimates
- DCI Forward and DCI Reserve: publication roadmap items at launch, not live products at v1
- Source register, confidence framework, derivation logic
- Contribution activity summary (number of projects contributing to each index — not individual data)
- Clear language: "Methodology designed with reference to IOSCO benchmark principles"

**B. Portfolio Liability Workbench** (not "Portfolio Analytics")
User inputs their portfolio:
- Asset type
- Location / market
- Capacity (MW)
- Commissioning date / age
- OEM and turbine model where known
- Battery chemistry where applicable (BESS)

Terminal applies DCI parameters and outputs:
- Estimated gross decommissioning liability (range, not point estimate)
- Net Recovery Offset (NRO)
- Net liability (range)
- Sensitivity analysis (commodity price scenarios, timing scenarios)
- Comparison to DCI Reserve benchmark
- Three output modes: Quick liability range / Board memo export / Surety and lender export

Required disclosure on every output:
*"Indicative liability benchmarking based on Endenex market assumptions. Not an accounting valuation, engineering estimate, legal opinion or reserve recommendation."*

**C. Recoverable Materials Outlook**
Forward supply of recoverable materials from retiring clean energy assets:
- Phase 1 (onshore wind): structural steel, cast iron, copper, aluminium, blade composite waste (GFRP/CFRP)
- Phase 2 additions: rare earth magnets (direct-drive only, flagged as forming market), battery materials (NMC and LFP chemistries)
- By geography and quarter
- Confidence intervals on volume forecasts
- Material specification by vintage and OEM where derivable
- API/data export functionality for commodity cohort (Phase 2)

**Primary users:** Fund managers, lenders, surety underwriters, M&A advisors, commodity traders, recyclers

---

## 7. The Six Underlying Modules

Internal architecture that powers the three workspaces:

1. **Data ingestion and normalisation layer** — multi-country asset registries, source metadata as first-class fields
2. **DCI methodology and assumptions library** — reference asset, cost framework, calculation engine
3. **Repowering scoring and inference engine** — signal-stack model powering the Asset Screener
4. **Tracker curation and update pipeline** — Market Monitor data management
5. **Portfolio analytics engine** — DCI parameter application to user-input portfolios
6. **Materials forecasting engine** — forward supply curves from asset retirement data

---

## 8. DCI Methodology — Key Decisions

### Core principle
Fix the asset. Let the market move.

The index does not attempt to represent every asset. It defines a standardised reference asset and tracks how the cost of that asset changes over time.

### Reference asset
The reference asset is a **synthetic European reference asset** — defined in engineering terms without reference to any specific country's typical project. Not a UK baseline. This is non-negotiable for geographic positioning integrity.

The reference asset defines: turbine/equipment class, foundation and structural scope, cable treatment, access conditions, logistics assumptions, contracting structure. These parameters are fixed and do not change over time.

### Cost framework (gross to net)
**Gross cost components:**
- Crane mobilisation and lifting
- Dismantling labour and plant
- Foundation removal
- Cable works
- Site restoration
- Grid disconnection
- HSE and contractor obligations
- Soft costs (defined explicitly — not a catch-all): project management, regulatory compliance fees, insurance during campaign, contingency

**Material recovery (Net Recovery Offset — NRO):**
- Structural steel (HMS 1&2 at market rate)
- Cast iron (at ~30% discount to HMS — included in base NRO)
- Copper
- Aluminium
- Rare earth magnets: excluded from base NRO (no liquid recovery market currently exists) — flagged as configuration-dependent upside, direct-drive only
- Blade composite: net cost not recovery — stated explicitly in methodology

**Net cost = Gross cost − NRO**

The DCI headline is always the net figure.

### DCI family structure
- **DCI Spot** — current market cost (launch product)
- **DCI Forward** — forward liability expectation (Phase 2, methodology must be fully defined before publication)
- **DCI Reserve** — observed provisioning levels (Phase 2, requires careful aggregation safeguards)

**Asset classes:** Onshore Wind, Solar PV, BESS
**Regions:** Europe (aggregated), United States (separate)

### Geographic treatment
Country-level price differences handled through normalisation factors (labour, plant/equipment, logistics, disposal cost). Normalised before aggregation. The index reflects market movement, not geographic price levels.

DCI Europe weighting methodology: weightings reflect capacity approaching end-of-life, observed decommissioning activity, and data quality/coverage. Weighting methodology is published at principle level. Exact period-by-period weightings are not published. No single country exceeds 40% weight; no contributing country falls below 5%.

### Publication cadence
- DCI Spot: quarterly
- DCI Forward: quarterly with annual methodology refresh (Phase 2)
- DCI Reserve: annually (Phase 2)

### Confidence and ranges
Every DCI value is expressed as a range (high, low, midpoint) — never a single point estimate. Confidence level attached to every published value.

### DCI Reserve safeguards
- Aggregated values only — never per-operator or per-asset reserve data
- Minimum three distinct contributing projects of the same asset class in the same geographic market before publication (consistent with Privacy and Anonymisation Policy)
- Clear "observational and reportorial only" labelling
- Not a recommendation or requirement

### IOSCO language
Always: "Methodology designed with reference to IOSCO benchmark principles."
Never: "IOSCO-aligned" or "IOSCO-compliant" — too strong, legally exposed.

### Governance (to be documented)
Internal methodology governance protocol — who decides changes, what the consultation process is, how changes are disclosed. Oversight documented even at one-paragraph level. This needs to be in the methodology document before investor or acquirer conversations.

---

## 9. Access Model

**Single subscription tier** — one Terminal, all workspaces, all content accessible to all subscribers.

**Cohort identification at onboarding** personalises default view only — does not restrict access.

**User cohorts** (identified at onboarding):
1. Developer / Asset Originator
2. Fund Manager / Asset Owner
3. Lender / Debt Provider
4. Surety Underwriter / Insurer
5. Decommissioning Contractor
6. Recycler / Processor
7. Commodity Trader / Material Broker
8. M&A Advisor / Banker
9. Operator / Asset Manager
10. Regulator / Government

**Asset class interest** (identified at onboarding):
Onshore Wind / Offshore Wind / Solar PV / BESS / All

**Commercial structures** (same product, different packaging):
- Individual professional subscription
- Firm licence (infrastructure funds, advisory firms)
- Data contributor access (discounted or complimentary — supports DCI data acquisition)
- Data licence / feed (for Argus, Fastmarkets, analytics platforms — Phase 2)
- Bespoke portfolio export (add-on, higher margin)

**Access gates:**
- Phase 1: email gate (free during validation)
- Phase 2: Stripe integration for paid conversion
- Free tier on endenex.com: aggregate/headline data, no login required
- Paid tier on terminal.endenex.com: full site-level intelligence, login required

---

## 10. UI Design Brief

**Name displayed:** Endenex Terminal
**Visual register:** Professional data terminal. Information dense, data-forward, functional. Not consumer SaaS. Not decorative.

**Brand palette (consistent with endenex.com):**
- Navy: #0A1628
- Teal: #007B8A
- White background: #FFFFFF
- Cool grey: #F4F5F7
- Data accent: teal
- Alert/risk: functional red (TBD)
- Positive/recovery: functional green (TBD)

**Typography:**
- Body and navigation: Inter
- All numerical data: IBM Plex Mono
- Colour communicates data state, not decoration

**Layout principles:**
- Dense tables with sortable columns and quick filters — primary data surface
- Persistent workspace navigation (left sidebar or top bar)
- Numerical formatting: right-aligned, comma separators, consistent decimal places, units in column headers
- Charts: functional, configurable, utility over beauty
- Dark mode: available

**Source and Confidence panel** — visible on every data point:

| Field | Value |
|---|---|
| Source type | e.g. Planning portal / MaStR / REPD |
| Source date | DD Month YYYY |
| Signal type | e.g. Repowering planning application |
| Confidence | High / Medium / Low |
| Last reviewed | DD Month YYYY |
| Derivation | Observed / Inferred / Modelled |

**No country defaults anywhere in the UI.** All geographic filtering is active, user-driven.

**Saved views and watchlists** as first-class platform features, not optional extras.

**Export formats:**
- PDF (board memo, lender/surety file)
- CSV (data export)
- API feed (Phase 2, commodity cohort)

**Onboarding flow:**
1. Cohort identification (which of the 10 cohort types)
2. Asset class interest
3. Geographic focus (optional — terminal is multi-market, no default)
4. Sets default workspace and view
5. Does not restrict access

---

## 11. Technical Architecture

**Hosting:** Netlify (separate site from endenex.com, own deploy pipeline)
**Domain:** terminal.endenex.com (subdomain configured in Netlify)
**Frontend:** React
**Backend / Database:** Supabase (Postgres) — system of record for all structured data
**Auth:** Clerk or Supabase Auth (decide at build session start — Clerk preferred for developer experience)
**Payments:** Stripe (Phase 2 — not needed for email gate Phase 1)
**Curation interface:** Airtable (manual data curation console, not system of record)
**Existing infrastructure:** GitHub repo, Netlify, Airtable, Python agents on GitHub Actions — all continue as is
**Object storage:** For CSV exports, methodology documents, evidence files
**Scheduled jobs:** Data ingestion and refresh pipelines (MaStR bulk download, REPD quarterly, USWTDB quarterly)
**API:** For commodity cohort data export (Phase 2)

**Data schema principles:**
- Source metadata as first-class fields on every record (source type, source date, confidence, derivation, last reviewed)
- Asset class as first-class attribute on every asset record
- Country code as first-class attribute — never inferred
- Confidence intervals stored as upper/lower/midpoint — never single point
- Version history on methodology documents
- Minimum sample size enforcement at data layer for DCI Reserve

**Environment variables:** Managed in Netlify — never committed to repo
**Version control:** GitHub, sensible commit discipline, branch for major features
**Codebase:** Modular component structure, documented architecture decisions in repo

---

## 12. Data Sources — All Verified and Accessible

### Onshore Wind Asset Registries

**Germany — MaStR (Marktstammdatenregister)**
- Source: Bundesnetzagentur
- Access: Bulk XML download or SOAP API; Python package `open-mastr` (pip install open-mastr)
- Fields: Commissioning date, decommissioning date, turbine make/model, hub height, rotor diameter, capacity, location, EEG subsidy ID and end dates
- EEG end dates are the primary repowering trigger in Germany
- Updated: daily
- Licence: DL-DE-BY-2.0, mandatory attribution

**UK — REPD (Renewable Energy Planning Database)**
- Source: DESNZ / Barbour ABI via gov.uk
- Access: Direct download, quarterly, open government licence
- Fields: Project name, technology, capacity, development status, planning authority, commissioning date, grid connection, coordinates
- Repowering tracked as distinct development status, old and new projects linked
- Updated: quarterly (January 2026 most recent)

**US — USWTDB (US Wind Turbine Database)**
- Source: USGS / Lawrence Berkeley National Laboratory / American Clean Power Association
- Access: Direct download CSV/GeoJSON/Shapefile + REST API, public domain
- Fields: Commissioning year, turbine make/model, hub height, rotor diameter, capacity, coordinates, project name, state
- Separate decommissioned turbine dataset: 12,400+ confirmed removed turbines — primary input for Materials Outlook
- Scale: 75,727 turbines, updated quarterly

**Denmark — Energistyrelsen Stamdataregister**
- Source: Danish Energy Agency
- Access: Excel download from ens.dk
- Fields: Turbine ID (GSRN), grid connection date, capacity, local authority, land/sea classification, historical annual production per turbine
- Oldest installed fleet in Europe — leading repowering market by vintage

**France — ODRÉ**
- Source: RTE via ODRÉ platform
- Access: API (OpenDataSoft) and direct CSV, updated monthly
- Fields: Per-installation commissioning date for facilities above 36kW, technology type filterable
- Granularity: wind farm / installation level (not necessarily individual turbine)
- Note: Functional for signal-stack at site level

**Spain — Global Energy Monitor Wind Power Tracker**
- Source: Global Energy Monitor
- Access: Form submission download, CC BY 4.0 (free)
- Fields: Commissioning dates, capacity, location, ownership, project status
- Note: No clean per-turbine national registry exists in Spain; GEM Tracker is the verified workaround

### Other Confirmed Data Sources

**UK — Companies House API**
- Free REST API (requires free account and API key)
- Rate limited at 600 requests / 5 minutes (2/sec)
- 667 UK PFI/PPP SPV company numbers already in HMT file
- Use: ownership tracking, SPV financial history

**UK — IPA (Infrastructure and Projects Authority)**
- Annual report with Delivery Confidence Assessments (RAG ratings)
- Downloadable as spreadsheet per department

**UK — Hansard / Parliamentary debates**
- API: api.parliament.uk and TheyWorkForYou API
- Both free, keyword search across all debates
- Use: contract mentions, authority statements

**UK — HMT PFI/PF2 database**
- 667 projects, downloaded and parsed (April 2025 file)
- Fields: Contract expiry date, SPV name, SPV company number, equity holders, year-by-year payment schedules to 2052
- For PPP Concession Cliff Monitor (separate tool, parked)

**Solar PV registries (Phase 2):**
- UK: REPD covers solar
- Germany: MaStR covers solar
- US: LBNL Tracking the Sun database (confirmed public, downloadable)

**BESS registries (Phase 3):**
- UK: REPD covers storage
- Germany: MaStR covers storage
- US: EIA Form 860 (utility-scale storage)

---

## 13. Build Sequence

### Phase 1 — Foundation and first workspace

**Step 1: Terminal infrastructure**
- terminal.endenex.com subdomain configured in Netlify
- Supabase project: Postgres database, auth tables, storage
- Auth: Clerk or Supabase Auth — email/password and magic link
- Onboarding flow: cohort, asset class, geographic focus
- Dashboard shell: three workspace tiles, placeholder pages for unbuilt workspaces
- Source/confidence data schema established as foundation
- Brand implementation: #0A1628, #007B8A, #F4F5F7, Inter, IBM Plex Mono
- Environment variables, deployment pipeline

**Step 2: Data ingestion layer (onshore wind, three markets)**
- REPD ingestion (UK)
- MaStR ingestion via open-mastr (Germany)
- USWTDB ingestion (US)
- Normalised schema with country code, asset class, source metadata, confidence
- Supabase tables: assets, repowering_signals, decom_events, material_forecasts

**Step 3: Market Monitor — UK + Germany + US onshore wind**
- Manually curated initially (weekly update workflow)
- Event types: planning application, consent, construction start, commissioning, decom campaign
- Country filter, asset class filter, event type filter
- Source and confidence panel on every record
- Saved views

**Step 4: Asset Screener — UK + Germany + US onshore wind**
- Signal-stack model (age, support expiry, planning, grid value, owner behaviour, physical constraint)
- Overall classification: Watchlist / Candidate / Active / Confirmed
- Site-level records with owner identification where derivable
- Filterable by country, vintage, capacity, classification, owner
- Watchlist functionality

**Step 5: DCI Methodology layer**
- Methodology document fully visible (version-controlled, exportable)
- DCI Spot: Europe aggregated and US, onshore wind, with confidence ranges
- DCI Forward and Reserve: publication roadmap display (not live)
- Source register, confidence framework, derivation logic
- Contributor activity summary

### Phase 2 — Revenue-generating modules

**Step 6: Portfolio Liability Workbench**
- Input form: asset type, location, capacity, age, OEM
- DCI parameter application engine
- Output: gross/NRO/net ranges, sensitivity analysis, benchmark comparison
- Three export formats: quick range, board memo PDF, surety/lender export
- Disclosure language on all outputs
- Feedback loop: anonymised aggregate of inputs feeds DCI

**Step 7: Recoverable Materials Outlook**
- Onshore wind materials: steel, cast iron, copper, aluminium, blade composite
- By country and quarter
- Confidence intervals on volume forecasts
- Vintage and OEM-driven material composition
- API/data export planning

**Step 8: Add Denmark, France, Spain to data layer**
- Energistyrelsen (Denmark)
- ODRÉ (France)
- GEM Tracker (Spain)
- European aggregate DCI now covers six markets

### Phase 3 — Commodity cohort and index formalisation

**Step 9:** DCI Forward methodology defined and published
**Step 10:** DCI Reserve with aggregation safeguards
**Step 11:** API/data export for commodity cohort
**Step 12:** Solar PV data layer
**Step 13:** Argus/Fastmarkets data licensing exploration

### Phase 4 — Asset class expansion

**Step 14:** BESS data layer and methodology
**Step 15:** Offshore wind (distinct cost profile, regulatory framework, marine logistics)

---

## 14. User Cohorts and What They Need

| Cohort | Primary pain | Terminal feature that solves it |
|---|---|---|
| Fund managers | ARO provision adequacy with no independent benchmark | Portfolio Liability Workbench + DCI |
| Lenders | Reserve sizing is formulaic, not market-based | DCI Spot + Portfolio Workbench exports |
| Surety underwriters | Bond pricing on incomplete data | DCI ranges + Reserve benchmark |
| Developers | Repowering pipeline visibility is fragmented | Asset Screener + Market Monitor |
| Decommissioning contractors | No structured forward pipeline visibility | Market Monitor + Asset Screener |
| Recyclers/processors | Cannot plan capacity without forward volume data | Materials Outlook + Market Monitor |
| Commodity traders | No forward supply curve from clean energy retirement | Materials Outlook + API export |
| M&A advisors | Decom liability benchmarking for diligence is consultant-driven | Portfolio Workbench + DCI |
| Operators | No independent reference for end-of-life advice to owners | DCI + Asset Screener |
| Regulators | No structured market activity view | Market Monitor (low/no cost access) |

---

## 15. Related Tools — Separate from Terminal

These exist or are planned as standalone tools outside the Terminal:

**PPP Concession Cliff Monitor** — UK-first tool tracking PFI/PPP concession expiry, outcome scoring, ownership tracking. HMT file already downloaded and parsed. Build decision: validated separately as calling card for infra fund analysts. Not part of Terminal.

**Tool D (Secondary Material Forward Curve standalone)** — separate from the Terminal's Materials Outlook, potentially licensed to Argus or Fastmarkets as a data product. Relationship to Terminal's Materials Outlook to be determined.

---

## 16. Investor and Fundraising Context

**Target investors:**
- Pre-seed: climate-tech and energy transition specialists (Energy Impact Partners, Voyager Ventures, Climate Capital, World Fund, Hoxton Ventures, Concept Ventures)
- Series A (after traction): Augmentum Fintech, Titanium Ventures

**What makes this investment-ready:**
- Working Terminal with at least two live workspaces
- Published analysis under Endenex brand driving inbound
- 3+ signed letters of intent from target buyer cohorts
- DCI methodology document complete and defensible
- Contributor pipeline with at least 5 signed DCAs
- Clear acquirer narrative with precedent transactions

**Acquirer narrative:** Argus Media is the primary target. The Terminal and DCI together represent a credible benchmark publisher with:
- IOSCO-referenced methodology
- Contributor agreements (DCA framework)
- Multi-market, multi-asset-class coverage
- Paying institutional subscribers
- Gross/net/NRO structure matching Argus's existing commodity data architecture

---

## 17. Key Terminology

| Term | Definition |
|---|---|
| DCI | Decommissioning Cost Index |
| NRO | Net Recovery Offset — recoverable material value subtracted from gross cost |
| ARO | Asset Retirement Obligation — accounting provision for future decommissioning |
| HMS | Heavy Melting Steel — scrap grade reference price |
| DCA | Data Contribution Agreement — legal framework for contributor data |
| PAP | Privacy and Anonymisation Policy |
| IOSCO | International Organisation of Securities Commissions — benchmark principles reference |
| MaStR | Marktstammdatenregister — German national energy register |
| REPD | Renewable Energy Planning Database — UK planning and commissioning register |
| USWTDB | US Wind Turbine Database |
| EEG | Erneuerbare-Energien-Gesetz — German renewable energy support scheme |
| GFRP | Glass Fibre Reinforced Polymer — primary blade composite material |
| CFRP | Carbon Fibre Reinforced Polymer — premium blade composite |
| NMC | Nickel Manganese Cobalt — battery chemistry |
| LFP | Lithium Iron Phosphate — battery chemistry |
| Three Project Rule | Minimum three distinct contributing projects of same asset class / geography before DCI publication |

---

## 18. What to Tell Claude Code at Session Start

1. We are building Endenex Terminal at terminal.endenex.com
2. This is a professional data terminal for institutional users — not a consumer SaaS
3. I am not a developer. You are directing me. I will approve steps. Flag when Cursor would be meaningfully better for a specific task.
4. Start with the infrastructure (Step 1 in the build sequence)
5. The tech stack is: React frontend, Supabase (Postgres + auth), Netlify deployment, Clerk for auth (confirm this choice at start)
6. Brand: navy #0A1628, teal #007B8A, Inter body, IBM Plex Mono data — consistent with endenex.com
7. Every data point in the Terminal needs source, timestamp, confidence, and derivation as first-class schema fields — build this into the data architecture from line one
8. No country defaults anywhere in the UI
9. Confidence intervals on all values — never single point estimates
10. Read the full context file before proposing any architecture

---

*Document version: Final — April 2026*
*Prepared by: Alex Gospodinov / Endenex Limited, with Claude (Anthropic)*
*For use in Claude Code build session for Endenex Terminal*
