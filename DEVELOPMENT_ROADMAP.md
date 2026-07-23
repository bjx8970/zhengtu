# 政途人生 开发路线图

> 本文档记录当前可验证的实现基线和后续开发顺序。
> 最后校准：2026-07-21，基于 `main` 合并基础工程 PR #88 后的状态。
> 当前版本：0.1.0-alpha.1

## 已完成：项目工程与纵向切片基础

- CI 质量门禁和项目规范（PR #47）
- 行政线 L1-L11 配置与 L11 终局代码（36 个职位，但连续晋升链路未验证，存在 multi_region 阻塞）
- 六步角色建档
- 行动槽位系统（6 槽位 + 分类 + 冷却）
- 时间推进与到期结算
- KPI 与五维年度考核
- 当前晋升流程（7 阶段，支持目标职位选择，但 L5+ 被 multi_region 门槛阻断）
- L11 终局处理（endgameReached）
- localStorage 实时存档
- 启动页继续/建档入口

注：L1-L11 配置已存在，但连续晋升链路尚未通过真实验证（L5 晋升要求 multi_region，而当前履历归档逻辑无法满足）。后续阶段将迁移到职务—职级双通道模型，而非在旧线性方案上继续完善。

## 已完成：基础工程重构

PR #88 完成以下基础工程整理：

- 严格存档解码器（Zod `.strict()` 全层级 + 跨字段一致性校验）
- `SaveEnvelope` 存档封装 + 不兼容存档安全备份
- 统一时间轴引擎（修复结算顺序和跨年 13 月事件）
- 行动实例级运行时快照（消除玩家级临时倍率）
- Store Reducer 分域拆分（game-store.ts 从 1064 行精简到约 290 行）
- 条件持久化（仅实际状态变化时写档）
- 启动页存档错误分类提示
- 相关单元测试和集成测试

## 已完成：Phase 1.5 项目基线校准

- 正式版本体系（`0.1.0-alpha.1`）
- 软件版本、Schema 版本、内容版本分离
- README、架构文档、路线图校准
- 版本管理规范入库（`docs/VERSIONING.md`）
- 职业与治理改版指导入库（`docs/CAREER_REDESIGN_GUIDE.md`）
- CHANGELOG 建立
- 历史设计文档标记
- Issue 清理和 Phase 2 追踪创建

## 已完成：Phase 2 第一实施批次（PR #99）

- 职业/治理/事件领域契约（机构层级、岗位领域、领导职务、公务员职级）
- Career/Governance/Event/World 持久化状态骨架
- 统一条件/效果模型（`ConditionExpression` / `EffectDefinition`）
- 八类 `DomainSignalSnapshot`
- Schema 2 与 Schema 1 安全拒绝
- 36 个职位 + 18 个机构原生配置迁移
- ConfigLoader 稳定 ID 查询

## 当前：Phase 2 第二实施批次 — 事件定义、条件解释与效果执行基础

目标：替换旧事件定义，建立可执行的新版事件配置、条件解释器和统一效果执行器。

1. 删除旧 `GameEvent`/`EventCondition`/`EventOption`/`evaluateEventTrigger`/`filterAvailableEvents`
2. 新版 `EventDefinition` 格式与严格 Zod Schema
3. 统一条件解释器 `evaluateCondition`（纯函数）
4. 统一效果执行器 `applyEffects`（原子事务，效果地址判别联合）
5. ConfigLoader 事件加载与信号索引
6. 事件配置引用与零延迟循环验证
7. 迁移示例事件 `flood_emergency`
8. 治理指标修正为 `MetricCollection`，Schema 2 → 3 迁移

完成标准：

- 旧事件类型和筛选器已删除，`main` 可编译
- 配置 Schema、TypeScript 类型、运行时解释器保持一致
- 条件/效果结算为纯函数或可预测事务
- 非法效果不会部分结算
- 完整 CI 通过

## 下一步：领域信号驱动的事件编排器

- `processDomainSignal` 编排、事件实例生成
- 冷却、互斥、重复控制、延迟调度
- 选项原子结算（`CHOOSE_EVENT_OPTION`）
- 事件 UI 与可中断时间轴

## 后续阶段

按依赖顺序规划（Phase 编号仅用于项目管理，不代表软件版本）：

### Phase 3：基层纵向切片重做

- 试用期、科员、主任科员、乡科级副职、乡科级正职
- 验证职级和领导职务双通道是否有趣
- 科员阶段管理具体任务而非多个部门

### Phase 4：NPC 和岗位机会

- NPC 干部生命周期
- 岗位空缺产生
- 交流和换届
- 职级晋升
- 领导岗位选拔
- 相对竞争

### Phase 5：县市和省部级内容重做

- 将现有 L4-L11（县处级至省部级）旧式线性内容迁移到新职业领域模型
- 县处级、厅局级、省部级岗位领域化
- 地方与中央交流
- 全国性重大任务

### Phase 6：国家级副职原型

- 中央领导协作
- 五年政治周期
- 国家级正职候选池
- NPC 竞争

### Phase 7：国家级正职终局

- 国务院总理、全国人大常委会委员长、全国政协主席
- 国家主席、中共中央总书记、中央军委主席
- 三职兼任最高传奇终局

### Phase 8：扩展治理系统

- 关系网络与上级互动
- 秘书、公文和舆情
- 风险、调查与廉政
- 个人生活、退休和历史评价

### Phase 9：云存档

- Supabase Auth
- 启动时远程加载
- 本地/远程仲裁
- 离线队列和同步状态

## 质量门禁

```bash
pnpm run ci    # format + lint + typecheck + test + validate:config + build
```

覆盖率门槛：Engine ≥ 90%、Config ≥ 80%、Store ≥ 70%。

## 开发约定

### 分支与 PR

从 main 创建 `type/description` 分支，通过质量门禁后创建 PR，CI 和审查通过后 Squash Merge。禁止直接推送 main。

### 版本管理

详见 [docs/VERSIONING.md](docs/VERSIONING.md)。Commit 和 PR 标题不使用代际式命名。

### 变更检查清单

- 新增 Engine 函数：添加同域单元测试，从 `src/engine/index.ts` 导出
- 新增 Store action：先更新 `GameAction`，再在 `reduceGameState()` 增加分支和测试
- 修改 `PlayerSave`：同步默认状态、存档校验和相关测试
- 修改 JSON 结构：同步 TypeScript 类型、zod schema、loader 和配置校验
- 修改 JSON 数值：运行 `pnpm validate:config`

## 长期设计方向

完整产品方向参阅 [docs/CAREER_REDESIGN_GUIDE.md](docs/CAREER_REDESIGN_GUIDE.md)。

历史设计参考：[zhengtu-v3-design.md](zhengtu-v3-design.md)（正式版本体系建立前的文档，其中"v3.0"不代表当前软件版本）。
