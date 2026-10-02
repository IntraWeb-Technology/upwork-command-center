# Upwork Command Center Architecture Proposal

Status: **Proposed, not approved.** Nothing in this document is implemented. Every JSON payload, endpoint, and table below is a design example for review, not a committed contract.

Inputs reviewed: this repository (`development` branch), and the existing n8n suite in `upwork-proposal-system/n8n/upwork-job-hunter` (README, user guide, workflow exports W00 to W99).

---

## 1. Executive Summary

The Command Center becomes the **system of record**. n8n becomes a **stateless execution engine** that receives a complete request, does the AI and integration work, and returns a structured result. The browser only ever talks to Next.js.

- **PostgreSQL**, accessed through **Drizzle ORM**, stores every job, listing snapshot, analysis, proposal version, submission, outcome, workflow run, and configuration version.
- **Next.js route handlers** are the only boundary. They authenticate the owner with Clerk, write state, and dispatch work to n8n webhooks with a server-held secret.
- **Every n8n operation is asynchronous** through one mechanism: Next.js creates a `workflow_runs` row, n8n acknowledges immediately, n8n posts the result to a Command Center callback endpoint, and the UI polls the run by ID with React Query. No WebSockets, no SSE, no queue infrastructure.
- **Analyses and proposal versions are immutable.** A job is analyzed by appending a new analysis; a proposal is changed by appending a new version. The submitted version is recorded by foreign key, not by copying text into a mutable field.
- **Learning is statistics plus LLM interpretation, gated by human approval.** No autonomous prompt or weight changes.

### What this proposal pushes back on

These are places where the brief, or the current n8n design, conflicts with the stated principles or adds avoidable complexity:

1. **n8n currently owns state.** The existing suite persists everything in n8n Data Tables (`upwork_jobs`, `upwork_events`, `upwork_config`), and sub-workflows receive only a `job_id` and load state themselves. "Command Center owns state" therefore requires refactoring n8n workflows to accept full input and return results instead of writing Data Tables. This is the largest piece of work in the whole plan and must not be hidden behind "just call the webhook." Dual-writing to both stores is explicitly rejected.
2. **There is no Gmail intake today.** All current intake is manual paste (Slack or webhook). "Check Upwork Alerts" is a net-new n8n workflow plus an unknown email format. It should **not** be the first vertical slice. The paste, analyze, propose, submit path reuses proven n8n logic and replaces daily Slack use sooner.
3. **A separate `proposals` parent table adds little.** One Upwork job gets at most one application. The distinction that matters is between an immutable **proposal version** and the **application** (the real-world submission that references exactly one version and accumulates outcomes). Section 4 models it that way.
4. **The "approve / READY_TO_SUBMIT" step is redundant** in a UI where "Mark submitted" requires choosing the exact version. Recommend dropping it.
5. **Callbacks need an HTTP Request node in n8n.** The current suite has a self-imposed "0 HTTP Request nodes" rule. Asynchronous results require at least one shared callback sub-workflow. This needs your approval.
6. **Clerk alone does not make the app single-user.** If sign-ups are open, any Clerk account can reach the dashboard. Add an explicit owner check (Section 7).
7. **The reference route handlers (`/api/products`, `/api/users`) perform no auth check.** `src/proxy.ts` only attaches auth context; protection lives in the dashboard layout. New route handlers must authenticate themselves.
8. **The current n8n webhooks (`/webhook/upwork/*`) appear to be unauthenticated.** New Command Center-facing webhooks must use header auth.

---

## 2. System Responsibilities

| Component | Owns | Must not |
|---|---|---|
| Browser | Rendering, local UI state, URL state (nuqs), polling run status, copying text to clipboard | Hold secrets, call n8n, compute scores |
| Next.js (server) | Auth, input validation, state transitions, persistence, n8n dispatch, callback verification, read models for UI, deterministic text metrics (word count, em dash check) | Call LLMs, read Gmail, duplicate scoring logic, depend on n8n node layout |
| PostgreSQL | All durable business state and history | Be accessed by n8n directly |
| n8n | Gmail retrieval, alert parsing, preliminary screening, extraction, scoring formula, LLM/agent calls, proposal generation, prompt and model configuration (initially), Slack notifications | Be the system of record, read or write the Command Center database |
| Clerk | Authenticating the single owner | Authorization logic beyond "is this the owner" |
| Gmail | Source of Upwork alert emails (read by n8n only) | Be modified to track processing state (no labels as state) |
| LLM providers | Model inference, called only by n8n | Be called from Next.js |

```mermaid
flowchart LR
  subgraph Client
    B[Browser]
  end
  subgraph Vercel_or_host[Command Center host]
    N[Next.js<br/>pages + route handlers]
    D[(PostgreSQL)]
  end
  subgraph Automation[n8n instance]
    W[CC-facing webhooks<br/>intake_scan / analyze / generate_proposal]
    CB[Shared callback<br/>sub-workflow]
  end
  C[Clerk]
  G[Gmail]
  L[LLM providers<br/>Anthropic, OpenAI]

  B -- HTTPS, Clerk session --> N
  N -- verify session --> C
  N -- SQL --> D
  N -- POST + header auth --> W
  W --> G
  W --> L
  W --> CB
  CB -- POST callback + bearer + per-run token --> N
```

---

## 3. Request Flow

All four flows share one pattern: **validate, persist intent, dispatch, persist result in one transaction.**

### 3.1 Email intake ("Check Upwork Alerts")

```mermaid
sequenceDiagram
  participant U as Browser
  participant N as Next.js
  participant DB as Postgres
  participant W as n8n intake_scan
  participant G as Gmail
  U->>N: POST /api/intake/scans
  N->>DB: insert workflow_run (intake_scan, queued), read last cursor
  N->>W: POST {run_id, since cursor, callback}
  W-->>N: 202 accepted
  N->>DB: run -> running
  N-->>U: 202 {runId}
  loop every 2s while not terminal
    U->>N: GET /api/workflow-runs/:id
  end
  W->>G: search alert emails since cursor
  W->>W: parse items, preliminary screening
  W->>N: POST callback {items[], cursor}
  N->>DB: tx: upsert jobs by upwork_ref, insert job_alerts, events, run -> succeeded
  U->>N: GET /api/intake (React Query invalidated)
```

State changes: run created; run running; per item a `jobs` row is created if new (stage `discovered` or `screened_out`), a `job_alerts` row is always appended; scan cursor advances only on success.

### 3.2 Full job analysis

```mermaid
sequenceDiagram
  participant U as Browser
  participant N as Next.js
  participant DB as Postgres
  participant W as n8n analyze
  U->>N: POST /api/jobs/:id/listings {text, url}
  N->>DB: insert job_listing (immutable), job stage -> reviewing
  U->>N: POST /api/jobs/:id/analyses {listingId}
  N->>DB: insert workflow_run (analyze), guard: one active per job+kind
  N->>W: POST {run_id, job, listing_text, callback}
  W-->>N: 202
  N-->>U: 202 {runId}
  W->>W: extract, hard filters, score, analyze (LLMs)
  W->>N: POST callback {facts, scores[], disposition, strategy, versions}
  N->>DB: tx: config_snapshot upsert, insert job_analysis + analysis_scores, job.current_analysis_id, event ANALYZED, run succeeded
```

### 3.3 Proposal generation and regeneration

Same shape as analysis, with kind `generate_proposal`. Next.js sends the analysis facts, strategy, and (for regeneration) the base version text plus user instructions, because n8n no longer loads state itself. The callback inserts one `proposal_versions` row (`origin = generated | regenerated`), sets stage `drafting` if earlier, and appends an event.

A manual edit is **not** an n8n call: `POST /api/jobs/:id/proposal-versions` with `origin = manual_edit` creates a new version synchronously after server-side validation (including the em dash check).

### 3.4 Submission and outcome tracking

```mermaid
sequenceDiagram
  participant U as Browser
  participant N as Next.js
  participant DB as Postgres
  U->>U: Copy version N to clipboard, submit manually on Upwork
  U->>N: POST /api/jobs/:id/application {proposalVersionId, submittedAt, connectsSpent}
  N->>DB: tx: insert application, event SUBMITTED, stage -> submitted
  Note over U,N: days later
  U->>N: POST /api/jobs/:id/events {type: interview, occurredAt}
  N->>DB: tx: insert job_event, set application.interviewed_at, stage -> interviewing
```

No n8n call is needed for submission or outcomes. Slack notifications for these, if still wanted, can be a fire-and-forget n8n webhook later.

---

## 4. Persistence Model

Conventions: UUIDv7 or ULID primary keys (time-sortable, safe to expose); `timestamptz` everywhere; Postgres enums for small closed sets; `jsonb` only for full raw payloads and evolving feature sets, never for fields that analytics will filter on routinely. No `tenant_id` or `user_id` columns (single user). Append-only tables have no `updated_at`.

```mermaid
erDiagram
  jobs ||--o{ job_alerts : "seen in"
  jobs ||--o{ job_listings : "has snapshots"
  jobs ||--o{ job_analyses : "analyzed by"
  job_listings ||--o{ job_analyses : "input to"
  job_analyses ||--o{ analysis_scores : "has"
  jobs ||--o{ proposal_versions : "has"
  job_analyses ||--o{ proposal_versions : "basis for"
  proposal_versions ||--o{ proposal_versions : "parent of"
  jobs ||--o| applications : "submitted as"
  proposal_versions ||--o| applications : "exact text"
  jobs ||--o{ job_events : "timeline"
  jobs ||--o{ workflow_runs : "work"
  config_snapshots ||--o{ job_analyses : "produced with"
  config_snapshots ||--o{ proposal_versions : "produced with"
  config_snapshots ||--o{ job_alerts : "screened with"
  learning_runs ||--o{ learning_observations : "produces"
  learning_observations }o--o{ learning_recommendations : "supports"
```

### `jobs`
- **Purpose:** One row per Upwork job. Identity plus denormalized current state for fast lists.
- **Fields:** `id`, `upwork_ref` (ciphertext such as `~01abc...`, unique when present), `fingerprint` (hash of normalized text, fallback dedupe), `title`, `url`, `origin` (`email_alert | manual_paste`), `stage` (enum below), `close_reason`, `current_analysis_id`, `manual_score`, `manual_disposition`, `override_reason`, `dismiss_reason`, `created_at`, `updated_at`.
- **Notes:** `stage` and `current_analysis_id` are caches; the truth is in `job_events` and the immutable child tables. Manual overrides live here, never on the analysis, so system output is never rewritten.

### `job_alerts` (the "job source" concept)
- **Purpose:** Every time a job appears in an alert email. Needed for source quality analytics and false-positive measurement.
- **Fields:** `id`, `job_id`, `gmail_message_id` + `item_index` (unique together), `alert_name` (saved search name), `received_at`, `snippet`, `budget_text`, parsed budget fields, `posted_at`, `prelim_score`, `prelim_decision` (`qualified | rejected`), `prelim_reasons` (text[]), `screening_config_id`, `workflow_run_id`.

### `job_listings`
- **Purpose:** Immutable snapshots of the full listing the user pasted. Re-pasting an updated listing adds a row.
- **Fields:** `id`, `job_id`, `raw_text`, `text_hash` (unique per job), `source_url`, `char_count`, `created_at`.

### `job_analyses` (immutable)
- **Purpose:** One completed full analysis of one listing snapshot under one configuration.
- **Fields:** `id`, `job_id`, `listing_id`, `workflow_run_id`, `config_snapshot_id`, extracted facts as typed columns (`budget_type`, `budget_min`, `budget_max`, `hourly_min`, `hourly_max`, `connect_cost`, `client_payment_verified`, `client_country`, `client_total_spend`, `client_hires`, `client_rating`, `proposals_min`, `proposals_max`, `job_category`, `skills` text[]), `features` jsonb + `feature_schema_version` (boolean signals such as `mentions_existing_codebase`), `hard_filter_pass`, `hard_filter_reasons` text[], `red_flag_penalty`, `system_score`, `system_disposition`, `summary`, `strengths` text[], `risks` text[], `reasoning`, `proposal_strategy` jsonb, `extraction_model`, `analysis_model`, `fallback_used`, `raw_result` jsonb, `created_at`.
- **Decision:** Immutable and versioned by append. Re-analysis creates a new row; `jobs.current_analysis_id` points at the one in use. This preserves "original score" for learning and makes scoring-version comparisons possible. Failed analyses do not create rows; the failure lives on the run.

### `analysis_scores`
- **Purpose:** Score components, queryable per dimension.
- **Fields:** `analysis_id`, `dimension` (enum: `technical_fit`, `budget`, `client_quality`, `long_term_potential`, `communication_quality`, `competition`, `strategic_fit`), `score` (0 to 10), `weight` (as applied), `rationale`. Primary key (`analysis_id`, `dimension`).
- **Why a table, not columns:** weights and dimensions are versioned config; a child table survives adding a dimension without a migration on every historical row.

### `proposal_versions` (immutable)
- **Purpose:** Every proposal text ever produced for a job.
- **Fields:** `id`, `job_id`, `version_number` (unique per job, sequential), `parent_version_id`, `analysis_id`, `origin` (`generated | regenerated | manual_edit`), `instructions`, `body`, `strategy` jsonb (angle, case study, questions), `strategy_model`, `writer_model`, `fallback_used`, `config_snapshot_id`, `workflow_run_id` (null for manual edits), deterministic metrics computed by Next.js at insert: `char_count`, `word_count`, `paragraph_count`, `question_count`, `em_dash_count` (must be 0 to submit), `created_at`.

### `applications`
- **Purpose:** The real-world submission. This is the record that answers "which exact version was submitted" and that outcomes attach to.
- **Fields:** `id`, `job_id` (unique), `proposal_version_id` (not null), `submitted_at`, `connects_spent`, denormalized milestones `viewed_at`, `responded_at`, `interviewed_at`, `offered_at`, `won_at`, `closed_at`, `close_reason` (`rejected | no_response | job_closed | withdrawn | other`), `contract_value`, `contract_type`.
- **Rule:** The text the user submits must be a stored version. If the user edits before submitting, the edit is saved as a `manual_edit` version first, and that version is the one recorded. The UI "Copy" action copies a specific version, so clipboard text and recorded text cannot drift.

### `job_events` (append-only)
- **Purpose:** Full timeline and audit log: stage transitions, decisions, overrides, outcomes, run completions.
- **Fields:** `id`, `job_id`, `type` (enum), `from_stage`, `to_stage`, `actor` (`owner | system | n8n`), `occurred_at` (user-supplied for outcomes), `recorded_at`, `workflow_run_id`, `payload` jsonb, `idempotency_key` (unique, nullable).

### `workflow_runs`
- **Purpose:** Every request to n8n, its lifecycle, and its correlation ID. Also the operational log for workflow health.
- **Fields:** `id` (the correlation ID sent to n8n), `kind` (`intake_scan | analyze | generate_proposal | learning_interpret`), `job_id` (nullable), `status` (`queued | running | succeeded | failed | timed_out`), `contract_version`, `request` jsonb (secrets stripped), `result` jsonb, `error_code`, `error_message`, `retryable`, `callback_token_hash`, `n8n_execution_ref` (opaque, for debugging links only), `attempt`, `retry_of_run_id`, `requested_at`, `started_at`, `finished_at`, `deadline_at`, `late_callback` (boolean).
- **Constraint:** partial unique index on (`job_id`, `kind`) where status in (`queued`, `running`) to prevent double-clicks starting duplicate LLM runs.

### `config_snapshots`
- **Purpose:** Records exactly which workflow, prompt, scoring, and model versions produced each result, without the Command Center owning prompt text yet.
- **Fields:** `id`, `content_hash` (unique), `workflow_version`, `scoring_version`, `scoring_weights` jsonb, `screening_version`, `extraction_prompt_version`, `analysis_prompt_version`, `proposal_prompt_version`, `models` jsonb, `first_seen_at`.
- **How it fills:** every n8n result includes a `versions` block; Next.js upserts by hash and links the result row. Phase 2 (learning) may move config content into the Command Center; this table is shaped so that is additive.

### `learning_runs`, `learning_observations`, `learning_recommendations`
Defined in Section 10. Created when the learning milestone starts, not in the first migration.

### Pipeline stage model

Stage describes **where the job is in your process**. Workflow run status ("analysis running") is separate and never stored as a stage.

| Stage | Meaning | Entered by |
|---|---|---|
| `discovered` | From an alert, preliminary screen qualified, awaiting your triage | intake callback |
| `screened_out` | From an alert, preliminary screen rejected (restorable) | intake callback |
| `dismissed` | You dismissed it at intake, with reason | owner |
| `reviewing` | Full listing pasted; analysis pending or done | owner |
| `declined` | You decided not to apply after analysis, with reason | owner |
| `drafting` | At least one proposal version exists | proposal callback or manual edit |
| `submitted` | Application recorded | owner |
| `responded` | Client replied | owner |
| `interviewing` | Interview happened or scheduled | owner |
| `won` | Contract started | owner |
| `lost` | Closed without contract (`close_reason` says why, including `no_response`) | owner |
| `withdrawn` | You withdrew | owner |

`viewed` and `offer` are milestones (events plus `applications` timestamps), not stages. Transitions are validated by one server-side function; stages never regress except by an explicit "reopen" event. Mapping from current n8n statuses: `INGESTED/ANALYZED/LOW/REJECT_HARD` map to `reviewing` with the disposition on the analysis; `PROPOSAL_READY/NEEDS_EDIT/READY_TO_SUBMIT` map to `drafting`; `SKIPPED` maps to `declined`; `REPLIED`, `INTERVIEW`, `CONTRACT` map directly; `REJECTED/GHOSTED` map to `lost`.

---

## 5. n8n Integration Contract

### Principles
- Contracts are named and versioned (`ujh.analyze.v1`), defined once as Zod schemas in the Command Center, and exported as JSON Schema (`z.toJSONSchema`) and JSON fixtures for the n8n side.
- n8n workflows are **request in, result out**. They receive everything they need and never look up Command Center state.
- Contracts reference business concepts only. No node IDs, node names, or Data Table IDs ever cross the boundary. `n8n_execution_ref` is stored as an opaque string for debugging only.

### Dispatch request (Next.js to n8n)

`POST {N8N_BASE_URL}/webhook/ujh-cc/analyze` with header `X-UJH-Token: <N8N_WEBHOOK_TOKEN>`.

```json
{
  "contract": "ujh.analyze.v1",
  "run_id": "0192f0c4-7a1e-7c3b-9a55-3f1d2b8e4c10",
  "requested_at": "2026-10-02T14:03:11Z",
  "callback": {
    "url": "https://command.example.com/api/integrations/n8n/callback",
    "token": "rt_9f2c...per-run-random"
  },
  "job": {
    "id": "0192f0b1-1111-7000-8000-000000000001",
    "upwork_ref": "~01a2b3c4d5e6f7",
    "source_url": "https://www.upwork.com/jobs/~01a2b3c4d5e6f7"
  },
  "input": {
    "listing_id": "0192f0c3-2222-7000-8000-000000000002",
    "listing_text": "Full pasted listing text..."
  }
}
```

### Acknowledgement (synchronous, under 10 seconds)

```json
{ "accepted": true, "run_id": "0192f0c4-7a1e-7c3b-9a55-3f1d2b8e4c10", "execution_ref": "48211" }
```

Validation failures are answered synchronously: `400 {"accepted": false, "error": {"code": "INVALID_INPUT", "message": "listing_text is required"}}`.

### Result callback (n8n to Next.js)

`POST /api/integrations/n8n/callback` with header `Authorization: Bearer <N8N_CALLBACK_TOKEN>`.

```json
{
  "contract": "ujh.analyze.v1",
  "run_id": "0192f0c4-7a1e-7c3b-9a55-3f1d2b8e4c10",
  "callback_token": "rt_9f2c...per-run-random",
  "status": "succeeded",
  "completed_at": "2026-10-02T14:04:02Z",
  "versions": {
    "workflow": "analyze@2026.10.02",
    "scoring": "score-v1",
    "extraction_prompt": "extract-v1",
    "analysis_prompt": "analysis-v1",
    "scoring_weights": { "technical_fit": 0.25, "budget": 0.15, "client_quality": 0.15, "long_term_potential": 0.1, "communication_quality": 0.1, "competition": 0.1, "strategic_fit": 0.15 }
  },
  "models": { "extraction": "claude-haiku-4-5-20251001", "analysis": "claude-sonnet-4-6", "fallback_used": false },
  "result": {
    "facts": {
      "budget_type": "fixed", "budget_min": 3000, "budget_max": 5000,
      "connect_cost": 16, "client_payment_verified": true, "client_country": "US",
      "client_total_spend": 42000, "client_hires": 18, "client_rating": 4.9,
      "proposals_min": 10, "proposals_max": 15,
      "job_category": "web_app", "skills": ["Next.js", "TypeScript", "PostgreSQL"]
    },
    "features": { "schema_version": 1, "mentions_existing_codebase": true, "long_term_signal": true },
    "hard_filter": { "pass": true, "reasons": [] },
    "scores": [
      { "dimension": "technical_fit", "score": 9, "rationale": "Next.js and Postgres are core skills." },
      { "dimension": "budget", "score": 7, "rationale": "Fixed budget fits estimated scope." }
    ],
    "red_flag_penalty": 0,
    "system_score": 8.1,
    "disposition": "PRIORITY",
    "summary": "Established client extending an existing Next.js app.",
    "strengths": ["Verified payment", "Repeat hiring history"],
    "risks": ["Scope of legacy code unknown"],
    "reasoning": "Plain-language explanation...",
    "proposal_strategy": { "angle": "Production Next.js maintenance", "case_study": "acme-dashboard", "questions": ["Which Next.js version is the codebase on?"] }
  },
  "usage": null
}
```

Failure callback:

```json
{
  "contract": "ujh.analyze.v1",
  "run_id": "0192f0c4-7a1e-7c3b-9a55-3f1d2b8e4c10",
  "callback_token": "rt_9f2c...per-run-random",
  "status": "failed",
  "completed_at": "2026-10-02T14:05:40Z",
  "error": { "code": "MODEL_ERROR", "stage": "analysis", "message": "Primary and fallback models failed", "retryable": true }
}
```

Error codes (closed enum): `INVALID_INPUT`, `LISTING_INCOMPLETE`, `UPSTREAM_UNAVAILABLE` (Gmail, model provider), `MODEL_ERROR`, `MODEL_OUTPUT_INVALID`, `TIMEOUT`, `INTERNAL`. A hard-filter failure is a **successful** analysis with `hard_filter.pass = false`, not an error.

### Other contracts (shape only)
- `ujh.intake_scan.v1`: input `{since, max_messages}`; result `{scanned_messages, items: [{gmail_message_id, item_index, received_at, alert_name, upwork_ref, url, title, snippet, budget_text, posted_at, prelim: {score, decision, reasons}}], cursor: {latest_received_at}}`.
- `ujh.generate_proposal.v1`: input `{analysis: {facts, summary, risks, proposal_strategy}, listing_text, base_version: {number, body} | null, instructions | null}`; result `{body, strategy, models: {strategy, writer, fallback_used}, sanitizer: {em_dashes_removed}}`. Next.js recomputes metrics and rejects any body with an em dash as `MODEL_OUTPUT_INVALID`.
- `ujh.health.v1`: synchronous echo used by the dashboard's workflow health indicator. Returns workflow versions. No LLM calls.

### Authentication
- **Next.js to n8n:** n8n Webhook node Header Auth credential, header `X-UJH-Token`. One secret, stored as an n8n credential and as `N8N_WEBHOOK_TOKEN` in Next.js.
- **n8n to Next.js:** a different secret, `N8N_CALLBACK_TOKEN`, sent as a bearer token. Plus the **per-run callback token**: Next.js generates a random token per run, stores only its hash, and accepts a callback only if the hash matches and the run is not already terminal. This gives forgery and replay protection without asking n8n to compute HMACs over serialized JSON (fragile in n8n without Code nodes).
- The callback route is excluded from Clerk page protection but still requires both tokens.
- n8n validates `callback.url` against an allowlisted prefix in its config so a leaked webhook token cannot redirect results elsewhere.

### Correlation
`run_id` is generated by Next.js, appears in the request, the callback, Next.js logs, Sentry tags, and (by n8n convention) in error messages captured by W99. It is the only correlation key.

### Idempotency
- **Dispatch:** at most one active run per (`job_id`, `kind`), enforced by the partial unique index. A double click returns the existing run.
- **Callback:** the first valid terminal callback wins; repeats for a terminal run return `200 {"duplicate": true}` with no writes. All result writes happen in one transaction keyed by `run_id`.
- **Intake items:** upsert by `upwork_ref` (or fingerprint), insert `job_alerts` with `ON CONFLICT (gmail_message_id, item_index) DO NOTHING`. Overlapping scan windows are therefore harmless.
- **Owner mutations** (mark submitted, outcomes): natural unique constraints (`applications.job_id`) and optional `idempotency_key` on events.

### Retries and timeouts
- **Dispatch timeout:** 10 seconds for the acknowledgement. On connection error or 502/503, retry once with the same `run_id`. A duplicate execution in n8n costs tokens but cannot double-write because of callback idempotency.
- **Run deadline:** per kind (initial values: intake 5 min, analyze 5 min, proposal 5 min; tune after measuring real durations). A run past its deadline is marked `timed_out` lazily when read. A valid late callback may still move `timed_out` to `succeeded` and sets `late_callback = true`, because the result is valuable and the write is idempotent.
- **LLM retries stay in n8n** (it already retries and falls back). Next.js never auto-retries a failed LLM run. "Retry" in the UI creates a new run with `retry_of_run_id`.
- **n8n errors before callback:** W99 (or a CC-specific error path) should post a failure callback when it can extract `run_id`. Otherwise the deadline covers it.
- **Response validation:** every callback is parsed with the contract's Zod schema. Invalid payloads mark the run `failed` with `MODEL_OUTPUT_INVALID` or `INTERNAL`, keep the raw body in `workflow_runs.result`, and alert via Sentry.

---

## 6. API Boundary

### Pattern
- **Route handlers** under `src/app/api/` for all client reads and mutations. This matches the existing `service.ts -> apiClient -> route handler` reference pattern, keeps HTTP semantics explicit, and is directly testable. Server Actions are not used for this domain: they are POST-only, serialized per client, and add a second calling convention.
- A **server-only domain layer** (proposed `src/server/`: `db/`, `jobs/`, `runs/`, `n8n/`) holds all logic. Route handlers are thin: authenticate, parse with Zod, call domain function, map to HTTP.
- **Server-side prefetch** in pages calls domain read functions directly with the same query keys used by client `queryOptions`, avoiding a server-to-itself HTTP hop. Client `service.ts` files call `/api/*` through `apiClient`.
- Every handler except the n8n callback calls one `requireOwner()` guard.

### Initial endpoints

| Endpoint | Owns |
|---|---|
| `GET /api/dashboard/summary` | Counts, funnel snapshot, active runs, recent events |
| `POST /api/intake/scans` | Create and dispatch an `intake_scan` run; returns `202 {runId}` |
| `GET /api/intake` | Intake queue (filters, sort, pagination via nuqs params) |
| `POST /api/jobs` | Create a job from a manual paste (no alert) |
| `GET /api/jobs` | Pipeline list by stage and filters |
| `GET /api/jobs/:id` | Job detail: current analysis, versions, application, timeline, active runs |
| `POST /api/jobs/:id/transitions` | Owner stage decisions: `dismiss`, `restore`, `review`, `decline`, `reopen`, with reason |
| `POST /api/jobs/:id/listings` | Store an immutable listing snapshot |
| `POST /api/jobs/:id/analyses` | Create and dispatch an `analyze` run; `202 {runId}` |
| `PUT /api/jobs/:id/override` | Manual score and disposition with reason |
| `POST /api/jobs/:id/proposal-runs` | Generate or regenerate (with instructions, base version); `202 {runId}` |
| `POST /api/jobs/:id/proposal-versions` | Save a manual edit as a new version (synchronous) |
| `POST /api/jobs/:id/application` | Mark submitted with exact `proposalVersionId` |
| `POST /api/jobs/:id/events` | Record outcome milestones (`viewed`, `responded`, `interview`, `offer`, `won`, `lost`, `withdrawn`) |
| `GET /api/workflow-runs/:id` | Run status for polling |
| `GET /api/workflow-runs?active=1` | Active runs for dashboard indicators |
| `POST /api/integrations/n8n/callback` | Machine-only; verifies tokens, validates contract, writes result transactionally |

Later: `/api/analytics/*`, `/api/learning/*`, `/api/settings/health`.

The existing `/api/products` and `/api/users` reference handlers stay untouched until those features are replaced.

---

## 7. Authentication and Secrets

### Trust boundaries
1. **Browser (untrusted).** Holds only the Clerk session cookie and public config.
2. **Next.js server (trusted).** Holds Clerk secret, database URL, n8n tokens.
3. **n8n (trusted for execution, not for state).** Holds Gmail, LLM, and Slack credentials. Has no database access.
4. **Callback channel (verified per request).** n8n is authenticated by bearer token plus per-run token.

### Single-owner enforcement
Clerk authenticates. Authorization is one rule: the session's user ID must equal `OWNER_CLERK_USER_ID`. Also restrict sign-ups in the Clerk dashboard (restricted or allowlist mode). This is a single equality check, not a role system.

### Secret ownership

| Secret | Lives in | Never in |
|---|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Next.js build env (public by design) | n/a |
| `CLERK_SECRET_KEY` | Next.js server env | n8n, browser |
| `OWNER_CLERK_USER_ID` | Next.js server env | browser bundle |
| `DATABASE_URL` (pooled), `DATABASE_URL_DIRECT` (migrations) | Next.js server env; CI secret for migrations | n8n, browser |
| `N8N_BASE_URL` | Next.js server env | browser |
| `N8N_WEBHOOK_TOKEN` | Next.js env and n8n Header Auth credential (shared secret, unavoidable duplication) | browser |
| `N8N_CALLBACK_TOKEN` | n8n credential and Next.js env | browser |
| Per-run callback token | Generated per run; hash in Postgres | logs |
| Anthropic / OpenAI keys | n8n credentials only | Next.js, browser |
| Gmail OAuth | n8n credential only | Next.js, browser |
| Slack tokens | n8n credentials only | Next.js |
| n8n API key (generator scripts) | Developer machine only | Next.js, CI for this repo |
| `NEXT_PUBLIC_SENTRY_DSN` | Next.js build env (DSN is not a secret) | n/a |
| `SENTRY_AUTH_TOKEN` | CI/build env only | runtime |

Server env vars are parsed once at startup with a Zod schema in a server-only module so a missing secret fails fast and no secret is importable from client code.

The Command Center does **not** use the n8n REST API. That API exposes node-level internals and would couple the app to n8n's implementation.

---

## 8. Workflow Run Model

### Decision: asynchronous for every n8n operation
Analysis and proposal generation take roughly one minute today (the user guide says "about a minute"; fixture runs average about one minute per job). That is too long to hold a browser request open reliably, especially on serverless hosts, and a dropped connection would lose the result. Using one async path for everything (even fast operations) means one code path, one test harness, and one UI pattern.

### States

```mermaid
stateDiagram-v2
  [*] --> queued: run row inserted
  queued --> running: n8n returned 202
  queued --> failed: dispatch failed (after 1 retry)
  running --> succeeded: valid success callback
  running --> failed: failure callback or invalid payload
  running --> timed_out: deadline passed (evaluated on read)
  timed_out --> succeeded: valid late callback
  succeeded --> [*]
  failed --> [*]
```

- **Queued:** row exists, dispatch in progress. Usually lasts milliseconds; visible only if n8n is slow to acknowledge.
- **Running:** n8n accepted. Optional later enhancement: n8n posts `status: "progress"` callbacks with a `stage` (`extracting`, `scoring`, `writing`) to drive step indicators. Not required for v1.
- **Completed (`succeeded`):** result persisted in the same transaction as the status change, so the UI never sees "completed" without data.
- **Failed / timed out:** error code and retryability shown; "Retry" creates a linked new run.

### UI update mechanism
React Query `useQuery` on `GET /api/workflow-runs/:id` with `refetchInterval` of 2 seconds while non-terminal, stopping on a terminal status, then invalidating the job or intake queries. For one user with at most a few concurrent runs, this is a trivial load.

### Rejected alternatives
- **Synchronous webhook response:** timeouts, lost results on disconnect, blocks serverless functions for a minute.
- **Polling n8n's execution API:** couples to n8n internals and requires the n8n API key in Next.js.
- **Server-Sent Events / WebSockets:** awkward on serverless, needs a pub/sub layer to fan callbacks out to connections, and buys about one second of latency for a single user. Revisit only if polling becomes visibly inadequate.
- **Job queue (BullMQ, Inngest, etc.):** n8n already is the execution queue. Adding another would duplicate it.

### Local development caveat
Hosted n8n cannot call back to `localhost`. Options: a tunnel (for example Cloudflare Tunnel) when testing against real n8n, or `N8N_MODE=fake`, a local fake that answers dispatches and posts fixture callbacks. The fake is also what tests and CI use.

---

## 9. Information Architecture

Recommendation: **four primary routes**, not one per product area. Job Analysis and Proposal Workspace are the same job context and belong on one detail page.

| Route | Screen | Primary actions |
|---|---|---|
| `/dashboard/overview` | Dashboard | Check Upwork Alerts, jump to queue, resume in-progress jobs |
| `/dashboard/intake` | Intake queue | Open on Upwork, Review (promote), Dismiss with reason, Restore |
| `/dashboard/jobs` | Pipeline | Filter by stage, open job |
| `/dashboard/jobs/[jobId]` | Job workspace (sections: Listing, Analysis, Proposal, Timeline; `?tab=` via nuqs) | Paste listing, Analyze, Override, Decline, Generate, Regenerate with instructions, Edit, Copy version, Mark submitted, Record outcome |
| `/dashboard/analytics` | Analytics, later Learning tab | Read-only first; later review recommendations |
| `/dashboard/settings` | Only when needed: workflow health, config versions in use | Read-only initially |

### Dashboard
- Primary CTA: **Check Upwork Alerts**, showing last scan time and live run state.
- Counters for a selectable window: alerts scanned, qualified, awaiting review, analyzed, proposals generated, submitted, responses, interviews, won.
- **Needs attention** list: qualified and unreviewed, analyzed but undecided, drafts not submitted, submitted with no update after N days.
- Workflow health: last success and failure per run kind, active runs, `ujh.health.v1` result.
- Recent activity from `job_events`.
- Learning status placeholder: "N submissions recorded; observations start at the minimum sample size."

### Intake
TanStack Table: title, alert name, received, budget, preliminary score, decision, reasons. Tabs or filter for Qualified / Screened out / Dismissed with counts per scan. Row actions: **Open on Upwork** (plain external link, new tab), **Review** (moves to `reviewing`, opens job workspace on the Listing tab with a paste box), **Dismiss** (reason select plus note). Screened-out jobs stay visible and restorable so false negatives can be spotted.

### Job workspace
- **Listing:** paste area, character count, snapshot history.
- **Analysis:** total score (count-up), disposition, hard filter result, seven dimension bars with rationale and weight, facts (budget, client, competition, Connects), strengths, risks, reasoning, proposal strategy. Manual override control. Analysis history selector if re-analyzed. Actions: **Decline**, **Generate proposal**.
- **Proposal:** current version body, word and character counts, em dash check (blocking), version list with origin and instructions, diff against previous version, regeneration instructions field, **Copy**, **Edit** (saves a new version), **Mark submitted** (confirms the exact version, Connects spent, submitted time).
- **Timeline:** `job_events` plus run history.

### Pipeline
Table first (stage filter, columns for score, submitted date, latest milestone). A board view is a later enhancement once there is enough data to make it useful.

### Analytics (initial release scope)
Funnel (submitted to responded to interviewing to won) with counts and rates, score bucket versus outcome, source (alert name) quality. Everything else waits for data volume.

---

## 10. Learning Architecture

### Terminology
This is **observational statistical analysis with LLM-written interpretation**, not machine learning. Nothing is trained. The system computes descriptive statistics and comparisons in SQL, an LLM (through n8n) turns computed numbers into readable observations and candidate recommendations, and a human decides.

### Data preserved from day one (so no schema redesign later)
- Original system score, components, weights, and config snapshot per analysis (immutable).
- Manual overrides separate from system output.
- Preliminary intake decision per alert item, linked to the job's later full analysis and outcome (false-positive rate; a sampled false-negative check is possible by occasionally reviewing screened-out jobs).
- Typed client, budget, competition, and skill facts per analysis, plus a versioned `features` set.
- Every proposal version with origin, instructions, models, prompt version, and deterministic text metrics; the exact submitted version.
- Outcome milestones with real-world timestamps.
- Source alert name per sighting.

### Later tables
- `learning_runs`: `id`, `started_at`, data window, population filter (for example excludes test data), metric definitions version, `workflow_run_id` for the interpretation step.
- `learning_observations` (immutable): `learning_run_id`, `metric` (for example `interview_rate`), `segment_definition` (for example `features.mentions_existing_codebase = true`), `comparison_definition`, `observed_n`, `observed_successes`, `comparison_n`, `comparison_successes`, rates, `method` (`two_proportion`, `fisher_exact`), interval bounds (Wilson 95 percent), `p_value`, `confidence_label` (`insufficient | weak | moderate | strong`, from fixed thresholds), `supporting_query`, `supporting_data` jsonb, `interpretation` (LLM text), `config_snapshot_ids` in scope.
- `learning_recommendations`: `id`, `title`, `rationale`, linked observations (join table), `target` (`scoring_weights | screening_rules | proposal_prompt | analysis_prompt`), `current_version`, `proposed_change` (text or structured diff), `status` (`proposed | accepted | rejected | superseded | applied`), `decided_at`, `decision_note`, `applied_config_snapshot_id`.

### Guardrails
- Minimum sample size per comparison (the existing suite uses 20); below it, observations are stored as `insufficient` and not turned into recommendations.
- Always show n, both populations, interval, and method next to any claim.
- Flag multiple comparisons (many segments tested on small data will produce false patterns) and label all findings as correlational.
- "Accepted" does not change anything automatically. Applying a change is a separate human action that produces a new config version; the recommendation records which version it led to.

---

## 11. Testing Strategy

### Stack
- **Vitest** for unit and integration tests. Chosen over `bun test` for mature jsdom support, React Testing Library integration, and Next.js ecosystem examples; tests still run via `bun run test`.
- **React Testing Library** sparingly, for components with real logic (proposal editor validation, mark-submitted dialog, run status indicator).
- **Playwright** for a small number of end-to-end flows, using Clerk's testing tokens and `N8N_MODE=fake`.
- **GitHub Actions** for CI.

### Levels

| Level | What | Dependencies |
|---|---|---|
| Unit | Stage transition rules, deterministic text metrics and em dash check, contract Zod schemas against fixtures, env schema, query key factories | none |
| Integration | Domain functions and route handlers against a real Postgres: dispatch creates run, callback writes analysis transactionally, duplicate and late callbacks, active-run guard, owner guard rejects other users | Postgres (CI service container), fake n8n transport |
| Contract | Shared fixtures (`contracts/fixtures/*.json`) validated by Zod in this repo; the same fixtures and generated JSON Schemas are consumed by the n8n repo's test harness to validate real workflow outputs | none in this repo; live n8n in the n8n repo |
| E2E | Paste, analyze, view analysis, generate, copy, mark submitted; intake scan populates queue | built app, Postgres, fake n8n |
| Live smoke | One real analyze run against test n8n workflows | manual or scheduled, never on every PR |

The n8n client takes an injectable transport, so integration tests run without network access. The fake n8n replays fixture callbacks (success, failure, invalid payload, late callback) through the real callback route.

### CI sequence (GitHub Actions, Node 24, Bun)
1. `bun install --frozen-lockfile`
2. `bun run format:check`
3. `bun run lint:strict`
4. `bun run typecheck`
5. Unit and integration tests (Postgres service, migrations applied first)
6. `bun run build`
7. Playwright e2e against the built app with fake n8n (on PRs to `main`, optional on `development`)

Migrations run in CI against the ephemeral database on every PR so a broken migration fails before merge.

---

## 12. Technology Decisions

### PostgreSQL
- **Decision:** Managed PostgreSQL (Neon, Supabase used as plain Postgres, or Postgres on the existing VPS), chosen once the deployment target is decided.
- **Why:** Relational integrity for versioned entities, strong analytics SQL (window functions, `FILTER`, CTEs), `jsonb` for raw payloads.
- **Rejected:** n8n Data Tables (cannot be the system of record; weak querying); SQLite (fine locally, awkward on serverless hosting and for concurrent callback writes).
- **Tradeoff:** One more managed service to run and back up.

### ORM / data layer
- **Decision:** Drizzle ORM with `drizzle-kit` generated SQL migrations, committed and reviewed.
- **Why:** TypeScript schema with no code generation step or engine binary, SQL-shaped query builder that suits analytics, raw `sql` templates when needed, small abstraction, works the same under Node and Bun, and migrations are plain SQL files you can read.
- **Rejected:** Prisma (excellent DX and migrations, but a separate schema language, a generate step, and a heavier abstraction; analytics queries end up in raw SQL anyway). Kysely (good query builder, but no schema-to-migration tooling, so more manual work).
- **Tradeoff:** Drizzle's relational query API and migration tooling are younger than Prisma's; some complex migrations need hand-edited SQL.

### Node version
- **Decision:** Standardize on **Node 24 LTS** (update `.nvmrc`, `@types/node`, and add `engines` in a later foundation commit).
- **Why:** Local is already 24. Node 22 reaches end of life in April 2027, within this project's expected life. Next.js 16.2 and `@clerk/nextjs` 7.8 require Node 20.9 or later; oxlint requires 20.19 or later or 22.12 or later; Node 24 satisfies all. GitHub Actions `setup-node` supports 24, and Vercel offers a 24.x runtime (confirm in project settings).
- **Rejected:** Node 22 (works today, but forces a migration within about 18 months). Node 26 (not yet LTS on this date; hosting support may lag; re-evaluate in 2027).
- **Tradeoff:** If the deployment target turns out to lack Node 24, this must be revisited.

### Bun usage
- **Decision:** Bun is the package manager and script runner (`bun.lock` is canonical). The application runtime is Node, in development and production.
- **Why:** Fast installs and an existing lockfile; Next.js, Clerk, Sentry, and database drivers are tested primarily on Node.
- **Rejected:** Bun as production runtime (`Dockerfile.bun`) and `bun test` (see Testing).
- **Tradeoff:** Two runtimes in the toolchain; CI must set up both.

### Animation
- **Decision:** No new library for the first milestones. Use the existing `tw-animate-css`, CSS transitions, `@starting-style` for entry animations, the existing View Transitions CSS, and a small `requestAnimationFrame` count-up hook. All motion respects `prefers-reduced-motion`. Introduce **Motion** (`motion/react`, the renamed Framer Motion, loaded via `LazyMotion`) only when a concrete need appears that CSS handles poorly: exit animations and layout animation for rows moving between pipeline stages.
- **Why:** The motion described (new rows entering, loading states, score count-up, status changes) is achievable in CSS; the main gap is animating removal and reordering.
- **Rejected:** Adding Motion now (speculative dependency). GSAP and similar (heavy, imperative, unnecessary).
- **Tradeoff:** Some animations will be hand-built until Motion is justified.
- Housekeeping note: both `tailwindcss-animate` and `tw-animate-css` are dependencies; only `tw-animate-css` is imported. Remove the unused one in a cleanup commit.

### Background workflow communication
- **Decision:** Async dispatch with 202 acknowledgement, authenticated callback, and client polling by run ID.
- **Why:** Reliable across disconnects and serverless limits, no new infrastructure, one code path, easy to fake in tests.
- **Rejected:** Synchronous webhook responses, SSE, WebSockets, n8n execution API polling, an extra job queue (Section 8).
- **Tradeoff:** Up to about two seconds of extra latency after completion; requires an HTTP Request node in n8n and a reachable callback URL.

### Route handlers over Server Actions
- **Decision:** Route handlers plus a server-only domain layer.
- **Why:** Matches the reference pattern, one calling convention, explicit status codes (202, 409), straightforward integration tests.
- **Rejected:** Server Actions as the primary mutation path.
- **Tradeoff:** Slightly more boilerplate per mutation.

---

## 13. Implementation Sequence

Vertical slices, each shippable and replacing part of the Slack workflow. Order differs from the brief: **paste-and-analyze comes before Gmail intake** because the analysis and proposal logic already exists in n8n, while Gmail intake is entirely new.

1. **Foundation.** Node 24 alignment, Vitest and Playwright scaffolding, GitHub Actions pipeline, server env schema, `requireOwner()` guard, Sentry enabled for server errors.
2. **Persistence.** Provision Postgres, add Drizzle, first migration: `jobs`, `job_listings`, `job_analyses`, `analysis_scores`, `job_events`, `workflow_runs`, `config_snapshots`.
3. **Run engine and contract skeleton.** n8n client with injectable transport, callback route, run polling endpoint, fake n8n, `ujh.health.v1` working end to end against real n8n (walking skeleton that proves auth, callback, correlation).
4. **Analyze slice.** n8n `ujh.analyze.v1` workflow (refactored from W01 extraction plus W02, stateless). UI: create job from paste, Analyze, live run state, analysis view, override, decline.
5. **Proposal slice.** `proposal_versions`, `applications`. n8n `ujh.generate_proposal.v1` (refactored W03). UI: generate, regenerate with instructions, edit, version history and diff, copy, mark submitted. At this point Slack is no longer needed for daily work.
6. **Outcomes and pipeline.** Outcome events, stage transitions, pipeline table, dashboard counters and needs-attention list.
7. **Intake slice.** Investigate Upwork alert email format, build n8n `ujh.intake_scan.v1` (Gmail, parsing, preliminary screening), `job_alerts`, Intake queue, dashboard CTA.
8. **Analytics.** Funnel, score versus outcome, source quality, proposal metrics versus outcome.
9. **Learning.** Learning tables, SQL metrics with intervals, n8n interpretation workflow (replacing W06), recommendation review UI.
10. **Retire Slack paths and reference features** once their replacements are proven.

---

## 14. Risks and Open Questions

### Decisions that can be made now (recommended as stated)
- Command Center is the only system of record; no dual writes; n8n gets no database access.
- Async run model with callback and polling; no SSE or WebSockets.
- Immutable analyses and proposal versions; `applications` references the exact version.
- Separate stage (process) from run status (execution).
- Route handlers plus server-only domain layer; owner guard on every handler.
- Contracts versioned and defined as Zod schemas with shared fixtures.
- Vitest, React Testing Library (limited), Playwright, GitHub Actions.
- No animation library initially.

### Questions requiring inspection of the existing n8n workflows
1. Which nodes in W01, W02, and W03 read or write Data Tables, and can their logic be moved into sub-workflows that accept data and return results without touching tables?
2. The exact Structured Output Parser schemas for extraction (W01), analysis (W02), and proposal plan (W03). These determine the typed columns on `job_analyses` and the contract `result` shapes.
3. Where the scoring formula and hard-filter rules execute, and whether they can return applied weights and version identifiers in the result.
4. Whether a workflow version identifier can be emitted (for example a constant set per deploy by the `build/` generators).
5. Measured execution durations for analyze and proposal runs (p50 and worst case) to set deadlines.
6. Whether n8n 1.121 Webhook nodes support "respond immediately" plus later processing in the way this design assumes, and the instance's concurrency limits.
7. How W99 can extract `run_id` and post a failure callback for Command Center runs.
8. Current webhook authentication on `/webhook/upwork/*` (appears to be none).
9. Gmail: which account receives Upwork alerts, whether a Gmail OAuth credential exists in n8n (none is listed today), and real sample alert emails (structure, whether links contain the job ciphertext, how many jobs per email).
10. What preliminary screening should use: deterministic rules on alert text, a cheap model, or both.
11. Which `upwork_config` keys are execution config (stay in n8n) versus state the Command Center should own later.
12. Volume and quality of existing `upwork_jobs` and `upwork_events` data (real versus `test_fixture`) to decide on a one-time import.
13. Whether token usage and cost can be returned now (README says no on 1.121) or after an n8n upgrade.

### Questions requiring your approval
1. Command Center as sole system of record, with n8n refactored to stateless request/response workflows (and n8n Data Tables frozen for Command Center-originated jobs).
2. Adding new Command Center-facing n8n workflows alongside the Slack ones during transition, versus modifying the existing ones in place.
3. Allowing HTTP Request nodes in n8n for result callbacks (one shared sub-workflow).
4. Slack's future: retire Slack intake after the proposal slice, keep it as notifications only, or keep both entry points (keeping both would require Slack intake to go through the Command Center API).
5. Data model choices: no separate `proposals` parent (versions plus `applications`), stage list in Section 4, dropping the "approve / ready to submit" step.
6. Proposal generation is always explicit (no automatic draft for PRIORITY jobs), at least initially.
7. Implementation order with paste-and-analyze before Gmail intake.
8. Owner enforcement: `OWNER_CLERK_USER_ID` check plus restricted Clerk sign-ups.
9. Drizzle ORM and the Postgres provider.
10. Deployment target (Vercel or the existing VPS/Docker), which affects Postgres hosting, connection pooling, and callback URL.
11. Node 24 standardization.
12. Whether to import historical n8n Data Table records.
13. Enabling Sentry (server-side at minimum) in the foundation milestone.
14. Development callback strategy: tunnel to real n8n, fake n8n only, or a separate n8n test environment.

### Risks
- **n8n refactor size.** Converting state-loading workflows to stateless ones is the critical path and is outside this repository.
- **Small samples.** A single freelancer produces tens of submissions per month; most learning observations will be `insufficient` or `weak` for months. The UI must say so plainly.
- **Alert email format drift.** Upwork can change its email template at any time; the parser lives in n8n and needs fixtures from real emails.
- **Callback reachability.** Any host change breaks callbacks until the allowlist and URL are updated; the run deadline makes this visible rather than silent.
- **Reference code drift.** The Product and Users examples are unauthenticated mock handlers; copying them without the owner guard would expose data.
