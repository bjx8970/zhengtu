# ADR-009：组织世界状态与玩家职业边界

## 状态

已接受（Phase 4 #138）。

## 背景

Phase 3 的 `CareerState` 只表达玩家自己的任职、履历、机会和流程；`WorldState`
则保存开放的 facts、metrics 与政治周期。二者都不能作为 NPC 干部、实际岗位
占用、动态空缺和世界级选拔的唯一事实来源。继续使用职位配置中的
`vacancyCount` 判断当前空缺，也无法表达某个席位何时、为何以及被谁占用。

## 决策

在 `PlayerSave` 增加独立的 `organization: OrganizationState` 子状态：

- `cadres` 保存有限 NPC 干部的稳定身份和必要职业事实，不复制 `PlayerSave`；
- `seats` 保存职位模板实例化后的实际席位和玩家/NPC occupant；
- `vacancies` 保存动态空缺生命周期；
- `selections` 保存世界级候选池、阶段审计和唯一赢家；
- `processedProducerKeys` 为时间轴 producer 提供持久化幂等边界。

玩家的 `CareerState` 仍是玩家职业事实来源，组织世界只通过固定的
`{ type: 'player', id: 'player' }` occupant 引用玩家。NPC 复用既有
`CurrentAppointment`、`CareerExperience` 和 `CareerRestriction` 契约，不获得行动
槽位、预算、治理运行时或玩家事件状态。

Seat ID 从职位 ID 和序号稳定派生。`PositionConfig.vacancyCount` 在本阶段仅用于
实例化模板容量，不代表运行时开放 Vacancy 数。后续所有空缺事实必须读取
`OrganizationState.seats` 与 `OrganizationState.vacancies`。

## 存档策略

持久化结构提升为 Schema 11。Schema 10 迁移在当前绝对日确定性建立有限干部池：

- 玩家有效任职映射到唯一 Seat；
- 配置 NPC 若与玩家占据同一单席位职位，则以未任职状态进入干部池；
- NPC 的任职、履历和职级从迁移日开始；
- 不生成迁移日前的 NPC 考核、任职年限或空缺历史；
- 无法把玩家职位映射到正式配置时迁移失败并保留原始备份。

## 一致性约束

- 一个 Seat 最多一个 occupant；占用元数据必须完整出现或完整为空。
- 一个 NPC 最多一个 active appointment 和一条开放履历，并占据一个 Seat。
- open/selecting Vacancy 的 Seat 必须为空，同一 Seat 最多一个活动 Vacancy。
- Selection 必须引用正式 Vacancy；活动 Selection 对应 selecting Vacancy。
- Selection winner 必须来自冻结候选池。
- 所有稳定 ID 和 producer key 在各自集合内唯一。

## 后果

Phase 4 后续生命周期、Vacancy producer、相对竞争、交流和换届共享同一组织事实
来源。新增持久化事务必须在完整状态副本上校验上述不变量后原子提交；UI 不得
直接修改干部、席位、空缺或选拔状态。
