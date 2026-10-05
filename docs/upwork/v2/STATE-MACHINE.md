# UJH V2 State Machine

## Canonical states
- INGESTED
- ANALYZED
- LOW
- PROPOSAL_READY
- NEEDS_EDIT
- READY_TO_SUBMIT
- SUBMITTED
- REPLIED
- INTERVIEW
- OFFER
- CONTRACT
- SKIPPED
- REJECT_HARD
- REJECTED
- GHOSTED
- WITHDRAWN
- ERROR

## Normal progression
```text
INGESTED -> ANALYZED

ANALYZED -> LOW
ANALYZED -> PROPOSAL_READY

PROPOSAL_READY -> NEEDS_EDIT
PROPOSAL_READY -> READY_TO_SUBMIT
NEEDS_EDIT -> READY_TO_SUBMIT

READY_TO_SUBMIT -> SUBMITTED
SUBMITTED -> REPLIED
REPLIED -> INTERVIEW
INTERVIEW -> OFFER
OFFER -> CONTRACT
```

## Command/event semantics
- SKIP transitions to SKIPPED.
- VIEWED is recorded as an event only; it is not a state.
- REGENERATE does not independently change state.
- SUBMITTED is initially allowed only from READY_TO_SUBMIT.
- Explicit proposal generation for LOW is supported and may enter the proposal-generation path despite ordinary score eligibility.
- Regenerate with no existing proposal may enter the proposal-generation path.

## Monotonic outcome rule
Outcome tracking must not regress a job from a more advanced successful state because a lower-order event arrives later. Examples:
- VIEWED after SUBMITTED does not change state.
- REPLIED after INTERVIEW does not move the job backward to REPLIED.
- INTERVIEW after OFFER does not move the job backward to INTERVIEW.
- CONTRACT must not later become REJECTED, GHOSTED, or WITHDRAWN.

## Terminal/exception states
SKIPPED, REJECT_HARD, REJECTED, GHOSTED, WITHDRAWN, and CONTRACT require explicit transition rules in the shared State Transition workflow. Do not infer new recovery paths or terminal-state exits.

ERROR represents a processing failure, not permission to discard the previous business state. Implementation must preserve enough context to recover or diagnose safely.

## Authority
`UJH V2 — SW — State Transition` is the authoritative transition validator and writer. Individual workflows must not reproduce competing transition tables.

## Invalid transitions
For an invalid transition:
1. do not mutate authoritative state
2. return an explicit rejected result and reason
3. log the invalid attempt when appropriate
4. allow the caller to provide a useful user-facing response

## Idempotency
Repeated delivery of the same command/event must not cause state regression or duplicate harmful side effects. A request whose target state already equals the authoritative state should be treated as a safe no-op unless existing V1 behavior requires additional event recording.

## Change control
Any new state, removed state, changed transition, or changed meaning of a state is an architecture/product decision. Stop for explicit approval and update this document plus regression coverage before implementation.
