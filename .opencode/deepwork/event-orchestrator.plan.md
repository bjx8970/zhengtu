# Event Orchestrator Implementation Plan

## Goal

实现领域信号驱动的事件编排器与事件实例生命周期，包括：信号处理、实例快照、重复/冷却/互斥、自动事件、选项结算、事件链、调度/过期、Schema 3→4 迁移。

## Scope

**IN**: domain types, engine (orchestrator, resolver, scheduler, source-key), store reducer, save-codec, config, tests, docs, ADR
**OUT**: policy system, interruptible timeline, UI, NPC, cloud save, formal content chains, version 0.2.0-alpha.1

## Approach (sequential phases)

### Phase A: Domain Types Enhancement

- [ ] A1: Add `signalId: string` to `DomainSignalBase`, update all signal types + Zod schemas
- [ ] A2: Create `EventExecutableSnapshot` interface + Zod schema
- [ ] A3: Enhance `EventInstance` with snapshot, sourceKey, activatedAtDay, triggerContext
- [ ] A4: Enhance `ScheduledEventInstance` with snapshot, sourceKey
- [ ] A5: Create structured `EventCooldownRecord` type (eventId, scope, scopeId, untilDay)
- [ ] A6: Enhance `EventHistoryRecord` with sourceKey, finalStatus, appliedEffects, chainInstanceId
- [ ] A7: Enhance `EventChainInstance` with unified sourceKey (replace sourceEntityType/sourceEntityId)
- [ ] A8: Create `ScheduledEventCancellation` type (eventId, scope)
- [ ] A9: Create `EventOrchestrationDiagnostic` discriminated union
- [ ] A10: Update `EventRuntimeState` to use new types
- [ ] A11: Create Resolve/Option input/output types

### Phase B: Config Changes

- [ ] B1: Migrate `setFacts` in events.json to standard `world_fact` effects
- [ ] B2: Bump `CURRENT_CONTENT_VERSION` to `2026.07.2`
- [ ] B3: Add chain test fixture events to test config (investigation chain)

### Phase C: Engine Implementation

- [ ] C1: Implement `deriveSourceKey()` in `src/engine/events/source-key.ts`
- [ ] C2: Implement `deriveEventSourceKey()` unified function
- [ ] C3: Implement `processDomainSignal()` orchestration entry point
- [ ] C4: Implement candidate eligibility checks (signal dedup, conditions, repeat, cooldown, mutex)
- [ ] C5: Implement probability + weight selection with injected RNG
- [ ] C6: Implement instance creation (immediate + scheduled) with executable snapshots
- [ ] C7: Implement auto-resolution path (automatic events)
- [ ] C8: Implement blocking queue management
- [ ] C9: Implement `resolveEventOption()` with atomic effect application
- [ ] C10: Implement `activateScheduledEvents()` activation logic
- [ ] C11: Implement `expireEventInstances()` expiration logic
- [ ] C12: Implement event chain lifecycle (create, advance, complete, abandon)
- [ ] C13: Implement `event.resolved` signal generation with recursion protection
- [ ] C14: Implement scheduled event cancellation with scope

### Phase D: Schema 3→4 Migration

- [ ] D1: Create Schema 4 PlayerSave Zod schema
- [ ] D2: Implement `migrateSchema3To4()` deterministic migration
- [ ] D3: Handle empty event state (normal case)
- [ ] D4: Handle non-empty event state (safe failure with backup)
- [ ] D5: Update `CURRENT_SCHEMA_VERSION` to 4, `MIN_MIGRATABLE_SCHEMA_VERSION` to 2

### Phase E: Store Integration

- [ ] E1: Create `src/store/reducers/event-reducer.ts`
- [ ] E2: Handle `CHOOSE_EVENT_OPTION` action
- [ ] E3: Handle `ACKNOWLEDGE_EVENT_RESULT` action
- [ ] E4: Add actions to `GameAction` union type
- [ ] E5: Integrate with main reducer dispatch

### Phase F: Tests

- [ ] F1: Signal tests (valid, duplicate, same-source, cross-source)
- [ ] F2: Condition tests (pass/fail, multi-source, all/any/not)
- [ ] F3: Probability + weight tests (0, 1, fixed RNG, mutex, no-mutex)
- [ ] F4: Repeat control tests (once, once_per_source, once_per_chain, repeatable, maxActivations)
- [ ] F5: Cooldown tests (day before, on boundary, day after, scope isolation)
- [ ] F6: Instance snapshot tests (config update doesn't affect instance)
- [ ] F7: Auto-event tests (effects, follow-up, cancel, history, signal, recursion limit)
- [ ] F8: Player choice tests (valid, invalid, expired, failed effect, atomicity)
- [ ] F9: Event chain tests (create, linear, branch, source isolation, complete, abandon)
- [ ] F10: Scheduling tests (immediate follow-up, fixed delay, range delay, activation, cancel scope)
- [ ] F11: Save/load round-trip tests (Schema 3→4 migration, state restoration)
- [ ] F12: Minimal integration chain test (investigation_start → branches → resolution)

### Phase G: Documentation

- [ ] G1: Update `ARCHITECTURE.md` event orchestration section
- [ ] G2: Create `docs/architecture/ADR-003-event-orchestration-and-runtime-snapshots.md`
- [ ] G3: Update `DEVELOPMENT_ROADMAP.md`
- [ ] G4: Update `CHANGELOG.md`
- [ ] G5: Update `docs/VERSIONING.md`
- [ ] G6: Add progress comment to Issue #57
- [ ] G7: Update Issue #90 tracking issue

### Phase H: Quality Gates

- [ ] H1: Run `pnpm format:check` (Prettier)
- [ ] H2: Run `pnpm lint` (ESLint, 0 errors)
- [ ] H3: Run `pnpm typecheck` (tsc --noEmit)
- [ ] H4: Run `pnpm test` (vitest with coverage)
- [ ] H5: Run `pnpm validate:config` (zod schema + reference integrity)
- [ ] H6: Run `pnpm build` (vite build)
- [ ] H7: Run `pnpm ci` (all gates)

### Phase I: Git & PR

- [ ] I1: Create branch `feat/event-orchestrator`
- [ ] I2: Atomic commits per work unit
- [ ] I3: Push + create PR
- [ ] I4: Verify CI passes

## Risks

- Schema migration must handle edge cases safely
- Type changes cascade through many files
- Engine test fixtures need careful construction
- Content version bump must align with events.json changes
- Recursive signal processing needs depth/breadth limits

## Verification

After each phase, run: `pnpm typecheck && pnpm test`
Before PR, run: `pnpm ci`
