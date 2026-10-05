# UJH V2 Data Contracts

## Scope
These contracts define the minimum stable boundaries between V2 workflows. They do not authorize a database schema change. Existing V1 persistence structures remain authoritative until separately inspected and explicitly changed.

## Contract rules
- Use `job_id` as the canonical workflow identifier for a job.
- Shared services return structured data, not Slack-formatted prose.
- Unknown values remain null/unknown rather than being coerced to false or zero.
- Workflows must not depend on undocumented incidental fields from another workflow.
- Persistence and state changes occur through canonical shared capabilities where defined.
- Secrets and credentials are never part of workflow payload contracts.

## Canonical job context
At workflow boundaries, pass the smallest context needed. When a full job context is required, normalize toward these logical groups:
- identity: job_id and external listing identifiers/URL when available
- source: listing text and source metadata
- Slack association: channel/thread identifiers required to preserve routing
- extracted facts: structured listing facts
- evaluation: qualitative AI outputs
- scoring: deterministic weighted score, disposition, and any manual override
- proposal: current draft plus proposal version/history references as supported by existing persistence
- lifecycle: current authoritative state
- outcome: connects spent, contract value, and tracked outcome metadata when applicable

Exact database column names must be taken from the existing schema/workflows, not invented from this document.

## Shared service contracts

### Get Config
Input:
- optional scope/key selector if the existing config model supports it

Output:
- normalized configuration required by the caller
- explicit success/failure signal

Requirements:
- one canonical implementation replaces repeated Load Config -> Build Config patterns
- do not silently invent defaults that change scoring or product behavior
- missing required config fails clearly

### Load Job
Input:
- `job_id` required

Output:
- found: true plus canonical persisted job data
- found: false for a valid but missing job
- clear error for invalid input or persistence failure

Requirements:
- lookup semantics are centralized
- callers do not independently reproduce job-loading queries

### Log Event
Input should support:
- `job_id`
- event type/name
- workflow
- stage
- status
- event-specific payload/metadata
- execution_id when available
- model and prompt_version when AI is involved
- error_type/error_message for failures

Output:
- persisted event identity/confirmation as supported by the current schema
- clear failure result

Requirements:
- map to the existing `upwork_events` structure
- do not log secrets
- preserve enough metadata to diagnose workflow behavior
- do not change job state merely because an event was logged

### State Transition
Input:
- `job_id`
- requested target state
- reason/source or command context when relevant
- execution metadata as appropriate

Output:
- previous_state
- resulting_state
- changed boolean
- accepted boolean
- rejection reason for invalid transitions

Requirements:
- this is the authoritative implementation of allowed transitions
- validate against STATE-MACHINE.md
- reject regressions and forbidden terminal-state downgrades
- idempotent requests for the already-current state should not create harmful duplicate side effects
- state persistence and transition-event logging must be consistent; implementation must not create a partially applied transition

## AI extraction contract
Extraction converts listing text to structured facts. The exact schema should be derived from current V1 fields before implementation. Required semantic rule: unknown evidence stays unknown.

## AI evaluation contract
AI returns qualitative judgments only. Expected semantic fields include:
- technical_fit
- budget_score
- client_quality
- long_term_potential
- communication_quality
- competition_score
- strategic_fit
- red_flag_penalty
- qualitative reasoning

Final weighted score and disposition are deterministic n8n logic using configuration.

## Proposal generation contract
Inputs:
- listing/job context
- evaluation
- candidate evidence
- case studies
- proposal rules
- optional one-request instructions

Output:
- proposal draft
- proposal_prompt_version
- model metadata
- generation status/error

Proposal generation does not directly approve, submit, or change authoritative lifecycle state except through the explicitly defined proposal workflow/state transition path.

## Schema governance
No V2 task may add, remove, rename, or reinterpret persisted fields without an explicit schema decision. If an existing field cannot support a required contract, stop and surface the specific gap before migration work.
