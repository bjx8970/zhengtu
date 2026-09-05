# Phase 4 验收矩阵

> 基线：`0.4.0-alpha.1` / Schema 14 / 内容版本 `2026.08.8`

本矩阵把 Issue #144 的产品验收项绑定到可重复执行的自动化证据。Phase 4 自然路径测试只通过公开 `dispatch()`（Store 场景）或真实 UI 入口（Playwright 场景）驱动世界：不 push cadre/vacancy/selection/opportunity 实例，不设置最终资格事实跳过 producer，localStorage 仅用于只读断言。

### 已披露的最小化场景前置（非自然演进步骤）

**编制核销**：政治周期届期评估只对"空置且无活动空缺"的席位生产 Vacancy，而当前自然管线中所有空缺都保持 open（无自动过期/取消）。Store 自然路径测试使用真实 `cancelVacancyInTransaction` 事务（`organization_change`，含完整信号级联）代表组织撤销编制，其余全链路（届期评估 → producer → NPC 自主补员 → 信号 → 机会 → 选拔 → 任职）均为真实管线。玩家竞争胜负完全由真实任务/考核/专长事实决定，测试不修改任何竞争事实。

### 自然结果边界（下一步产品跟进项）

- 玩家专长此前没有任何自然生产者（本 PR 通过基层任务补充 `local_governance` 积累），玩家得以进入相对选拔候选池。
- NPC 年度考核按 `baseScore + specialty×0.38 + 任期×1.2 + 历史×0.24` 复利累积，早期即达 90+ 且高于玩家可达的年度考核均值；在玩家完成长期基层专长积累之前，"更优 NPC 自然击败玩家"是当前配置下的真实自然结果（Store 与 E2E 均按此断言）；玩家持续历练后专长事实反超，可凭真实履历在后续真实空缺中获任（自然纵向路径场景证明）。

| 验收项 | 自动化证据 | 结论 |
| --- | --- | --- |
| 有限 NPC 干部生态随正常时间推进自行变化 | `phase4-natural-organization.test.ts` 无玩家操作场景：NPC 年度考核事实积累、首届政治周期创建与阶段推进、组织事实持续变化 | 通过 |
| 至少一个 Vacancy 来自真实 producer（非测试注入） | 政治周期届期评估 producer（同测试"编制核销后真实释放岗位"）；任职级联 producer（副职竞争场景）；NPC 退休/退出 producer（`npc-lifecycle.test.ts` 真实 Store 两年结算） | 通过 |
| 玩家在真实相对竞争中落选，NPC 获选并真实改变组织状态 | `phase4-natural-organization.test.ts` 自然副职竞争场景；`tests/e2e/phase4-natural-career.spec.ts` 自然 UI 路径断言 `selection-outcome` 落选 | 通过 |
| NPC 原岗位产生后续 Vacancy，组织流动可级联 | 副职竞争场景断言 `vacancy:appointment:npc-appointment:cadre_luo_xia:0…` 开放且 `sourceType: appointment`；`npc-appointment-transaction.test.ts` 平级/晋升任职级联 | 通过 |
| 玩家可在后续真实 Vacancy 中再次参选并获选 | 全链场景：政治周期 Vacancy → 镇长机会 → 玩家接受并获任；`phase3-reachability.test.ts` 四年场景正职获任 | 通过 |
| 玩家/NPC 职级与领导岗位双通道独立 | `phase3-reachability.test.ts` 职级里程碑不改变任职；副职竞争场景落选后任职保持科员 | 通过 |
| 政治周期 → 届期评估 → Vacancy → NPC 自主补员/选拔 → 任职闭环；留任不制造伪空缺 | 全链场景经真实管线闭合；届期评估场景断言 occupied/被活动空缺覆盖的席位不生产任何 `vacancy:political_cycle` | 通过 |
| 玩家不参与时 Vacancy 由 NPC 自主竞争并填补（无任何接受/选拔 action，仅推进时间） | `phase4-natural-organization.test.ts` 届期评估场景：`political_cycle` Vacancy 开放 30 天且玩家机会缺位后，NPC-only 相对选拔自主产生唯一赢家并真实任职、级联原岗位（producer key `npc-staffing:{vacancyId}` 保证每空缺实例只尝试一次） | 通过 |
| 玩家首次落选后继续工作，经后续真实 Vacancy 再次参选并凭真实履历获任 | `phase4-natural-organization.test.ts` 自然纵向路径场景：首次副职竞争落选（NPC 获任级联）→ 继续基层历练 → 政治周期释放镇长席位 → NPC 自主补员级联平行副职空缺 → 玩家再入候选池凭真实专长/考核获胜任职；全程不修改任何竞争事实 | 通过 |
| 候选快照冻结、刷新/重放不漂移 | 副职竞争场景中期 `decodeCurrentSave` 重放后赢家一致；自然 UI 路径落选后 `reload()` 结果不变；`selection-transaction.test.ts` 创建即冻结单次 RNG | 通过 |
| 同一 seat 无双 Vacancy；filled 后不可重复消费；取消后机会失效 | `vacancy-lifecycle.test.ts`、`vacancy-transaction.test.ts`、`organization-invariant-checks` 严格解码；全链场景断言周期 Vacancy `filled` 后唯一消费 | 通过 |
| 玩家拒绝/落选不等于 Vacancy 自动关闭 | 副职竞争场景断言落选后仅级联空缺开放、原镇长编制仍 open | 通过 |
| 无合格候选不凭空任命 | `selection-transaction.test.ts` 结构化 `no_qualified_candidates` 终态；`tests/e2e/phase4-career-selection.spec.ts` 无合格候选展示 | 通过 |
| 届期衔接连续、漏届修复、重放幂等 | `political-cycle-timeline.test.ts`：同日衔接下一届、continuation 重放、旧存档漏届补齐 | 通过 |
| 正式页面无 console error | 自然 UI 路径全程收集 console/page error 并断言为空 | 通过 |
| README/ARCHITECTURE/ROADMAP/CHANGELOG/VERSIONING 与实现一致 | 本 PR 同步：`docs/VERSIONING.md`、`ARCHITECTURE.md`、`CHANGELOG.md` 至 `0.4.0-alpha.1` / Schema 14 | 通过 |
| 软件版本 `0.4.0-alpha.1`，Schema/内容版本符合版本规范 | `package.json`、`src/types/save.ts`（`CURRENT_SCHEMA_VERSION = 14`） | 通过 |

发布门禁：`pnpm run ci`、`pnpm test:e2e`、GitHub Actions 全绿，并经人工审查批准后方可合并。
