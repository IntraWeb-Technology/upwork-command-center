# UJH V2 Architecture

## Purpose
UJH V2 rebuilds the Upwork Job Hunter / Revenue OS orchestration layer alongside V1. The objective is to preserve protected user-facing behavior while reducing workflow size, duplication, hidden expression logic, and unnecessary AI orchestration.

V1 remains available and unchanged until an explicitly approved production cutover.

## Architectural principles

### Smallest understandable implementation
Choose implementation mechanisms in this order:
1. Purpose-built official app/action node
2. Specialized n8n node
3. Simple orchestration node such as Switch, IF, Merge, or Edit Fields
4. HTTP Request when necessary
5. Small Code node when clearer than a large expression tree
6. Community/third-party node only after explicit dependency and security review

Zero Code nodes is not a goal. Clarity and maintainability are the goals.

### Deterministic logic before AI
Objective rules belong in deterministic workflow logic. This includes eligibility checks, hard disqualifiers, score thresholds, state transitions, current status, and command routing. AI must not control workflow topology, persistence, or authoritative state.

### AI has three bounded responsibilities
1. Extraction: convert an unstructured listing into structured facts.
2. Evaluation: provide qualitative judgments used as inputs to deterministic scoring.
3. Proposal writing: generate proposal text from the listing, evaluation, candidate evidence, case studies, proposal rules, and optional user instructions.

Prefer structured input -> model -> structured output -> deterministic routing. Do not use an AI Agent unless autonomous tool selection or multi-step external investigation is genuinely required.

### Model failure policy
Default policy: primary AI call -> retry transient error -> fail cleanly -> log.
Do not add speculative cross-model fallback paths without production evidence that they solve a recurring failure.

## Workflow responsibilities
- W00 — Slack Router
- W01 — Job Intake
- W02 — Job Evaluation
- W03 — Proposal Generator
- W04 — Human Decisions
- W05 — Outcome Tracker
- W06 — Performance Analyzer
- W99 — Error Handler

Each workflow should have one primary responsibility. Repeated capabilities belong in narrowly scoped shared service workflows.

## Initial shared services
- UJH V2 — SW — Get Config: canonical configuration loading.
- UJH V2 — SW — Load Job: canonical lookup by job_id.
- UJH V2 — SW — Log Event: canonical mapping and persistence to upwork_events.
- UJH V2 — SW — State Transition: authoritative validation and application of job-state transitions.

A Slack Response service may be added later only if real duplication justifies it. Do not create a generic Slack template engine.

## Complexity targets
Targets are design signals, not hard limits:
- W00: 12–15 functional nodes
- W01: 15–20
- W02: 12–18
- W03: 10–15
- W04: 10–15
- W05: 8–12
- W06: 15–25
- W99: 6–10

Expected V2 total: roughly 110–150 functional nodes versus approximately 256 in V1. Never reduce visible node count by hiding equivalent complexity inside giant expressions.

## Prompt governance
AI capabilities must record prompt versions at minimum:
- extractor_prompt_version
- evaluation_prompt_version
- proposal_prompt_version

Prompt changes are behavior changes and require regression testing.

## Observability
Executions should make it possible to identify:
- job_id
- workflow
- stage
- status
- started_at
- completed_at
- duration_ms
- model
- prompt_version
- error_type
- error_message
- execution_id

Never log credentials or secrets.

## Security
Credentials remain in n8n credential storage. Secrets must not appear in prompts, Slack messages, event payloads, Edit Fields values, or logs. Community nodes require explicit review and approval.

## Decision authority
Cursor may resolve ordinary implementation, wiring, expression, validation, retry, fixture, layout, and test failures autonomously.

Cursor must stop for a genuine decision involving architecture, schema migration, data-loss risk, scoring semantics, Slack command semantics, removal of supported behavior, a paid service, a community dependency, material credential/security changes, destructive action, or inability to preserve protected V1 behavior.
