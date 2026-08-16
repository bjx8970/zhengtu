# 更新日志

本文件记录政途人生的用户可见变化、重要开发者契约变化和兼容性变化。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/)，版本号遵循语义化版本。分类：Added / Changed / Fixed / Deprecated / Removed / Save compatibility。

## [0.2.0-alpha.1] - 2026-08-16

完成 Phase 2 最小可玩纵向切片（#98）：职业仪表盘、政策与事件 UI、三条完整事件链与 Playwright 端到端验收。

### Added

- 职业仪表盘与晋升任命页（`/career`）：职位、机构、地区、领导职务层次和公务员职级分开展示；受条件约束的职级晋升与岗位机会驱动任职；移除旧主动晋升入口。
- 政策列表与政策状态 UI（`/policies`）；招商与产业政策链可从正常流程触发并结算。
- 阻塞式紧急事件弹窗、非阻塞事件收件箱与事件历史（`/events`）；防汛与举报调查链可在正确日期中断或延迟结算，刷新后安全恢复。
- Playwright 端到端验收 `tests/e2e/phase2-vertical-slice.spec.ts`，覆盖角色创建、职业循环、三条事件链与持久化恢复。

### Changed

- 软件版本由 `0.1.0-alpha.1` 提升为 `0.2.0-alpha.1`。

### Save compatibility

- 存档 Schema 保持 8、内容版本 `2026.07.8`；`0.1.0-alpha.1` 存档可直接加载。

### 本版本合入的实施批次

#### Phase 2 第五实施批次：岗位机会与任职事务

- **Added**：配置化职业履历资格规则与统一纯函数分析器，按正式任职、挂职、临时和代理的单条最小时长派生有效经历；`ConditionExpression` 支持有效地区、机构、领域和机构层级资格，机会生成、接受和最终任职复查复用同一语义；配置驱动的岗位机会、信号生成、去重、生命周期和统一时间轴过期；最小领导岗位选拔、training 判别联合与原子任职变化事务；初始开放履历、`appointment.changed` 生产及 Schema 8 / 内容版本 `2026.07.6`；补全乡镇科员至镇长的基层领导职务机会，以及招商、防汛、举报调查的可玩内容链。
- **Changed**：内容版本提升为 `2026.07.8`；存档 Schema 保持 8，未持久化任何履历分析缓存。
- **Removed**：运行时 `multi_region` 与模糊 `has_experience` 条件推断。
- **当时未实现**：NPC 候选池竞争（Phase 4 范围）。

#### Phase 2 第四实施批次：职级晋升与职业契约

- **Added**：配置驱动的公务员职级规则、资格评估、职数、历史和职业限制；`civil_service_rank.changed` 信号、原子 Store 晋升事务和稳定任职实例 ID；Schema 7 / 内容版本 `2026.07.5`，以及严格岗位机会和职业流程契约。
- **Removed**：旧 L+1 目标职位主动晋升内核；本批次不包含岗位机会生成或任职变化运行时。

#### Phase 2 第三实施批次：政策时间轴与真实领域信号

- **Added**：到期政策按绝对日自动生效，实施中政策按稳定顺序推进一个阶段，暂停和终态政策不会推进；持久化 `time.pendingContinuation`，blocking 后保存计划事件、过期、月结、年考、政治周期和退休检查等同日剩余节点；行动实例稳定 ID、职位/机构/地区来源快照与完整 `ActionExecutableSnapshot`，完成时只读取冻结的部门显示、行动效果、理念语义、属性边界和内容版本，并发出 `action.completed`；年度考核记录和属性影响提交后发出 `assessment.completed`；`deriveMetricSignalsFromEffects()` 将实际发生的世界/政策指标变化折叠为 `world.metric_changed` / `policy.metric_changed`；玩家事件选项与自动事件均先派生指标信号，再处理 `event.resolved`；正式最小集成事件 `industrial_park_progress_crisis`，覆盖政策阶段变化触发 urgent blocking；ADR-005：政策里程碑、真实领域信号与时间轴 continuation。
- **Changed**：`ADVANCE_TIME` 固定为行动完成 → 政策生效 → 政策里程碑 → 领域信号 → 计划事件 → 过期 → 月结 → 年考/考核信号 → 政治周期 → 退休检查；显式政策 Action 与自动时间轴复用同一个政策转换事务提交器；政策转换事务仅允许 `policyIndex === null` 新增实例，已有实例必须使用有效索引且实例 ID 一致，否则抛错并由外层事务回滚；整个时间推进继续在状态副本上原子执行，效果、级联或 continuation 校验失败不提交部分状态；内容版本由 `2026.07.3` 提升为 `2026.07.4`。
- **Save compatibility**：存档 Schema 由 5 提升至 6；Schema 5→6 将 `time.pendingContinuation` 初始化为 null，为各层级执行中行动生成 `legacy-action-{tier}-{slotIndex}-{startedAtDay}-{actionId}`，并按旧内容版本、当前任职和稳定行动 ID 补齐完整可执行快照，无法解析或语义字段不一致时拒绝迁移并保留原始备份；Schema 2→3→4→5→6 确定性链式迁移继续受支持，非法 continuation 和未来 Schema 严格拒绝。

#### Phase 2 第二实施批次：事件编排与实例生命周期

- **Added**：信号身份系统 `signalId`（`DomainSignalSnapshot` 稳定唯一标识，用于去重、来源追踪和诊断）；来源键派生函数 `deriveEventSourceKey`（支持 once_per_source 判定、冷却隔离和链实例隔离）；核心事件编排器 `processDomainSignal`（纯函数：资格评估、互斥组加权选择、事件实例创建、自动事件结算、递归信号处理和诊断信息记录）；事件可执行快照 `EventExecutableSnapshot`（玩家选择时从快照读取，不重读配置）；事件实例增加 `sourceKey`、`activatedAtDay`、`snapshot` 字段；重复控制 `once` / `once_per_source` / `once_per_chain` / `repeatable`（含 `maxActivations`）；冷却模型升级为 `EventCooldownRecord[]`（`global` / `source` / `chain` 三种作用域）；互斥组运行时（按 `weight` 加权选择）；概率与权重分离（RNG 注入确保可测试）；自动事件即时结算；玩家选项原子结算（`resolveEventOption` 纯函数 + `reduceChooseEventOption` reducer）；事件链实例统一 `sourceKey` 并支持分支；计划事件管理（`activateScheduledEvents` + `expireEventInstances`）；计划事件取消语义 `ScheduledEventCancellation`；信号去重与递归保护（广度优先队列，最大深度 16）；编排诊断信息 `EventOrchestrationDiagnostic`；事件历史记录增强（`finalStatus`、`triggeredAtDay`、`completedAtDay`、`sourceKey`、`chainInstanceId`、`titleSnapshot`、`chosenOptionLabel`、`appliedEffects`）；测试配置 fixture `investigation_start` 事件链；新版事件定义 `EventDefinition`（触发器、重复策略、激活定义、选项，附严格 Zod Schema）；统一条件解释器 `evaluateCondition`（逻辑组合、信号字段、职业状态、世界指标、事件历史、政策状态、履历、世界事实）；统一效果执行器 `applyEffects`（原子事务，先验证全部目标再应用）；事件配置验证 `validateEventDefinitions`（引用完整性 + 零延迟循环检测）；ConfigLoader 事件加载与信号索引；迁移示例事件 `flood_emergency` 为新版配置；ADR-002（事件定义与效果运行时基础）、ADR-003（事件编排与运行时快照）。
- **Changed**：`setFacts` 从 `flood_emergency` 事件配置迁移为标准 `world_fact` effect，`setFacts` 标记为 deprecated；内容版本由 `2026.07.1` 提升为 `2026.07.2`；`EffectDefinition` 重设计为按 `target` 判别的联合（机构/地区/政策指标通过 `institutionRef`/`regionRef`/`policyRef` 明确来源）；`PolicyStateCondition` 的 `metric_gte`/`metric_lte` 新增 `metricId` 字段；`GovernanceState.institutionMetrics`/`regionMetrics` 修正为嵌套 `MetricCollection`；`events.json` 重写为 `EventDefinition[]` 数组格式。
- **Removed**：旧事件原型（`GameEvent`、`EventCondition`、`EventOption`、`EventResolveResult`、`EventType`、旧 `EventCategory`）；旧事件引擎（`evaluateEventTrigger()`、`filterAvailableEvents()`、`EventContext`）；旧事件测试与旧 `events.json` 格式。
- **Save compatibility**：存档 Schema 由 3 提升至 4（事件状态结构变化）；提供确定性 `migrateSchema3To4` 迁移（空事件状态直接迁移，非空事件实例拒绝迁移并保留原始备份）；Schema 2 存档通过链式迁移（2→3→4）仍可加载，低于 Schema 2 的存档拒绝。
- **当时未实现**：政策生命周期与可中断时间轴（已由后续批次完成）；事件 UI（已由 #98 完成）；行动/考核完成后自动接入事件编排器（已由后续批次完成）。

#### Phase 2 第一实施批次：领域契约与 Schema 2（PR #99）

- **Added**：职业/治理/事件领域契约（机构层级、岗位领域、领导职务层次、公务员职级）；Career/Governance/Event/World 持久化状态骨架；统一条件/效果模型（`ConditionExpression` / `EffectDefinition`）与八类 `DomainSignalSnapshot`；36 个职位 + 18 个机构原生配置迁移，ConfigLoader 稳定 ID 查询；ADR-001：统一条件/效果模型与 Schema 2 契约。
- **Save compatibility**：存档 Schema 由 1 提升至 2；Schema 1 存档拒绝并保留只读备份（不实现自动迁移）。

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
