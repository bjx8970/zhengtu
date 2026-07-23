# 更新日志

本文件记录政途人生的用户可见变化、重要开发者契约变化和兼容性变化。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/)，版本号遵循语义化版本。分类：Added / Changed / Fixed / Deprecated / Removed / Save compatibility。

## [Unreleased] — Phase 2 第三实施批次（事件编排与实例生命周期）

### Added

- 信号身份系统：`signalId` 为 `DomainSignalSnapshot` 新增稳定唯一标识，用于去重、来源追踪和诊断。
- 来源键派生函数 `deriveEventSourceKey`（`src/engine/events/source-key.ts`）：根据信号类型统一派生 `sourceKey`，支持 once_per_source 判定、冷却隔离和链实例隔离。
- 核心事件编排器 `processDomainSignal`（`src/engine/events/event-orchestrator.ts`）：纯函数，接收领域信号后执行资格评估（重复/冷却/互斥/条件/概率）、互斥组加权选择、事件实例创建、自动事件结算、递归信号处理和诊断信息记录。
- 事件可执行快照 `EventExecutableSnapshot`：事件实例保存触发时完整定义副本（标题、描述、选项、效果），玩家选择时从快照读取，不重读配置。
- 事件实例增强：`EventInstance` / `ScheduledEventInstance` 增加 `sourceKey`、`activatedAtDay`、`snapshot` 字段。
- 重复控制：`once` / `once_per_source` / `once_per_chain` / `repeatable`（含 `maxActivations`），所有状态（pending/scheduled/history）均参与判定。
- 冷却模型升级：从简单 `Record<string, number>` 升级为 `EventCooldownRecord[]`，支持 `global` / `source` / `chain` 三种作用域。
- 互斥组运行时：同一 `mutexGroup` 内每次信号最多选中一个，按 `weight`（默认 1）加权选择，非互斥事件全部创建。
- 概率与权重分离：`probability` 独立于 `weight`，RNG 注入确保可测试。
- 自动事件即时结算：`presentation: automatic` 的事件在创建时立即应用效果、调度后续、取消计划、记录历史、发出 `event.resolved` 信号。
- 玩家选项原子结算：`resolveEventOption` 纯函数 + `reduceChooseEventOption` Store reducer（`CHOOSE_EVENT_OPTION` action），从快照验证选项并原子应用效果。
- 事件链实例增强：`EventChainInstance` 使用统一 `sourceKey` 替代 `sourceEntityType/sourceEntityId`，增加 `completedAtDay`，支持分支（多个 `activeNodeIds`）。
- 计划事件管理：`activateScheduledEvents` 到期激活 + `expireEventInstances` 过期处理（纯函数）。
- 计划事件取消语义：从简单 `string[]` 升级为 `ScheduledEventCancellation`（`same_chain` / `same_source` / `all`）。
- 信号去重与递归保护：广度优先信号队列，最大深度 16，最多 100 信号/事务。
- 编排诊断信息 `EventOrchestrationDiagnostic`：条件失败/重复阻止/冷却阻止/概率失败/互斥未选中/重复信号/实例创建等可观察诊断。
- 事件历史记录增强：`EventHistoryRecord` 增加 `finalStatus`（resolved/expired/cancelled）、`triggeredAtDay`、`completedAtDay`、`sourceKey`、`chainInstanceId`、`titleSnapshot`、`chosenOptionLabel`、`appliedEffects`。
- 测试配置 fixture：`events.json` 增加 `investigation_start` 事件链（6 个事件，覆盖线性/分支/延迟/自动路径）。
- ADR-003：事件编排与运行时快照。

### Changed

- `setFacts` 从 `flood_emergency` 事件配置迁移为标准 `world_fact` effect；`setFacts` 标记为 deprecated。
- 内容版本由 `2026.07.1` 提升为 `2026.07.2`。

### Save compatibility

- 存档 Schema 由 3 提升至 4（事件状态结构变化：事件实例增加快照、冷却改为结构化记录、链实例统一 sourceKey）。
- 提供确定性 `migrateSchema3To4` 迁移：空事件状态直接迁移；非空事件实例拒绝迁移（无法补全快照）并保留原始备份。
- Schema 2 存档通过链式迁移（2→3→4）仍可加载。低于 Schema 2 的存档拒绝。

### 未实现

- 政策生命周期与可中断时间轴（留给 #96）。
- 事件 UI（留给后续 UI PR）。
- 行动/考核完成后自动接入事件编排器（留给 #96）。

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
