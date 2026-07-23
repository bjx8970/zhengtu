# ADR-001: 统一条件/效果模型与 Schema 2 契约

> 状态：已采纳
> 日期：2026-07-22
> 关联 Issue：#91, #92, #93, #94

## 背景

Phase 2 第一实施批次需要冻结持久化契约，使后续事件编排（#57）和岗位机会（#96）不再修改 Schema 2。旧模型存在以下问题：

- 条件使用任意字段路径和开放 Record，配置可写入无法解释的内容
- 效果不区分目标类别，允许无意义组合（如 character.vigor + append）
- 信号载荷无固定结构，事件链仅支持线性步骤
- PlayerSave 为扁平结构，Schema 与 TypeScript 类型手工双写易漂移

## 决策

### 1. 条件表达式：严格判别联合

所有条件按语义判别字段绑定值类型和操作符：

- `CareerCondition`: 按 `careerCheck` 判别，复用领域枚举（InstitutionLevel/LeadershipRank 等）
- `SignalFieldCondition`: 按字段类别判别（字符串 ID 仅 eq/neq+string，数值字段允许比较+number，可空字段 eq/neq+string）
- `PolicyStateCondition`: `status_is` 复用 PolicyStatusSchema，`metric_gte/lte` 必须 number
- `EventHistoryCondition`: `occurred/not_occurred` 无 value，`count_gte/lte` 必须 number
- `ExperienceCondition`: 计数类必须 number，`has_institution` 必须 string
- `FactCondition`: `is_true/is_false` 无 value，`eq/neq` 必须有 value

所有分支 `.strict()` 拒绝未知字段。逻辑组合（all/any/not）同样 `.strict()` 防止冲突字段。

### 2. 效果定义：按目标类别绑定

- 角色数值目标 (character.*): add/multiply/set + number
- 具名数值目标 (career.specialty, governance.*Metric, world.metric): add/set + number + subjectId 必填
- 世界事实目标 (world.fact): set + scalar + subjectId 必填
- 考核分数目标 (assessment.score): add + number

不支持 append/remove 操作（当前无集合类目标）。EFFECT_OPERATIONS 仅导出 add/multiply/set。

### 3. 领域信号快照：按 signalType 判别

8 类信号各有固定载荷 + 实例身份标识：

- `action.completed`: actionInstanceId + actionId + deptId + regionId + institutionId
- `policy.*`: policyInstanceId + policyId + 具体字段
- `appointment.changed`: experienceId + positionId + institutionId + regionId + previousPositionId(nullable)
- `assessment.completed`: year + score + tier
- `world.metric_changed`: metricId + value
- `event.resolved`: eventInstanceId + eventId + optionId(nullable)

使用 `z.discriminatedUnion('signalType', ...)` 确保载荷与信号类型绑定。EventInstance 仅保存 `triggerContext`（DomainSignalSnapshot），不再单独保存 `sourceSignal`。

### 4. 事件链：分支模型

- `activeNodeIds: string[]`（支持多活动节点）
- `completedNodeIds: string[]`
- `sourceEntityType: 'policy' | 'project' | 'appointment' | 'region' | 'story'`
- `sourceEntityId: string`

替代旧的 `currentStepIndex`（仅线性）和 `sourceContext`（开放 Record）。

### 5. Schema 2 与 TypeScript 类型一致性

save-codec 中增加编译期双向可赋值检查：

```typescript
type _AssertSchemaToType = z.infer<typeof PlayerSaveSchema> extends PlayerSave ? true : never;
type _AssertTypeToSchema = PlayerSave extends z.infer<typeof PlayerSaveSchema> ? true : never;
```

如果 Schema 与类型漂移，编译失败。

### 6. 配置边界

- ConfigLoader 使用 `PositionConfigArraySchema.parse()` 解析配置（单一事实来源）
- validate-config 复用同一 Schema + `validatePositionInstitutionConsistency()` 交叉校验
- 职位与机构的 level/region 一致性在 CI 中强制执行

## 不支持项

- 条件中访问任意属性路径或执行 JavaScript
- 效果绕过状态机或删除存档字段
- 信号载荷携带未定义字段
- 事件链无来源实体身份
- Schema 1 自动迁移（明确拒绝 + 备份）

## 后续解释器必须遵守的不变量

- 条件解释器按判别联合分支执行，不得回退到通用路径
- 效果执行器按目标类别分派，不得接受 Schema 未定义的组合
- 信号发出时必须构造完整 DomainSignalSnapshot（含实例身份）
- 事件链实例必须绑定 sourceEntityType + sourceEntityId
- 任何新增信号类型必须同时更新 DomainSignalSnapshot 联合和 SIGNAL_*_FIELDS 分类
