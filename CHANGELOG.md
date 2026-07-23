# 更新日志

本文件记录政途人生的用户可见变化、重要开发者契约变化和兼容性变化。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/)，版本号遵循语义化版本。分类：Added / Changed / Fixed / Deprecated / Removed / Save compatibility。

## [Unreleased] — Phase 2 第二实施批次（事件定义与效果运行时基础）

### Added

- 新版事件定义 `EventDefinition`（`src/domain/events/definition.ts`）：触发器、重复策略、激活定义、选项，附严格 Zod Schema。
- 统一条件解释器 `evaluateCondition`（`src/engine/events/condition-interpreter.ts`）：纯函数，支持逻辑组合、信号字段、职业状态、世界指标、事件历史、政策状态、履历、世界事实。
- 统一效果执行器 `applyEffects`（`src/engine/events/effect-executor.ts`）：原子事务，先验证全部目标再应用。
- 事件配置验证 `validateEventDefinitions`（`src/domain/events/validation.ts`）：引用完整性 + 零延迟循环检测，由 `validate:config` 复用。
- ConfigLoader 事件加载与信号索引：`getEventDefinition` / `getAllEventDefinitions` / `getEventDefinitionsBySignal`。
- 迁移示例事件 `flood_emergency` 为新版配置。
- ADR-002：事件定义与效果运行时基础。

### Changed

- `EffectDefinition` 重设计为按 `target` 判别的联合：机构/地区/政策指标通过 `institutionRef`/`regionRef`/`policyRef`（current_appointment / signal / fixed）明确来源，不再共用含义模糊的 `subjectId`。
- `PolicyStateCondition` 的 `metric_gte`/`metric_lte` 新增 `metricId` 字段。
- `GovernanceState.institutionMetrics`/`regionMetrics` 由扁平 `Record<string, number>` 修正为嵌套 `MetricCollection = Record<string, Record<string, number>>`。
- `events.json` 由旧对象格式重写为 `EventDefinition[]` 数组格式。

### Removed

- 旧事件原型：`GameEvent`、`EventCondition`、`EventOption`、`EventResolveResult`、`EventType`、旧 `EventCategory`。
- 旧事件引擎：`evaluateEventTrigger()`、`filterAvailableEvents()`、`EventContext`（`src/engine/core/event.ts`）。
- 旧事件测试与旧 `events.json` 格式（`minLevel`/`maxLevel`/`careerLines`/`prerequisiteEvents`/`hiddenStateConditions`）。

### Save compatibility

- 存档 Schema 由 2 提升至 3（治理指标字段类型变化）。
- 提供确定性 `migrateSchema2To3` 迁移：Schema 2 存档加载时自动迁移，扁平治理指标重置为空嵌套集合（Schema 2 阶段治理未投产，指标恒为空，不丢失真实数据）。
- 低于 Schema 2 的存档拒绝并保留只读备份；高于 Schema 3 的存档拒绝。

## [Unreleased] — Phase 2 第一实施批次（PR #99，尚未单独发版）

### Added

- 职业/治理/事件领域契约：机构层级、岗位领域、领导职务层次、公务员职级。
- Career/Governance/Event/World 持久化状态骨架。
- 统一条件/效果模型（`ConditionExpression` / `EffectDefinition`）与八类 `DomainSignalSnapshot`。
- 36 个职位 + 18 个机构原生配置迁移，ConfigLoader 稳定 ID 查询。
- ADR-001：统一条件/效果模型与 Schema 2 契约。

### Save compatibility

- **当前 Schema 版本：2**（由 1 提升）。
- Schema 1 存档拒绝并保留只读备份（不实现自动迁移）。

## [0.1.0-alpha.1] - 2026-07-21

首个纳入正式版本管理的构建。不支持无 SaveEnvelope 封装的裸 PlayerSave 存档；基础工程重构期间（PR #88）生成的完整 Schema 1 Envelope 继续兼容。

### Added

- 严格存档解码器（Zod `.strict()` 全层级 + 跨字段一致性校验）
- `SaveEnvelope` 存档封装（schemaVersion + contentVersion + revision + savedAt）
- 不兼容或损坏存档的安全备份机制（最多 3 份轮转）
- 启动页分类显示存档错误提示（旧版/未来版本/损坏）
- 统一时间轴引擎 `advanceTimeline()`（行动完成 → 月度结算 → 年度考核严格按时间顺序）
- 行动实例级运行时快照 `runtimeSnapshot`（理念偏离倍率绑定到具体行动）
- Store Reducer 分域拆分（action / time / career / character / shared）
- 条件持久化（仅实际状态变化时写档，LOAD_SAVE 不触发持久化）
- 启动存档状态服务（解除循环依赖）
- 构建时版本注入（`__APP_VERSION__` 来自 package.json）
- 版本管理规范文档 `docs/VERSIONING.md`
- 职业与治理改版指导文档 `docs/CAREER_REDESIGN_GUIDE.md`

### Changed

- `game-store.ts` 从 1064 行精简到约 290 行，领域逻辑委托给 reducers/
- 时间推进使用统一绝对日坐标（`totalDaysPlayed`），修复跨年 13 月事件
- 存档加载改为严格解码，不再内联迁移
- 启动页从 Store 派生可继续状态
- 内容版本格式改为 `YYYY.MM.REVISION`

### Fixed

- 修复时间推进中月度/年度结算先于行动完成的顺序错误
- 修复并发行动共享玩家级临时偏离倍率的问题
- 修复跨年时产生 month=13 的月度事件

### Removed

- 删除玩家级临时字段 `_pendingDeviationMultiplier` 和 `pendingStyleConflict`
- 删除旧存档自动迁移代码（本版本不支持裸 PlayerSave 及非当前 Schema 的存档）

### Save compatibility

- **当前 Schema 版本：1**
- **当前内容版本：2026.07.1**
- 正式版本体系建立前的裸 PlayerSave 存档（无 SaveEnvelope 封装）**不受支持**
- 基础工程重构期间（PR #88）生成的 `schemaVersion: 1` 存档仍可加载（解码器仅校验 schemaVersion）
- 不兼容存档不会被静默覆盖，会保留只读备份并在启动页显示提示
- 未来版本存档（schemaVersion > 当前）会被拒绝
- 后续 Schema 变化将通过单独迁移处理，迁移失败时保留原始备份
