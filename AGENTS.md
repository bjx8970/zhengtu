# AGENTS.md

## CRITICAL: Branch workflow — NEVER push directly to main

```
main 是受保护分支。任何变更必须:
  1. git checkout -b <type>/<desc>  从 main 新建分支
  2. 编写代码 + 测试
  3. git push + 创建 PR
  4. CI 全部通过 + OpenCode review 通过
  5. Squash Merge 到 main

分支命名: feat/<name> | fix/<name> | refactor/<name> | docs/<name> | chore/<name>
```

**包括文档变更也必须走分支 PR。** 即使一行修改也不例外。

## Framework: SolidJS, NOT React

- SolidJS `render()` **appends** content to the container — never clears `innerHTML` by itself. `src/main.tsx` explicitly calls `root.innerHTML = ''` before `render()` for this reason.
- No `@jsxImportSource` pragmas anywhere — `vite-plugin-solid` handles JSX transform.
- State is `createStore` + `produce` (Solid built-in), not React hooks. All state mutations go through `dispatch(action)` in `src/store/game-store.ts`.
- Use `<For each={list}>{(item) => ...}</For>` instead of `Array.map()` for list rendering. ESLint enforces this via `solid/prefer-for`.

## Quality gates (must pass in this order)

```bash
pnpm format:check    # Prettier
pnpm lint            # ESLint v9 (eslint.config.js flat config, NOT .eslintrc)
pnpm typecheck       # tsc --noEmit (strict mode)
pnpm test            # vitest run --coverage
pnpm validate:config # tsx scripts/validate-config.ts (zod schema + reference integrity)
pnpm build           # vite build
```

**`pnpm ci` runs all of the above.** Use `pnpm run ci` — plain `pnpm ci` is a pnpm built-in (clean install), not the project script.

ESLint config is `eslint.config.js` (flat config v9), not `.eslintrc.json`. 0 errors required; warnings are advisory.

## Architecture (layered, top-down only)

```
UI (Solid pages/components) → Store (createStore + dispatch) → Engine (pure functions) → Config (JSON + loader)
```

- Engine files live in `src/engine/<domain>/`. All engine functions must be **pure**: no DOM, no global state, no store references.
- Engine tests in sibling `__tests__/` with `.test.ts` extension.
- `src/engine/index.ts` is the aggregate export — register new engine modules there.
- Engine files ≤200 lines. Exceeding means it should be split.

## State management quirk

`dispatch()` and `createTestStore()` both call `reduceGameState(draft, action)`. This is the **only place** to add new action handlers. Add new action types to `GameAction` union type first, then add the case in `reduceGameState`.

Tests use `createTestStore()` for isolation. Never import the module-level `dispatch()` in tests.

## TypeScript rules (strict mode)

- No `any` (use `// eslint-disable-next-line @typescript-eslint/no-explicit-any` as last resort).
- Unused params: `_` prefix (`argsIgnorePattern: '^_'`).
- Non-null `!` is a warning — only use with a comment explaining why it's safe.
- All types in `src/types/`, never scatter interfaces in business code.
- Player attribute mutations use `applyPlayerAttr()` which validates against `PLAYER_NUMERIC_ATTRS` set and clamps with `clampAttr()`.

## Code comments (mandatory for exports)

- **File header**: every `.ts`/`.tsx` has a JSDoc block describing module responsibility.
- **Exported functions**: MUST have `@param` and `@returns` JSDoc.
- **Interfaces**: add inline comments for non-obvious fields.
- **Key logic**: explain "why" not "what" for non-trivial algorithms.
- **Placeholders**: unimplemented code marked with `// Phase N 实现` for later grep.

## Config data: JSON templates, not TS factories

- Config lives in `src/config/templates/*.json` + `src/config/career-lines/*.json`.
- `ConfigLoader` (singleton via `getConfigLoader()`) expands template ID references at runtime.
- Modifying config values: edit JSON, run `pnpm validate:config`, done. No code changes needed.
- Templates are split across `departments.json` (core 8) and `departments-extra.json` (extra 11). Both are merged at load time.

## Persistence model: phase commit

- Actions modify state in memory only.
- **Only** `ADVANCE_TIME` (push "推进时间") triggers persistence: `unwrap(state)` → Supabase upsert + localStorage backup.
- `EXECUTE_ACTION` internally calls `advanceTime` but does NOT persist — that happens when user explicitly pushes the advance button.
- Load arbitration: `selectNewer(localSave, remoteSave)` compares `updatedAt` timestamps.

## Slot-based action system (no AP)

- Slot limits: day=3, week=4, month=6 (configurable in `src/config/constants.json`).
- Each action has `slotCost` (1 for normal, 2 for heavy). Cooldown (`cooldownDays`) is the real frequency control.
- `executeAction()` uses `gameDay` as absolute day counter (`draft.totalDaysPlayed`) for cooldown tracking.

## Testing

- Coverage thresholds are enforced in CI: engine ≥90% lines, config ≥80%, store ≥70%.
- Tests in `src/engine/*/__tests__/` use Vitest. Store tests use `createTestStore()` for isolation.
- Run single file: `pnpm test -- --reporter=verbose src/engine/governance/__tests__/kpi.test.ts`
- **When to write tests**:
  - New engine function → MUST (coverage gate)
  - Modified engine logic → MUST (update existing tests)
  - New Store dispatch branch → MUST (integration test via `createTestStore`)
  - New JSON config → auto-covered by `loader.test.ts` integrity traversal
  - JSON value-only change → NOT required
  - Pure refactor (no behavior change) → NOT required

## CI + deployment

- On PR: `ci.yml` (quality gates) + `opencode-review.yml` (AI review).
- On push to main: `deploy.yml` → GitHub Pages at `https://bjx8970.github.io/zhengtu/`.
- OpenCode review needs `use_github_token: true` for `pull_request` events — omit it = `p.rest undefined` crash.
- `vite.config.ts` has `base: '/zhengtu/'` for GitHub Pages path. Don't change without syncing the repo name.

## Enums: English keys internally, Chinese values for display

```typescript
export enum Faction {
  Reform = 'reform',        // key for JSON/DB
  Pragmatic = 'pragmatic',
  Conservative = 'conservative',
}
```

## Project conventions

- File naming: `kebab-case.ts`. Test files: `*.test.ts`. No `.spec.ts`.
- All exported functions require JSDoc with `@param`/`@returns`. File headers document module responsibility.
- Commit messages: Conventional Commits (`feat(engine):`, `fix(store):`, `test(engine):`, `chore(deps):`).
- Engine files ≤200 lines. Exceeding means it should be split.
