# ADR-005：政策里程碑、真实领域信号与时间轴 continuation

> 状态：Accepted  
> 日期：2026-07-28  
> 关联：#96、#90，前置 PR #101、#103

## 背景

事件编排已经能在领域信号产生 blocking 事件，并持久化尚未消费的事件实例和信号。但时间推进原先只在内存循环中依次处理月结、年考等节点：一旦计划事件或信号级联产生 blocker，循环退出，同日剩余节点既未执行也未保存，刷新后无法恢复。

政策生命周期引擎也只由显式 Store Action 调用；批准政策不会在 `effectiveAtDay` 自动生效，实施中政策不会在 `nextMilestoneAtDay` 自动推进。行动与年考结算没有生产真实领域信号，统一效果执行器记录的指标变化也没有进入事件编排。

## 决策

### 1. 事件 continuation 与时间轴 continuation 分离

`events.deferredContinuations` 保存事件实例/领域信号的因果队列。`time.pendingContinuation` 保存当前绝对日尚未执行的时间轴节点：

```typescript
interface TimelineContinuation {
  absoluteDay: number;
  remainingNodes: TimelineContinuationNode[];
}
```

节点包括计划事件激活、事件过期、月结、年考、政治周期和退休检查。两种 continuation 不合并，因为前者负责事件级联深度和实例身份，后者负责日历顺序与“是否已经结算”。

Schema 严格要求 continuation 只属于 `time.totalDaysPlayed`，节点绝对日一致、类型不重复、顺序固定。空 `remainingNodes` 可以作为“当日节点已经完成但本次仍不得跨日”的恢复边界。

### 2. 同日顺序

单日事务固定为：

1. 落到当日时间坐标；
2. 结算全部行动；
3. 自动激活全部到期政策；
4. 推进全部到期政策各一个阶段；
5. 统一处理行动与政策信号；
6. 激活到期计划事件；
7. 处理事件过期；
8. 月度结算；
9. 年度考核并处理 `assessment.completed`；
10. 政治周期；
11. 退休检查。

blocking 出现时保存尚未执行节点。行动先全部结算再处理信号，避免首个行动触发 blocker 后丢失同日其他行动。考核信号在政治周期和退休检查之前处理。

计划事件激活是唯一允许“节点内部分提交”的工作：激活器只处理到首个 blocking 实例，其后的同日到期实例仍留在 `events.scheduled`。因此该节点被中断时必须把自身保留在 continuation 中；恢复后重试节点以激活剩余实例。已经完整提交后才产生 blocker 的节点（例如年度考核）则从下一个节点恢复。

### 3. 同日恢复语义

每次 `ADVANCE_TIME` 依次检查：

1. 活动 blocker：原地返回；
2. 事件 continuation：恢复因果队列，再次产生 blocker 时原地返回；
3. 时间轴 continuation：按持久化顺序恢复节点。

执行过时间轴 continuation 的这次操作永不增加日期。全部节点完成后清空 continuation；下一次 `ADVANCE_TIME` 才进入新日。连续 blocker 可以反复保存和恢复，已经完成的月结或年考不重新执行。

### 4. 政策到期选择与一次推进

到期生效条件为 `status === approved && effectiveAtDay <= currentDay`，按 `effectiveAtDay → instanceId` 排序。阶段条件为 `status === implementing && nextMilestoneAtDay <= currentDay`，按 `nextMilestoneAtDay → instanceId` 排序。

每项政策在一个单日事务中最多推进一个阶段。过期里程碑不会在同一天连续补跳多个阶段；暂停政策不入选，恢复后的顺延日期继续作为事实来源。

显式政策 Action 和自动时间轴共用 `policy-transition-transaction.ts`：先更新实例，再应用效果，派生指标信号，最后进入事件 continuation。这样政策指标效果不会因替换实例而丢失，任何失败都由外层事务回滚。

### 5. 行动身份与来源冻结

`START_ACTION` 创建稳定 `instanceId`，同时冻结 `originPositionId`、`originInstitutionId` 和 `originRegionId`。完成信号使用这些字段，不读取完成时的当前任职。行动期间发生调任时，事件仍归属行动启动时的机构和地区。

行动效果、冷却、槽位释放和 `action.completed` 在同一时间事务中提交；所有当日行动信号随后统一编排。

### 6. 指标信号派生顺序

`deriveMetricSignalsFromEffects()` 读取统一效果执行器的 `AppliedEffectRecord[]`：

- 只处理实际变化的 `world_metric` 和 `policy_metric`；
- 同一事务同一指标多次变化折叠为最终值；
- 保持首次出现的稳定顺序；
- 政策指标上下文从受影响实例冻结的 `originContext` 获取。

事件选项和自动事件均按“效果 → 指标信号 → `event.resolved`”进入级联。政策转换按“生命周期信号 → 指标信号”提交，并与行动信号一起在计划事件前处理。

### 7. Schema 5→6

Schema 6 新增 `time.pendingContinuation`、行动稳定身份/来源字段和完整 `ActionExecutableSnapshot`。迁移规则：

- `pendingContinuation = null`；
- 执行中行动 ID 为 `legacy-action-{tier}-{slotIndex}-{startedAtDay}-{actionId}`；
- 来源使用 Schema 5 当前任职；
- 仅接受已知的 Schema 5 内容版本，并按稳定部门/行动 ID 补齐部门显示、完整行动定义、属性边界和内容版本；
- 行动无法解析，或名称、分类、持续时间、冷却与已知定义不一致时，在解码阶段拒绝迁移并保留原始备份；
- 不使用随机数、系统时间或数组索引作为新运行时身份（槽位索引仅参与确定性的旧存档迁移键）；
- 不改变行动开始日、持续时间或完成日；
- Schema 2→3→4→5→6 继续链式迁移。

## 原子边界

整个 `ADVANCE_TIME` 在完整 `PlayerSave` 副本上运行。效果目标解析失败、政策状态不一致、事件级联超限、快照不一致或 continuation 非法时，副本被丢弃；时间、行动、政策、月结、年考和事件队列均不提交部分结果。

政策转换中只有 `policyIndex === null` 表示新实例。非空索引必须是有效整数、位于数组范围内，且原实例 ID 与转换结果一致；违反任一不变量都会抛错，禁止静默追加重复实例。

## 后果

- blocking 后刷新可以恢复准确的同日剩余工作。
- 政策、行动、考核和指标成为 #95 可消费的真实领域信号来源。
- Store 事务层增加明确的政策转换与单日时间轴提交器。
- 政治周期和退休检查目前只保留顺序/恢复节点；具体任职循环由 #95 实现。
- 当前仍不包含政策与事件 UI；产品呈现留给 #98。
