# 政途人生 — 架构文档

> 当前版本：0.4.0-alpha.1 | 存档 Schema：14 | 内容版本：2026.08.8

## 当前范围

当前版本在 Phase 3 基层纵向切片之上完成 Phase 4 动态干部生态：新录用科员经个人任务、试用期、年度考核和公务员职级晋升自然成长；有限 NPC 干部池在同一统一时间轴下自行考核、晋升、退休或退出；真实 producer（干部离任、任职级联、政治周期届期评估）打开动态 Vacancy；玩家与 NPC 进入同一相对选拔候选池，赢家唯一任职并级联释放原岗位；基层任务提供玩家专长积累入口。Store 自然组织世界场景和不写业务存档的 Playwright 自然路径共同证明完整链路（见 `docs/PHASE4_ACCEPTANCE.md`）。

## Phase 3 工作模式与双通道

- 无领导职务时以 `PersonalTaskTemplate` 为工作入口，任务与部门行动共用槽位；任务完成写入 `actions.personalTasks` 和保留的 `personal_work` KPI 台账。
- 试用期是当前任职的一部分，由绝对日时间轴在到期日评估；当日任务先结算，再执行试用评估。
- 公务员职级只通过 `ADVANCE_CIVIL_SERVICE_RANK` 消费服务年限、考核与年度职数，不改变任职实例。
- 领导岗位只通过职业机会和选拔事务变更任职，原子关闭旧履历、创建新履历、重建部门运行时，不自动提升公务员职级。
- `src/config/phase3/acceptance.json` 锁定阶段职位、里程碑和任务可达边界；`auditPhase3Reachability()` 对 producer/consumer、经济和配置漂移执行 CI 审计。

## 岗位机会与任职事务

职业机会由领域信号驱动并冻结目标快照；生成、接受及最终任职前都复查配置和硬性条件。职业经历资格统一从 `career.experiences` 的单条 `[startedAtDay, endedAtDay)` 记录派生：正式、挂职、临时与代理分别遵循配置化最小时长，地区与机构经历独立统计，当前开放履历按当前绝对日实时计算。领导岗位走相对选拔状态机（六阶段固定序列、候选快照与单次 RNG 冻结于 Selection、赢家唯一），training 使用独立判别联合且不改变任职。任职事务在完整状态副本中原子关闭旧履历、创建新任职和开放履历、重建部门运行时、移动 Seat occupant 并产生 `appointment.changed`；执行中行动会阻止最终任职。机会过期是可恢复统一时间轴节点。职业仪表盘（`/career`）展示任职事实、相对选拔进度与政治周期状态。

## Phase 4 组织世界底座

`PlayerSave.organization` 是 NPC 干部、实际岗位席位、动态空缺和世界级选拔的唯一持久化容器；玩家自己的任职、履历与机会继续由 `CareerState` 表达。组织世界只以固定 player occupant 引用接入玩家，NPC 复用任职、履历和职业限制契约，不复制玩家行动、治理或事件运行时。

新游戏和 Schema 10→11 迁移均通过纯函数确定性实例化有限干部池与 Seat。职位配置的 `vacancyCount` 在该入口只表示 Seat 模板容量，不等于运行时开放 Vacancy 数。严格解码会校验唯一身份、Seat occupant、NPC 任职/开放履历、Vacancy/Seat、Selection/Vacancy 与赢家候选引用。

Phase 4 运行时由 producer/consumer 闭环驱动，全部以 `organization.processedProducerKeys` 幂等：

- **干部生命周期**：`settleNpcLifecycle` 在年度节点结算 NPC 考核、职级晋升、退休与退出，产出离任事实账本；`consumeCadreDeparturesInTransaction` 把离任转成真实 Vacancy。
- **任职级联**：`fillVacancyInTransaction` 在赢家就任目标席位的同时释放其原席位，并以 `vacancy:appointment:{appointmentId}:{seatId}` 打开新空缺——玩家与 NPC 走同一机制。
- **相对选拔**：`createRelativeSelectionInTransaction` 在玩家接受机会时冻结统一候选池（玩家与 NPC 同一资格框架）、完整随机数与规则版本；`advanceRelativeSelectionStage` 只消费 Selection 自有输入，六阶段后产生唯一赢家，最终任职由世界级事务原子提交。
- **政治周期**：`processPoliticalCycle` 在 Congress 节点创建届期，每日推进阶段；届期评估对"空置且无活动空缺"的席位以稳定 producer key 打开 `political_cycle` Vacancy，并连续衔接下一届。
- **NPC 自主补员**：`npc_staffing` 每日节点对"非初始编制、已过 `npcStaffingDelayDays` 延迟、玩家机会缺位"的 open Vacancy 以 NPC-only 候选池运行同一相对选拔框架（producer key `npc-staffing:{vacancyId}` 保证每个空缺实例只尝试一次）；赢家经 NPC 任职事务就任并级联原岗位，组织世界不因玩家不行动而停摆。初始编制（`system`）始终等待玩家职业进程解锁的机会窗口。

验收证据见 `docs/PHASE4_ACCEPTANCE.md`。

政策列表、事件收件箱与 blocking 弹窗 UI 已随 #98 交付，配合 Store 集成测试与 Playwright 端到端验收共同验证运行时。

## 技术栈

| 层     | 技术                                                                           |
| ------ | ------------------------------------------------------------------------------ |
| UI     | SolidJS 1.9、Vite 6、`vite-plugin-solid`                                       |
| 状态   | Solid `createStore` + `produce`，通过 `dispatch(action)` 修改                  |
| 语言   | TypeScript strict mode                                                         |
| 样式   | `src/styles/tokens.css` 设计令牌 + 组件样式；`src/utils/theme.ts` 提供 TS 镜像 |
| 路由   | `src/router.tsx` 自建 Hash Router；路由声明集中在 `src/app.tsx`                |
| 配置   | JSON 模板 + `ConfigLoader` 运行时展开 + zod 完整性校验                         |
| 持久化 | 条件写入 localStorage（仅状态实际变化时）；远程同步暂时停用                    |
| 测试   | Vitest、jsdom、Solid Testing Library、V8 coverage                              |
| 部署   | GitHub Actions → GitHub Pages                                                  |

## 实际目录

```text
src/
├── main.tsx                     # 启动时读取存档并挂载 Solid 应用
├── app.tsx                      # 根组件与当前路由声明
├── router.tsx                   # Hash Router
├── vite-env.d.ts                # Vite 环境类型（含 __APP_VERSION__）
├── components/                  # 共享 UI 与后续功能接入矩阵
├── pages/
│   ├── auth/splash.tsx          # 启动页（存档状态提示）
│   ├── character/               # 六步建档
│   ├── home/home-page.tsx       # 综合 Dashboard（日程概览 + 跳转入口）
│   ├── tasks/                   # 科员个人任务与领导本人事务
│   ├── departments/             # 部门治理（行动安排与槽位管理）
│   ├── assessment/              # 考核详情页面
│   ├── career/                  # 晋升任命（职级晋升 + 岗位机会任职）
│   ├── policies/                # 政策列表与政策状态
│   └── events/                  # 事件收件箱、事件历史与阻塞弹窗
├── styles/                      # 全局 CSS 与设计令牌
├── types/
│   ├── player.ts                # PlayerSave、SlotOccupant 等
│   ├── game.ts                  # TimelineEvent、ActionRuntimeSnapshot 等
│   ├── save.ts                  # SaveEnvelope、Schema/内容版本常量
│   ├── actions.ts               # Reducer Payload 类型
│   ├── config.ts / enums.ts / character.ts / ui.ts
├── utils/                       # 格式化、数学、主题等工具
├── config/
│   ├── career-lines/            # 当前已接入 administrative.json
│   ├── templates/               # 部门、KPI、事件、任务等复用模板
│   ├── organization/cadres.json # 初始 NPC 干部模板
│   ├── career/                  # 机会定义与相对选拔规则
│   ├── phase3/acceptance.json   # Phase 3 入口、里程碑与任务可达边界
│   ├── constants.json           # 时间、槽位、晋升、NPC 生命周期等常量
│   └── loader.ts                # ConfigLoader
├── engine/
│   ├── core/
│   │   ├── action.ts            # 行动校验与效果解析
│   │   ├── effect.ts            # 效果应用
│   │   ├── time.ts              # 时间推进基础
│   │   ├── timeline.ts          # 统一时间轴引擎
│   │   └── daily-timeline-plan.ts # 可持久化同日节点计划
│   ├── events/
│   │   ├── condition-interpreter.ts  # 统一条件解释器（纯函数）
│   │   ├── effect-executor.ts        # 统一效果执行器（原子事务）
│   │   ├── event-orchestrator.ts     # 领域信号驱动的事件编排器（纯函数）
│   │   ├── event-resolver.ts         # 玩家选项结算（纯函数）
│   │   ├── event-scheduler.ts        # 计划事件激活与过期（纯函数）
│   │   ├── source-key.ts             # 来源键派生函数
│   │   └── metric-signal-bridge.ts   # 指标效果→领域信号
│   ├── governance/              # assessment/budget/kpi/policy lifecycle
│   ├── organization/            # 组织初始化/干部生命周期/政治周期/Vacancy 生命周期
│   ├── career/                  # promotion/机会编排/相对选拔资格与生命周期等
│   ├── tasks/                   # 个人任务准入、排期与 KPI 结算
│   └── index.ts                 # 引擎聚合导出
├── store/
│   ├── game-store.ts            # Store 入口、dispatch、条件持久化
│   ├── reducers/
│   │   ├── action-reducer.ts    # START_ACTION + runtimeSnapshot 绑定
│   │   ├── time-reducer.ts      # ADVANCE_TIME + 统一时间轴结算
│   │   ├── career-reducer.ts    # 晋升流程
│   │   ├── character-reducer.ts # NEW_GAME / LOAD_SAVE
│   │   ├── event-reducer.ts     # CHOOSE_EVENT_OPTION + 原子效果应用
│   │   └── shared.ts            # 共享辅助函数
│   ├── transactions/
│   │   ├── timeline-day-transaction.ts   # 统一时间轴同日结算（含政治周期）
│   │   ├── organization-seat-transaction.ts
│   │   ├── vacancy-transaction.ts        # Vacancy open/fill/cancel/expire 与离任消费
│   │   ├── selection-transaction.ts      # 相对选拔创建与冻结
│   │   ├── npc-appointment-transaction.ts # NPC 赢家任职与级联
│   │   └── policy-transition-transaction.ts
│   └── save-codec/
│       ├── index.ts             # 严格存档解码器（Zod Schema 14，支持 Schema 2→14 迁移）
│       └── organization-schema.ts
└── services/
    ├── save-repo.ts             # 本地/远程存档读写
    ├── startup-save-state.ts    # 启动存档状态服务
    └── supabase.ts              # 可选 Supabase client
```

## 分层与依赖

```text
UI（页面/组件） → Store（dispatch/reducer） → Engine（纯函数） → Config（JSON/loader）
                                  ↓
                         SaveRepo（持久化边界）
```

- UI 读取 store，并只通过 `dispatch(action)` 发起状态修改。
- `reduceGameState(draft, action)` 是生产 store 与 `createTestStore()` 共用的唯一 action 处理入口。
- Engine 不读取 DOM、全局 store 或持久化服务；接收数据并返回结果。
- ConfigLoader 展开模板引用；业务代码不复制 JSON 配置。
- 类型集中在 `src/types/`，避免在业务模块散落跨层模型。

## Store 架构

### game-store.ts 当前职责

- 创建 Solid Store 和 `dispatch` 函数
- 调用 `reduceGameState()` 委托给各领域 reducer
- 判断状态是否实际变化（`changed` 返回值）
- 仅在实际变化时更新 `updatedAt` 并写入 localStorage
- `LOAD_SAVE` 不触发持久化（避免启动时覆盖原存档）

### Reducer 分域

| Reducer                          | 处理的 Action                                      |
| -------------------------------- | -------------------------------------------------- |
| `action-reducer.ts`              | START_ACTION（冻结部门行动快照）                   |
| `personal-task-reducer.ts`       | START_PERSONAL_TASK（前置、槽位与任务快照）        |
| `time-reducer.ts`                | ADVANCE_TIME（可中断统一时间轴）                   |
| `career-rank-reducer.ts`         | ADVANCE_CIVIL_SERVICE_RANK                         |
| `career-opportunity-reducer.ts`  | 机会接受/拒绝、选拔阶段与原子任职                 |
| `policy-reducer.ts`              | 政策生命周期事务                                  |
| `event-reducer.ts`               | CHOOSE_EVENT_OPTION（原子效果应用 + 事件结算）     |
| `character-reducer.ts`           | NEW_GAME / LOAD_SAVE                               |
| `shared.ts`                      | applyPlayerAttr / initializeDepartmentStates 等    |

### 测试 Store

`createTestStore()` 创建隔离 Store，其 `dispatch` 不触发 localStorage 写入。持久化集成测试使用模块级 `dispatch()`。

## 存档语义

### SaveEnvelope 字段

```typescript
interface SaveEnvelope {
  schemaVersion: number; // 存档结构版本（当前：14）
  contentVersion: string; // 内容配置版本（当前：2026.08.8）
  revision: number; // 同一存档的逻辑修订号
  savedAt: number; // 保存时间戳
  state: PlayerSave; // 实际游戏状态
}
```

### 严格解码行为

- 当前 Schema 14 的完整 SaveEnvelope 直接进入严格结构解码
- 旧版存档通过确定性链式迁移支持：Schema 2 → 3 → … → 10 → 11 → 12 → 13 → 14
- `schemaVersion < 2` → 拒绝（`legacy_save_unsupported`）
- `schemaVersion > CURRENT` → 拒绝（`future_version`）
- 结构验证失败 → 拒绝（`invalid_envelope`）
- **非空事件实例的旧存档拒绝迁移**（无法补全快照），保留原始备份
- 不兼容存档创建只读备份（最多 3 份轮转，相同内容不重复）
- 启动页按错误类别显示提示

### 兼容性说明

解码器以 `schemaVersion` 决定结构兼容性；迁移步骤会在需要可靠重建运行时快照时校验对应的历史 `contentVersion`。Schema 2–9 先通过确定性迁移链升级至 Schema 10；Schema 10 内按 `2026.08.2→.3→.4→.5→.6→.7` 应用内容迁移，再于当前绝对日初始化组织世界；Schema 11→14 依次补齐离任账本、Vacancy/机会终态字段，并把旧 Selection 转成明确的 terminal failed 审计（不猜测赢家、不重抽随机数）。Schema 1 和缺少 Envelope 的裸 PlayerSave 被拒绝并保留只读备份。

### revision 和 updatedAt

- `revision`：每次写档递增，标识同一存档的修订次数
- `updatedAt`：`PlayerSave` 中的时间戳，仅在状态实际变化时由 dispatch 更新

## 时间轴语义

### 唯一绝对日坐标

以 `totalDaysPlayed`（从开局第 0 天起算）为唯一绝对日坐标。

### 时间事件类型

```typescript
type TimelineEvent =
  | ActionCompletionTimelineEvent // 行动完成
  | MonthlySettlementTimelineEvent // 月度结算
  | AnnualAssessmentTimelineEvent // 年度考核
  | PoliticalCycleTimelineEvent // 政治周期（届期创建）
  | RetirementCheckTimelineEvent; // 退休检查（兼容占位，退休在年度结算内处理）
```

### 同日事件排序

最终顺序固定为：

1. 落到当日绝对时间坐标；
2. 结算当日全部行动；
3. 自动激活到期政策；
4. 每项实施中政策最多推进一个到期阶段；
5. 统一处理行动和政策领域信号；
6. 激活到期计划事件；
7. 处理事件过期；
8. 月度结算；
9. 年度考核（含 NPC 年度生命周期结算与离任消费）并处理 `assessment.completed`；
10. 政治周期（阶段推进与届期评估；有活动周期后每日执行）；
11. 退休检查（兼容占位）。

行动全部结算后才处理信号，因此第一个行动触发 blocker 不会丢失同日其他已完成行动。政策事实全部提交后才进入计划事件；考核信号产生的 blocker 发生在政治周期和退休检查之前。

### blocking 与同日 continuation

事件级 `deferredContinuations` 只恢复事件实例/领域信号因果链；`time.pendingContinuation` 独立保存时间轴工作。节点可包含计划事件激活、过期、月结、年考、政治周期和退休检查，且必须属于当前绝对日、按固定顺序、无重复。

`ADVANCE_TIME` 先检查活动 blocker，再恢复事件 continuation，最后恢复 `time.pendingContinuation`。恢复同日节点的这次操作不会增加日期；全部完成并清空 continuation 后，下一次推进才进入新日。整个 `ADVANCE_TIME` 在完整状态副本上执行，效果解析、政策转换、信号级联或 continuation 校验失败均不提交部分状态。

### 跨月和跨年

月度事件的 `month` 表示刚结束的月份（不出现 month=13）。跨年时正确计算年份递增。

### 并发行动

每个行动使用自己的 `runtimeSnapshot` 中的偏离倍率，互不干扰。

## 行动运行时快照

```typescript
interface ActionRuntimeSnapshot {
  effectivenessMultiplier: number; // 理念偏离效果倍率
  styleConflictTriggered: boolean; // 是否触发风格冲突
  styleAlignment?: string; // 行动的理念对齐方向
}

interface ActionExecutableSnapshot {
  contentVersion: string;
  department: { id: string; name: string };
  action: ActionTemplate; // 完整效果、显示和理念语义
  attributeBounds: GameConfig['attributeBounds']; // 效果钳制边界
}
```

- 理念偏离倍率和冲突状态绑定到具体行动实例（`SlotOccupant.runtimeSnapshot`）
- `SlotOccupant.instanceId` 是稳定行动身份；职位、机构和地区在启动时冻结
- `SlotOccupant.executableSnapshot` 冻结部门显示、完整行动定义、属性边界和内容版本
- 不再使用玩家级临时倍率
- 行动完成只读取可执行快照，不重新解析当前部门、行动或属性边界配置
- Schema 5→6 只迁移能按旧内容版本和稳定 ID 可靠补全快照的在途行动；否则在解码阶段拒绝并备份原存档
- 行动完成、效果、冷却、槽位释放和 `action.completed` 属于同一事务

## 事件系统（定义、编排与生命周期）

旧事件原型已删除。新事件系统分三层：定义层、执行基础层、编排与生命周期层。

### 定义与执行基础（PR #100 已完成）

- **事件定义**：`src/domain/events/definition.ts` 的 `EventDefinition`（触发器/重复策略/激活定义/选项）。
- **统一条件解释器**：`src/engine/events/condition-interpreter.ts` 的 `evaluateCondition`（纯函数）。
- **统一效果执行器**：`src/engine/events/effect-executor.ts` 的 `applyEffects`（原子事务，先验证全部目标再应用）。
- **配置验证**：`src/domain/events/validation.ts` 的 `validateEventDefinitions`（引用完整性 + 零延迟循环检测）。
- **ConfigLoader 事件索引**：`getEventDefinitionsBySignal` 按信号类型索引（返回深拷贝）。

### 编排与生命周期

#### 领域信号进入事件编排器

系统通过 `processDomainSignal`（`src/engine/events/event-orchestrator.ts`）接收领域信号（`DomainSignalSnapshot`），完成以下流程：

1. **信号去重**：通过 `signalId` 检查信号是否已处理，防止重复消费。
2. **来源键派生**：`deriveEventSourceKey(signal)` 根据信号类型统一派生 `sourceKey`（动作实例ID/政策实例ID/任职ID等）。
3. **候选获取**：从 ConfigLoader 按 `signal.signalType` 获取匹配的事件定义，按稳定 `eventId` 排序。
4. **资格评估**（同一初始状态快照、固定顺序）：
   - 重复检查（once / once_per_source / once_per_chain / repeatable + maxActivations）
   - 冷却检查（global / source / chain 三种作用域）
   - 互斥组检查（同一 `mutexGroup` 内已有活动实例则阻止）
   - 条件评估（`evaluateCondition`）
   - 概率检查（注入 RNG，probability 默认 1）
5. **互斥组选择**：同一 `mutexGroup` 内从通过资质的候选按 `weight`（默认 1）加权随机选择至多一个；无互斥事件全部创建。
6. **实例创建**：构建 `EventExecutableSnapshot`（保存触发时的事件定义文本/选项/效果完整副本），计算 `deadlineDay` = `activatedAtDay + deadlineDays`。
7. **自动事件即时结算**：`presentation: automatic` 的事件立即应用效果、调度后续、记录历史、生成 `event.resolved` 信号、更新冷却和事件链。
8. **递归信号处理**：自动事件产生的 `event.resolved` 信号在同一事务内继续编排（广度优先，最大深度 16，最多 100 信号/事务）。

#### 重复模式

| 模式              | 语义                                 | 判定范围                                  |
| ----------------- | ------------------------------------ | ----------------------------------------- |
| `once`            | 整个存档最多触发一次                 | pending + scheduled + history（所有状态） |
| `once_per_source` | 同一 eventId + sourceKey 最多一次    | pending + scheduled + history             |
| `once_per_chain`  | 同一链实例内最多一次                 | pending + scheduled + history（链范围）   |
| `repeatable`      | 可重复，受冷却和 maxActivations 限制 | 仅检查 maxActivations（过期/取消均计入）  |

#### 概率与权重

- `probability`：事件自身是否通过本次触发资格检查（0 永不触发，1 必然通过，默认 1）。
- `weight`：同一 `mutexGroup` 内通过资格和概率检查后的相对权重（默认 1）。无互斥组的事件不被竞争。
- RNG 注入确保可测试性；调用顺序由稳定 eventId 排序保证确定性。

#### 冷却模型

冷却使用 `EventCooldownRecord[]`（替代旧 `Record<string, number>`），支持三种作用域：

- `global`：所有来源共享
- `source`：按 `sourceKey` 隔离
- `chain`：按 `chainInstanceId` 隔离

#### 事件实例快照

事件实例保存触发时完整快照（`EventExecutableSnapshot`），而非仅 `eventId`。玩家选择时从快照读取选项和效果，不重新读取当前配置。避免：事件已进入存档 → 内容更新 → 加载存档 → 选项/文字/效果变化。

#### 事件链

`EventChainInstance` 以 `sourceKey` 标识来源（替代旧的 `sourceEntityType/sourceEntityId`）。支持分支（`activeNodeIds` 数组同时追踪多个活动节点）。同一来源和链ID复用同一实例；不同来源创建独立实例。

#### 选项结算与指标信号

`resolveEventOption` 纯函数 + `reduceChooseEventOption` Store reducer 实现原子选项结算：从快照查找选项 → 原子应用效果 → 从 `AppliedEffectRecord[]` 派生指标信号 → 写入历史 → 从 pending 移除 → 推进阻塞指针 → 生成 `event.resolved`。指标信号固定先于 `event.resolved` 进入级联；自动事件采用相同顺序。

#### 计划事件激活与过期

- `activateScheduledEvents`：按 `activateAtDay` → 优先级 → `instanceId` 稳定排序激活。
- `expireEventInstances`：`currentDay > deadlineDay` 时过期（截止日当天仍可处理），记录 `finalStatus: 'expired'`。

计划事件和过期处理已接入可中断时间轴；收件箱、事件历史与阻塞弹窗 UI 由 #98 交付并经 Playwright 验收。

## 政策时间轴与领域信号

- `approved && effectiveAtDay <= currentDay` 的政策按 `effectiveAtDay → instanceId` 自动调用 `activatePolicy()`。
- `implementing && nextMilestoneAtDay <= currentDay` 的政策按 `nextMilestoneAtDay → instanceId` 调用 `advancePolicyPhase()`；暂停与终态政策不会入选，同一日每项政策最多推进一次。
- 显式政策 Action 和自动时间轴共用 `policy-transition-transaction.ts`，统一应用效果、更新实例、派生指标信号并交给事件 continuation。
- `deriveMetricSignalsFromEffects()` 只为实际发生的 `world_metric` / `policy_metric` 变化发出信号；同一事务同一指标折叠为最终值并保持首次出现顺序。政策指标上下文来自实例冻结的 `originContext`。
- 年度记录和属性影响提交后发出 `assessment.completed`；行动实例完成后发出 `action.completed`。
- 当前正式最小事件 `industrial_park_progress_crisis` 验证政策阶段变化触发 urgent blocking 与同日月结恢复；政策与事件 UI 已随 #98 交付。

## 配置模型

```text
templates/departments*.json + templates/kpis.json
                    ↓ 引用
career-lines/administrative.json
                    ↓ ConfigLoader 展开
PositionConfig（部门、行动、KPI）
```

修改数值优先编辑 JSON；新增模板或引用后必须运行 `pnpm validate:config`。

## 当前遗留模型（下一阶段重构对象）

以下结构仍然存在于当前代码中，是后续职业领域模型重构的目标：

- `currentLevel`：单一等级同时表达职位高低、机关层级和晋升目标
- `currentCareerLine`：固定封闭职业线
- `politicalCapital`：万能资源
- 固定晋升状态机：玩家主动触发
- `transferCount` / `isLineLocked`：固定转职次数
- `endgameReached`：基于单一等级的终局字段

这些不是当前已完成的新能力，而是待重构的旧结构。

## 扩展约束

1. 新 Engine 函数保持纯函数并添加同级 `__tests__/*.test.ts`。
2. 新 action 先扩展 `GameAction`，再只在 `reduceGameState` 增加分支，并用 `createTestStore()` 测试。
3. Engine 文件超过 200 行时按职责拆分，并在 `src/engine/index.ts` 注册导出。
4. 未实现功能使用 `// Phase N 实现` 标记。
5. 所有导出函数补充包含 `@param` 和 `@returns` 的 JSDoc。

## 质量与性能目标

提交前运行 `pnpm run ci`。覆盖率门槛为 Engine 90%、Config 80%、Store 70%。
