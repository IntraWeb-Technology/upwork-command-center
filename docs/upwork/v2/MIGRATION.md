# UJH V2 Migration Plan

## Strategy
V2 is a parallel rebuild, not an in-place rewrite. V1 remains available throughout implementation and validation.

Do not switch production triggers until V2 passes regression and end-to-end testing and production cutover is explicitly approved.

## Phase order
1. Architecture documentation and Cursor rule
2. Shared Services
3. W00 Slack Router
4. W01 Job Intake
5. W02 Job Evaluation
6. W03 Proposal Generator
7. W04 Human Decisions + W05 Outcome Tracker
8. W06 Performance Analyzer + W99 Error Handler
9. End-to-end regression
10. Controlled cutover
11. Stabilization
12. Archive V1 only after explicit approval

## Phase 1 — Shared Services
Create:
- UJH V2 — SW — Get Config
- UJH V2 — SW — Load Job
- UJH V2 — SW — Log Event
- UJH V2 — SW — State Transition

Constraints:
- build alongside V1
- do not modify V1
- no schema changes
- no community dependencies
- preserve current persistence semantics
- ordinary implementation/test failures are resolved autonomously
- stop only for genuine architecture, schema, security, cost, destructive, or protected-behavior decisions

## Required regression scenarios before cutover
- valid new listing
- duplicate listing
- hard reject
- LOW
- REVIEW
- PRIORITY
- forced proposal for LOW
- proposal instructions
- regenerate
- regenerate with instructions
- human edit
- approve
- skip
- submitted
- viewed without state regression
- replied
- interview
- offer
- contract
- rejected
- ghosted
- withdrawn
- duplicate events
- AI failure
- invalid structured output
- Slack failure
- invalid job ID
- invalid state transition

## Cutover gate
Before production cutover, V2 must:
- pass regression testing
- pass end-to-end testing
- prove persistence and state behavior
- prove Slack intake/thread/command behavior
- prove proposal generation/review flow
- remain rollback-safe

Cutover requires explicit approval. Do not archive, disable, or destructively alter V1 as part of cutover preparation.

## Rollback
V1 remains the rollback path until V2 has stabilized and V1 archival is separately approved. Any cutover plan must identify exactly which production triggers are moved and how they can be restored without data loss.

## Prompt changes
Extractor, evaluation, and proposal prompt versions must be recorded. Prompt changes after baseline validation require regression testing because they are behavior changes.

## Completion reporting
Each implementation phase should report:
- workflows created/changed
- node counts
- tests performed and results
- any deviations from these docs
- unresolved risks
- whether V1 was touched
- whether schema, credentials, dependencies, or production triggers changed
