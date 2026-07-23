# ADR-002: 事件定义与效果运行时基础

> 状态：已采纳
> 日期：2026-07-23
> 关联 Issue：#57, #90

## 背景

PR #99 完成了领域契约、持久化状态骨架、Schema 2 和 36 个职位迁移，但仓库仍保留两套互不兼容的事件模型：

- 旧版：`GameEvent`/`EventCondition`/`EventOption` + `evaluateEventTrigger`/`filterAvailableEvents`，依赖已废弃的数字职业等级（`minLevel`/`maxLevel`）和固定职业线（`careerLines`）。
- 新版：`DomainSignalSnapshot`/`ConditionExpression`/`EffectDefinition`/`EventInstance`/`EventRuntimeState` 等类型与存档骨架，但尚无可执行运行时。

旧事件引擎无法作为新版事件系统的基础。

## 决策

### 1. 删除旧 GameEvent，不保留兼容转换层

项目处于开发期（0.1.0-alpha），旧事件配置无真实用户数据。直接删除旧类型、旧引擎函数、旧测试和旧 `events.json` 格式，迁移为新版配置。不建立 `旧 GameEvent → 转换器 → 新 EventDefinition` 的兼容层，避免长期维护两套语义。

### 2. 条件与效果统一

事件、政策、职业机会复用同一 `ConditionExpression` 与 `EffectDefinition`。配置不得嵌入 JavaScript 或任意属性路径。条件解释器 `evaluateCondition` 为纯函数；效果执行器 `applyEffects` 为原子事务。

### 3. 效果地址使用判别联合

旧 `EffectDefinition` 对多个具名指标目标共用 `subjectId`，语义不明确（同一 `subjectId` 在不同目标中代表不同概念）。新版按 `target` 判别：

- `character`：`field` + 操作
- `career_specialty`：`specialtyId`
- `institution_metric` / `region_metric`：`institutionRef` / `regionRef`（`current_appointment` | `signal` | `fixed`）+ `metricId`
- `policy_metric`：`policyRef`（`signal` | `fixed`）+ `metricId`
- `world_metric` / `world_fact` / `assessment_score`

每种效果地址语义唯一、必填字段明确、无法构造不可执行效果，运行时不解析拼接路径字符串。

### 4. 效果执行器原子性

`applyEffects` 分两阶段：先解析并验证全部效果目标（resolve），任一目标无法解析（缺失政策实例、引用字段不存在）立即抛错且不修改状态；全部可执行时再依次应用。测试证明非法效果不会造成部分结算。

通用效果执行器不隐式读取玩家理念偏离状态，不自动套用行动偏离倍率——行动偏离倍率由行动结算层明确处理。

### 5. 治理指标结构修正与 Schema 3

`GovernanceState.institutionMetrics`/`regionMetrics` 原为扁平 `Record<string, number>`（注释称"机构 ID → 指标字典"但类型不符）。修正为嵌套 `MetricCollection = Record<string, Record<string, number>>`，以支持机构/地区指标的显式地址。

此为字段类型变化，按 `docs/VERSIONING.md` 提升存档 Schema 至 3，并实现确定性 Schema 2 → 3 迁移。Schema 2 阶段治理子系统未投产、指标恒为空对象，迁移将扁平指标重置为空嵌套集合（不丢失真实数据）。

### 6. 本 PR 不实现事件编排器

本 PR 只建立"定义与执行基础层"：事件定义格式、条件解释器、效果执行器、ConfigLoader 事件加载与索引、配置引用/循环验证、迁移示例事件 `flood_emergency`。

完整事件编排（`processDomainSignal`、概率加权、冷却/互斥运行时、事件链推进、`CHOOSE_EVENT_OPTION`、事件 UI、可中断时间轴、行动/考核自动发信号）留给后续 PR，以便在稳定接口之上增量构建。

## Schema 变化

- Schema 2 → 3：治理指标扁平 → 嵌套 `MetricCollection`。
- 提供 `migrateSchema2To3` 确定性迁移；低于 Schema 2 拒绝，高于 Schema 3 拒绝。

## 后果

- 旧事件配置格式失效，`events.json` 重写为 `EventDefinition[]`。
- 条件/效果模型成为事件、政策、机会的共同基础。
- 后续事件编排器可直接消费 `EventDefinition` + `evaluateCondition` + `applyEffects`。
