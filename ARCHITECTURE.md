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


