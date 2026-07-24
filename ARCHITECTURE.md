# 政途人生 — 架构文档

> 当前版本：0.1.0-alpha.1 | 存档 Schema：4 | 内容版本：2026.07.2

## 当前范围

当前版本是可运行的单机原型，已存在行政线 L1-L11 的配置与 L11 终局代码（36 个职位），但连续晋升链路尚未通过真实验证（当前存在 `multi_region` 履历判定阻塞）。已完成基础工程整理（严格存档解码、统一时间轴、行动快照、Reducer 拆分）。

当前职业模型为旧式单一线性等级结构（`currentLevel` 同时表达职位高低、机关层级和晋升目标）。职务与职级双通道、岗位领域交流和机会驱动选拔尚未实现，属于后续重构对象。

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
│   ├── departments/             # 部门治理（行动安排与槽位管理）
│   ├── assessment/              # 考核详情页面
│   └── career/                  # 晋升任命（完整晋升状态机）
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
│   ├── templates/               # 部门、KPI 等复用模板
│   ├── constants.json           # 时间、槽位、晋升等常量
│   └── loader.ts                # ConfigLoader
  ├── engine/
│   ├── core/
│   │   ├── action.ts            # 行动校验与效果解析
│   │   ├── effect.ts            # 效果应用
│   │   ├── time.ts              # 时间推进基础
│   │   └── timeline.ts          # 统一时间轴引擎
│   ├── events/
│   │   ├── condition-interpreter.ts  # 统一条件解释器（纯函数）
│   │   ├── effect-executor.ts        # 统一效果执行器（原子事务）
│   │   ├── event-orchestrator.ts     # 领域信号驱动的事件编排器（纯函数）
│   │   ├── event-resolver.ts         # 玩家选项结算（纯函数）
│   │   ├── event-scheduler.ts        # 计划事件激活与过期（纯函数）
│   │   └── source-key.ts             # 来源键派生函数
│   ├── governance/              # assessment/budget/kpi/dimensions
│   ├── career/                  # promotion/deviation-penalty/spectrum 等
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
│   └── save-codec/
│       └── index.ts             # 严格存档解码器（Zod Schema, Schema 4）
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

| Reducer                | 处理的 Action                                           |
| ---------------------- | ------------------------------------------------------- |
| `action-reducer.ts`    | START_ACTION（含 runtimeSnapshot 计算）                 |
| `time-reducer.ts`      | ADVANCE_TIME（使用统一时间轴）                          |
| `career-reducer.ts`    | START_PROMOTION / SELECT_TARGET / RESOLVE_STAGE / RESET |
| `character-reducer.ts` | NEW_GAME / LOAD_SAVE                                    |
| `event-reducer.ts`     | CHOOSE_EVENT_OPTION（原子效果应用 + 事件结算）          |
| `shared.ts`            | applyPlayerAttr / initializeDepartmentStates 等         |

### 测试 Store

`createTestStore()` 创建隔离 Store，其 `dispatch` 不触发 localStorage 写入。持久化集成测试使用模块级 `dispatch()`。

## 存档语义

### SaveEnvelope 字段

```typescript
interface SaveEnvelope {
  schemaVersion: number; // 存档结构版本（当前：4）
  contentVersion: string; // 内容配置版本（当前：2026.07.2）
  revision: number; // 同一存档的逻辑修订号
  savedAt: number; // 保存时间戳
  state: PlayerSave; // 实际游戏状态
}
```

### 严格解码行为

- 只接受当前 `schemaVersion` 的完整 SaveEnvelope
- 旧版存档通过确定性链式迁移支持：Schema 2 → 3 → 4
- `schemaVersion < 2` → 拒绝（`legacy_save_unsupported`）
- `schemaVersion > CURRENT` → 拒绝（`future_version`）
- 结构验证失败 → 拒绝（`invalid_envelope`）
- **非空事件实例的旧存档拒绝迁移**（无法补全快照），保留原始备份
- 不兼容存档创建只读备份（最多 3 份轮转，相同内容不重复）
- 启动页按错误类别显示提示

### 兼容性说明

解码器仅校验 `schemaVersion`，不校验 `contentVersion`。因此基础工程重构期间（PR #88）生成的 `schemaVersion: 1` 存档在当前版本仍可加载。正式版本体系建立前（PR #88 之前）的裸 PlayerSave 存档因缺少 Envelope 封装而被拒绝。

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
  | PoliticalCycleTimelineEvent // 政治周期（预留）
  | RetirementCheckTimelineEvent; // 退休检查（预留）
```

### 同日事件排序

同一天内按类型优先级：行动完成(0) < 月度结算(1) < 年度考核(2) < 政治周期(3) < 退休检查(4)。

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
```

- 理念偏离倍率和冲突状态绑定到具体行动实例（`SlotOccupant.runtimeSnapshot`）
- 不再使用玩家级临时倍率
- 配置在行动执行期间变化不会影响已启动行动的快照

## 事件系统（定义、编排与生命周期）

旧事件原型已删除。新事件系统分三层：定义层、执行基础层、编排与生命周期层。

### 定义与执行基础（PR #100 已完成）

- **事件定义**：`src/domain/events/definition.ts` 的 `EventDefinition`（触发器/重复策略/激活定义/选项）。
- **统一条件解释器**：`src/engine/events/condition-interpreter.ts` 的 `evaluateCondition`（纯函数）。
- **统一效果执行器**：`src/engine/events/effect-executor.ts` 的 `applyEffects`（原子事务，先验证全部目标再应用）。
- **配置验证**：`src/domain/events/validation.ts` 的 `validateEventDefinitions`（引用完整性 + 零延迟循环检测）。
- **ConfigLoader 事件索引**：`getEventDefinitionsBySignal` 按信号类型索引（返回深拷贝）。

### 编排与生命周期（当前 PR）

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

#### 选项结算

`resolveEventOption` 纯函数 + `reduceChooseEventOption` Store reducer 实现原子选项结算：从快照查找选项 → 预解析效果 → 原子应用（`applyEffects`） → 写入历史 → 从 pending 移除 → 推进阻塞指针 → 生成 `event.resolved`。

#### 计划事件激活与过期

- `activateScheduledEvents`：按 `activateAtDay` → 优先级 → `instanceId` 稳定排序激活。
- `expireEventInstances`：`currentDay > deadlineDay` 时过期（截止日当天仍可处理），记录 `finalStatus: 'expired'`。

**当前尚未接入时间轴和 UI**（留给 #96）。

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
