# ADR-003：事件编排与运行时快照

日期：2026-07-23 | 状态：已采纳

## 背景

PR #100 建立了事件定义、条件解释器和效果执行器基础层。事件系统需要编排层将领域信号转化为事件实例、管理事件生命周期（创建→激活→结算→历史），并支持事件链、冷却、互斥和重复控制。

## 决策

### 1. 事件实例保存定义快照而非仅 eventId

**为什么**：
配置是活文档——事件文本、选项和效果可能在发布后迭代。如果实例只存 `eventId`，玩家加载旧存档时重新从 ConfigLoader 读取事件定义，可能遇到选项消失、文字不一致或效果漂移。

**做法**：`EventInstance` 包含 `EventExecutableSnapshot`，在触发时从 `EventDefinition` 深拷贝标题、描述、选项列表、`automaticOutcome` 和效果。选项结算从 `instance.snapshot.options` 查找，不访问 ConfigLoader。`contentVersion` 标记快照来源，用于将来跨版本兼容性诊断。

### 2. signalId 和 sourceKey：稳定身份与作用域

**为什么**：

- `signalId`：去重信号（同一业务事实重复提交不重复触发），关联触发上下文与事件实例用于调试。
- `sourceKey`：隔离同一事件在不同实例下的运行（同一政策的不同实例、不同任职、不同地区）。
- 不依赖全局 `Date.now()` 或 `Math.random()` 生成 ID——注入 `idFactory` 确保测试确定性。

**来源键规则**：

| 信号类型                                                             | 来源身份                     |
| -------------------------------------------------------------------- | ---------------------------- |
| `action.completed`                                                   | `actionInstanceId`           |
| `policy.approved` / `policy.phase_changed` / `policy.metric_changed` | `policyInstanceId`           |
| `appointment.changed`                                                | `experienceId`               |
| `assessment.completed`                                               | `"assessment_{year}_{tier}"` |
| `world.metric_changed`                                               | `signalId`                   |
| `event.resolved`                                                     | `eventInstanceId`            |

### 3. 概率与权重分离

**为什么**：

- `probability` = 事件自身是否通过触发资格（"这个事件在本次触发中是否出现"）。0 永不触发，1 必然通过（默认）。
- `weight` = 同一 `mutexGroup` 内通过资格检查后的相对权重（"优先选哪个"）。默认 1。
- 混用会制造配置歧义——用户可能添加死事件（`weight: 0` 还是 `probability: 0`？）。
- 无互斥组的事件不被竞争，可以同时触发多个。

### 4. 互斥组选取：信号级而非全局

**为什么**：

- 同一 `mutexGroup` 每次信号触发最多选中一个事件，而非全局互斥。
- 不同信号独立触发同一互斥组事件不会竞争。
- 组内按稳定 `eventId` 排序保证确定性；`weight` 影响选中概率但配置顺序不影响结果。

### 5. 重复和冷却作用域

**为什么**：

- `once`：全局（整个存档）。最严格，用于唯一故事事件。
- `once_per_source`：按 `sourceKey` 隔离。允许同一事件在不同政策/地区/任职下分别触发。
- `once_per_chain`：按 `chainInstanceId` 隔离。事件链中同一节点不在同一链分支重复。
- `repeatable` + `maxActivations`：限制总触发次数，过期/取消均计入（防止玩家放任过期规避限制）。

冷却从旧的 `Record<string, number>` 升级为 `EventCooldownRecord[]`（`global` / `source` / `chain` 三种作用域），避免各调用点自行拼接键导致的重复和错误。

### 6. 事件结算不重新读取配置

**为什么**：
快照保存了触发时的完整定义。如果结算时重新读取 ConfigLoader，配置修改可能导致快照与当前定义不一致，违反存档不变性。自动事件结算和玩家选项结算均从 `instance.snapshot` 获取数据。

### 7. 不使用全局异步事件总线

**为什么**：

- 游戏是确定性的回合制系统。信号处理顺序和结果应可复现。
- 广度优先信号队列 + 深度限制（16）提供安全递归边界，不引入竞争条件。
- 同一次事务内所有状态变化基于同一初始快照计算，自动事件产生的效果和信号进入下一轮。
- 所有函数为纯函数，RNG 和 ID 工厂注入，不依赖全局状态。

### 8. Schema 4 迁移策略

**为什么**：

- 冷却结构变化（`Record<string, number>` → `EventCooldownRecord[]`）和事件实例增加 `sourceKey`/`snapshot`/`activatedAtDay` 构成不兼容持久化变化。
- PR #100 尚未产生生产事件实例，因此 Schema 3 存档的事件状态应为空。
- 空状态可确定性迁移；非空事件实例拒绝迁移并保留原始备份（无法从配置回填历史快照）。
- Schema 2→3→4 链式迁移确保所有可迁移存档可恢复。

## 后果

- 所有事件定义配置更新后不影响已有存档事件实例。
- 来源键派生是中心化的，新增信号类型只需扩展一处。
- 诊断信息可供测试和开发调试使用，生产不持久化。
- 事件编排器不直接接入时间轴，留给 #96（政策生命周期与可中断统一时间轴）。
