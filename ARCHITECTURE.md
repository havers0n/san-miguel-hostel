# Architecture / Engine Contract

This project is built around a deterministic simulation engine.

The engine contract is the primary source of correctness. All code must preserve these invariants.

## Core idea

- **WorldState** is the domain state: agents, rooms, objects, domain events.
- **EngineRuntime** is the transport/runtime state: buffers, locks, metrics, engine-events.
- The only legal way to evolve the world is the **transactional engine tick**:
  - `engineTick.tick(world, simDt, engineTick) -> { worldNext, domainEvents, aiIntents }`

## Non-negotiable rules

### 1) WorldState is write-only via the engine

- Forbidden:
  - mutating WorldState from React components, UI handlers, scheduler, worker
  - mutating by shared references (hidden mutations through refs or captured objects)
- Allowed:
  - only the engine tick produces the next world and swaps `worldRef.current`

### 2) Async never knows about the world

Decision worker:
- must not import world types
- must not read WorldState
- only does `DecisionRequest -> DecisionResult` transport into `runtime.decisionBuffer`

Scheduler:
- reads the world synchronously inside tick wiring (no async)
- writes only through `SchedulerAPI` allowlist

### 3) React is not the source of truth

React responsibilities:
- visualization
- user input -> commands
- reading snapshots / diagnostics

React must not:
- own simulation time
- call tick from render
- mutate world directly

### 4) All side effects go through EngineRuntime

Only these inputs exist:
- `runtime.commandBuffer` (UI/input -> engine)
- `runtime.queue` (scheduler -> worker transport)
- `runtime.decisionBuffer` (worker -> engine)

Everything else is considered an illegal side effect.

### 5) Each invariant must have an EngineEvent

EngineEvents are diagnostics, not domain events.

Required mappings:
- dropped ticks -> `SIM_DROPPED_TICKS`
- backpressure drops -> `AI_BACKPRESSURE`
- discarded results -> `AI_RESULT_DISCARDED`

If an invariant can be violated and there is no EngineEvent for it, it's a bug.

### 11) Deterministic time in headless

In headless mode (tests / batch simulation runs), time must be injectable.

- Forbidden: `Date.now()` usage inside headless runs/tests.
- Required: a manual clock (injected `nowMs()`), so repeated runs produce identical results.

## Determinism: fixed timestep loop

The engine uses fixed simulation step:

- `SIM_DT = 1 / 30`
- accumulator collects real time
- while accumulator allows: run transactional ticks
- `MAX_TICKS_PER_FRAME` prevents spiral-of-death
- `MAX_ACCUM = SIM_DT * MAX_TICKS_PER_FRAME` clamps accumulator; excess produces `SIM_DROPPED_TICKS`

## Transactional tick pipeline (order is fixed)

Inside one tick (single transaction):

1) Drain decisions (snapshot boundary)
2) Ingest decisions (exactly-once/stale/TTL) and apply accepted decisions
3) Drain commands (snapshot boundary) and apply commands
4) Run world step -> produce `aiIntents`
5) Run scheduler (sync) -> enqueue `DecisionRequest` into runtime queue (no async)

Only the engine tick may update WorldState.

## Scheduler allowlist

Scheduler may mutate runtime only through `SchedulerAPI`:
- enqueue(req)
- setInFlight(agentId, inFlight)
- clearInFlight(agentId)
- metrics (reference)

If scheduler needs new capabilities, the API must be extended explicitly.

## Decision lifecycle invariants

- requestId: network/transport idempotency (exactly-once delivery)
- intentId: semantic idempotency within TTL (`agentId:contextHash`)
- stale by `contextHash` -> discard (no retries from worker)
- inFlight is a runtime lock, not business logic:
  - set only when enqueue succeeded
  - cleared on accepted result, discard (requestId-guarded), or timeout

## Engine Invariants

This section is the **formal spec** of what must always hold.
If any invariant can be violated without an engine-event or a failing headless regression, it's a bug.

### Definitions

- **Queue**: `runtime.queue` (scheduler -> worker transport, bounded with fair backpressure)
- **DecisionBuffer**: `runtime.decisionBuffer` (worker -> engine)
- **InFlight**: `runtime.inFlightByAgent` (runtime lock per agent; not business state)
- **Accepted DecisionResult**: a `DecisionResult` that passes:
  - requestId exactly-once
  - contextHash matches current `worldOps.getAgentContextHash(world, agentId)`
  - intentId TTL exactly-once

### Invariants (MUST)

1) **Global concurrency bound**

- Always: `runtime.inFlightByAgent.size <= runtime.maxConcurrentRequestsTotal`

2) **No “orphan” inFlight locks**

At any observation point in the headless loop (after worker step + after `engineTick.tick`):

- For every `agentId ∈ runtime.inFlightByAgent` there exists an outstanding request for that agent in one of:
  - `runtime.queue`
  - worker pending set (in headless: `DeterministicHeadlessWorker.pendingRequests()`)
  - (transiently) `runtime.decisionBuffer` until the next drain

If this is violated, the agent can get stuck until timeout and determinism breaks.

3) **Fair backpressure must not break lifecycle**

If backpressure drops a request (same-agent oldest or global oldest), then:

- The dropped request’s agent inFlight MUST be cleared **iff** it matches that dropped requestId.
- The engine MUST emit `AI_BACKPRESSURE` and increment `backpressureDropsTotal`.

4) **Accepted results are applied exactly once and close exactly one lock**

For an **accepted** `DecisionResult`:

- Its `contextHash` matches the current context hash of the agent at ingestion time.
- It is applied exactly once into the domain through the tick pipeline.
- It closes (clears) `inFlightByAgent[agentId]` **only** if that inFlight corresponds to this requestId
  (requestId-guarded; must not close a newer inFlight started later).

5) **Stale / duplicate results are discarded deterministically**

For a drained `DecisionResult` that is not accepted:

- If `contextHash` is stale -> it MUST be discarded with `AI_RESULT_DISCARDED(reason: "stale_context")`.
- If `intentId` is within TTL -> it MUST be discarded with `AI_RESULT_DISCARDED(reason: "duplicate_intent_ttl")`.
- If shape/schema is invalid -> it MUST be discarded with `AI_RESULT_DISCARDED(reason: "invalid_shape" | "schema_mismatch")`.
- In all discard cases, inFlight may be cleared only with requestId-guard (same requestId).

6) **Scheduler never mutates WorldState**

- Scheduler reads WorldState only synchronously during tick wiring.
- Scheduler mutations are restricted to `SchedulerAPI` allowlist (`enqueue`, `setInFlight`, `clearInFlight`, metrics).
- Any direct domain calls or world mutations from scheduler are forbidden.

7) **Worker never reads or mutates WorldState**

- Worker must not import world types and must not access WorldState.
- Worker is transport only: `DecisionRequest -> DecisionResult` into `DecisionBuffer`.
- No retries without an explicit engine decision; no hidden reads from runtime that imply world knowledge.

8) **Determinism: world signature stability**

Given identical headless parameters (seed, ticks) and identical code:

- `worldSignature(finalWorld)` MUST be identical across runs.
- This is enforced by CI via `npm run test:headless` (golden verify).


