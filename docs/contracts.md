# n8n Integration Contracts

Versioned Zod contracts shared by the Command Center and the future Command Center-facing n8n workflows (`UJH-CC Analyze`, `UJH-CC Generate Proposal`, `UJH-CC Post Callback`). The Command Center owns state, n8n owns execution, and the browser never talks to n8n.

> **OPERATIONAL SAFETY RULE: DO NOT regenerate or deploy W01, W02, or W03 until generator drift has been reconciled.** See [n8n-refactor-plan.md](./n8n-refactor-plan.md) Section 16. These contracts describe the **target** Command Center workflows. The deployed Slack workflows do not emit them, and their recorded model labels are known to be wrong.

Background and rationale: [architecture-proposal.md](./architecture-proposal.md) Section 5 and [n8n-refactor-plan.md](./n8n-refactor-plan.md) Sections 9 to 14. Field names and vocabularies come from the live n8n exports (W01 Extraction Parser and Apply Hard Filters, W02 Analysis Parser and scoring nodes, W03 Proposal Parser), not from the generators.

## Layout

| Path | Contents |
|---|---|
| `src/contracts/common.ts` | Contract ids, opaque ids, timestamps, callback config, dispatch and callback base fields, error model, dispatch acknowledgement, model execution record |
| `src/contracts/analyze.ts` | `ujh.analyze.v1` request, result, versions, models, callback |
| `src/contracts/generate-proposal.ts` | `ujh.generate_proposal.v1` request, plan, result, versions, models, callback |
| `src/contracts/health.ts` | `ujh.health.v1` request and response |
| `src/contracts/callback.ts` | `callbackEnvelopeSchema`: every async callback, discriminated by `contract` then `status` |
| `src/contracts/index.ts` | Public entry point (`@/contracts`) |
| `src/contracts/json-schema.ts` | Deterministic JSON Schema builder |
| `contracts/json-schema/` | Generated JSON Schema (draft 2020-12). Never edit by hand. |
| `contracts/fixtures/<group>/<valid or invalid>/<kind>.<scenario>.json` | Synthetic fixtures. `kind` selects the schema (`request`, `callback`, `response`, `acknowledgement`). |

Contracts import only `zod`. They have no React, Clerk, route handler, or database dependencies, so server code, tests, and tooling can all import them. Each module exports the schema and its `z.infer` type side by side:

```ts
import { analyzeCallbackSchema, type AnalyzeCallback } from '@/contracts';
```

## Rules

- **Versioning.** Each contract has a literal id (`ujh.analyze.v1`). Parsing rejects any other value. A breaking change means a new literal (`v2`) alongside the old one, not an edit.
- **Strict objects.** Every object rejects unknown keys. A new field is a contract change, which surfaces drift instead of silently dropping data.
- **IDs are opaque.** `entityIdSchema` accepts any URL-safe identifier of up to 128 characters. The Command Center now generates UUIDv7 run IDs ([persistence.md](./persistence.md)); the contracts stay format-agnostic, so n8n must treat IDs as opaque strings.
- **No n8n internals.** No node names, node ids, Data Table ids, or Slack fields cross the boundary. `execution_ref` is an opaque debugging string.
- **Model metadata records what executed.** Each `modelExecutionSchema` record is `{ model, provider, fallback_used, primary_error }`. `model` must be the model that actually ran, reported from the same expression that configures the model node, never a separately read config label. `provider` is `null` unless n8n supplies it explicitly. `primary_error` is required exactly when `fallback_used` is true.
- **Cross-field rules live in Zod.** JSON Schema cannot express refinements (for example "analysis is null exactly when the hard filter failed"). Zod is authoritative; the JSON Schema is a structural aid for n8n.

## Dispatch and acknowledgement

Every async request carries `contract`, `run_id`, `requested_at`, and `callback: { url, token }`. `callback.token` is a single-use secret: never log it, never embed it in error messages. The CC webhook answers synchronously with `dispatchAcknowledgementSchema`: `{ accepted: true, run_id, execution_ref }`, or `{ accepted: false, error: { code: 'INVALID_INPUT', message } }`.

## Callback envelope

Every callback carries `contract`, `run_id`, `callback_token`, `completed_at`, `execution_ref`, and `status`.

- `status: 'succeeded'` adds `versions`, `models`, and a contract-specific `result`.
- `status: 'failed'` adds `error: { code, stage, message, retryable }` and nothing else.

Error codes (closed): `INVALID_INPUT`, `UPSTREAM_UNAVAILABLE`, `MODEL_ERROR`, `MODEL_OUTPUT_INVALID`, `TIMEOUT`, `INTERNAL`. `stage` is a per-contract closed enum or `null`. Messages are capped at 1000 characters and must not contain stack traces. `LISTING_INCOMPLETE` is not an error code; incomplete listings are a hard-filter outcome.

## `ujh.analyze.v1`

- **Request:** `job { id, upwork_ref | null, source_url | null }` and `input { listing_id, listing_text }`. The listing must be non-blank but has no minimum length, because short listings are rejected by the hard filter as `INCOMPLETE_LISTING` on a successful run. There is no trigger or force flag: the Command Center decides when to analyze.
- **Result:**
  - `extraction`: `{ status: 'ok', error: null, facts }` or `{ status: 'failed', error, facts: null }`. An extraction failure is still a successful run (matches live behavior).
  - `facts`: the live extraction schema. Every key is present; values the parser treats as optional are `null` when unknown.
  - `hard_filter`: `{ pass, reasons }`, where `pass` is true exactly when `reasons` is empty. Reasons are the live strings: `US_FREELANCERS_EXCLUDED`, `PAYMENT_EXPLICITLY_UNVERIFIED`, `LIKELY_SCAM` (optionally `: <signals>`), `REFUSED_CONDITION: <condition>`, `INCOMPLETE_LISTING`. `hardFilterReasonCode()` extracts the code.
  - `analysis`: `null` exactly when the hard filter failed. Otherwise it holds `scores` (the live dimension keys `technical_fit`, `budget_score`, `client_quality`, `long_term_potential`, `communication_quality`, `competition_score`, `strategic_fit`, each 0 to 10), partial `dimension_evidence`, `weighted_score`, `red_flag_penalty` (0 to 3), `system_score` (1 to 10), and `system_disposition` (`PRIORITY | REVIEW | LOW`), plus the live narrative fields.
  - There is no proposal strategy, `strengths`, `risks`, or `reasoning`. `REJECT_HARD` is derived by the Command Center from `hard_filter.pass = false`.
- **Versions (all required):** `workflow`, `scoring`, `extraction_prompt`, `analysis_prompt`, `profile_hash`, `scoring_weights` (all seven dimensions), `score_thresholds { priority, review }`, `hard_filter_rules`.
- **Models:** `extraction` (always), `analysis` (`null` exactly when `result.analysis` is `null`).
- **Error stages:** `input`, `config`, `analysis`, `scoring`.

## `ujh.generate_proposal.v1`

- **Request:**
  - `job { id, title, job_category, budget_type, budget_min, budget_max, hourly_min, hourly_max, connect_cost }`, `listing { id, text }`.
  - `analysis`: the seven fields the live prompts read, plus `id`. It is `null` when the owner requests a proposal without a completed analysis.
  - `base_version { number, body }` or `null`, and `instructions` or `null`.
  - No Slack fields, no status, no force flag, no version number. Every CC run is an explicit owner request, and the Command Center assigns version numbers.
- **Result:** `body` (non-blank, no U+2014 em dash), `strategy` (the live 11-field plan; `proposal_angle` and `opening_hook` non-blank), `sanitizer.em_dashes_removed`.
- **Em dashes:** `em_dashes_removed` is diagnostic only. The guarantee comes from the Command Center: this schema rejects an em dash in `body`, and the insertion path will recompute it again. Neither relies on the n8n sanitizer.
- **Versions:** `workflow`, `proposal_strategy_prompt`, `proposal_writer_prompt`, `profile_hash`. The live suite has one `proposal_prompt_version` key for both prompts, so both fields carry that value until separate keys exist.
- **Models:** `strategy` and `writer` are independent execution records, each with its own fallback flag and primary error.
- **Error stages:** `input`, `config`, `strategy`, `writer`, `validation`.

## `ujh.health.v1`

Synchronous, no callback. The request is `{ contract, requested_at }`. The response is `{ contract, status: 'ok' | 'degraded', checked_at, workflows: { analyze, generate_proposal, post_callback } }`, where each workflow value is the deployed version string or `null`. `status` is `ok` exactly when every workflow reports a version. The strict schema leaves no room for execution ids, credentials, node topology, or configuration.

## JSON Schema

```bash
bun run contracts:generate   # rewrite contracts/json-schema from the Zod sources
bun run contracts:check      # fail if the committed files are stale, missing, or extra
bun run test:contracts       # contract tests, including every committed fixture
```

Generation uses Zod's native `z.toJSONSchema` (no extra dependency) through a Vitest file, because the contracts use the `@/` path alias that plain Node cannot resolve. Output is deterministic (no timestamps) and excluded from the formatter. CI runs `contracts:check` and `test:contracts`.

## How n8n should consume this (future milestone)

- Validate inbound webhook bodies against `ujh.<contract>.request.json` and answer `400` with the rejected acknowledgement on failure.
- Build callbacks to match `ujh.<contract>.callback.json`, and test the workflows with the fixtures under `contracts/fixtures/`.
- Report models from the same expressions that configure the model nodes, and stamp `versions.workflow` from the generator.
- The Command Center still parses every callback with Zod, which also enforces the cross-field rules.
