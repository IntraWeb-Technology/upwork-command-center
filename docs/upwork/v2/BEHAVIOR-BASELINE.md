# UJH V2 Behavior Baseline

This document defines protected V1 behavior that V2 must initially preserve. Refactoring implementation is allowed; silently changing these behaviors is not.

## Slack intake
- A root Slack message represents a new Upwork job.
- A thread reply represents a command for the job associated with that Slack thread.
- Ignore bot, app, and other non-human events.
- Deduplicate Slack deliveries.
- Acknowledge a new listing before processing.
- Detect and handle duplicate listings.
- Preserve the Slack thread association for the job.

## Protected commands

### Proposal
- `proposal`
- `proposal: <instructions>`
- `generate`

Explicit proposal generation may override ordinary score eligibility for LOW jobs.

### Regeneration
- `regenerate`
- `regen`
- `regenerate: <instructions>`

If no proposal exists, regeneration may enter the proposal-generation path.

### Human decision
- `approve`
- `approved`
- `edit: <proposal>`
- `skip`

Decision mappings:
- approve/approved -> SUBMIT decision and READY_TO_SUBMIT state
- edit -> EDIT decision and NEEDS_EDIT state
- skip -> SKIP decision and SKIPPED state

### Information
- `status`
- `help`
- `commands`

### Outcome tracking
- `submitted`
- `viewed`
- `replied`
- `interview`
- `offer`
- `contract`
- `rejected`
- `ghosted`
- `withdrawn`

Numeric arguments retain their current meanings, including:
- `submitted 26` -> 26 connects spent
- `contract 5000` -> contract value 5000

## Hard-filter baseline
Current intent includes hard rejection for:
- explicit exclusion of U.S. freelancers
- explicitly unverified payment when verified payment is required
- likely scam
- refused/disallowed conditions
- incomplete listing

Unknown is not false. Null or unavailable evidence must not automatically become a negative finding. In particular, `payment_verified = null` is not equivalent to `payment_verified = false`.

## Evaluation and scoring
AI evaluation supplies qualitative inputs including:
- technical_fit
- budget_score
- client_quality
- long_term_potential
- communication_quality
- competition_score
- strategic_fit
- red_flag_penalty

The final weighted score is calculated deterministically from configuration. Disposition is threshold-based:
- PRIORITY
- REVIEW
- LOW

Manual overrides supersede system-derived values.

## Behavioral invariants
- AI does not authoritatively mutate state.
- A forced proposal for a LOW job is supported.
- Optional proposal/regeneration instructions affect that requested draft, not global prompt configuration.
- VIEWED is an event, not a state.
- Lower-order outcome events must not regress a higher-order state.
- CONTRACT cannot later be downgraded to REJECTED, GHOSTED, or WITHDRAWN.
- REGENERATE does not independently change job state.
- Duplicate commands/events must not create unintended duplicate side effects.

Any intentional change to this baseline requires explicit approval and corresponding regression-test updates.
