# 政途人生

一款以公务员职业生涯与公共治理为主题的模拟游戏。

**当前版本：`0.1.0-alpha.1`**（首个纳入正式版本管理的构建）

当前是**本地单机优先的可玩原型**，聚焦行政线 L1-L3（科员、副科、正科）的纵向体验。玩家可以完成五步建档，在 Dashboard 中安排部门行动、推进时间、完成 KPI 与年度考核，并连续晋升至 L3。

已完成基础工程整理（严格存档解码、统一时间轴、行动运行时快照、Store Reducer 拆分），但尚未完成职务与职级双通道、NPC 和岗位机会系统。

## 当前可玩内容

| 能力     | 当前状态                                                                    |
| -------- | --------------------------------------------------------------------------- |
| 建档     | 五步角色创建（高考→学校→出生地→背景→职业线）                                |
| 职业发展 | 行政线 L1-L3，共 10 个职位配置；正常流程按每级首个职位晋升                  |
| 核心循环 | 行动排期 → 时间推进 → 到期结算 → KPI/考核 → 晋升                            |
| 行动槽位 | 主要 3 个、次要 2 个、备用 1 个；按重大/次要/日常分类并执行冷却规则         |
| 时间推进 | 1 天 / 7 天 / 30 天；统一时间轴确保行动完成→月度结算→年度考核顺序           |
| 考核     | 五维年度考核（德、能、勤、绩、廉）                                          |
| 晋升     | 民主推荐→组织考察→联审→票决→公示→任命→试用期                                |
| 存档     | SaveEnvelope 封装 + 严格 Schema 校验 + 不兼容存档安全备份                   |
| 页面     | 启动页（含存档状态提示）、五步建档、综合 Dashboard                          |

尚未实现：职务与职级双通道、岗位领域交流、NPC 竞争、岗位空缺驱动晋升、省部级以上内容、云存档。

## 快速开始

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

无需配置后端即可使用本地自动存档。

## 质量检查

```bash
pnpm run ci        # 一键全检：format + lint + typecheck + test + validate:config + build
```

## 技术栈

SolidJS + TypeScript + Vite | Vitest | localStorage | GitHub Pages

## 工程基础

- 严格存档 Schema（Zod `.strict()` 全层级 + 跨字段一致性校验）
- 统一时间轴引擎（`advanceTimeline()`，修复跨年和结算顺序）
- 行动实例级运行时快照（理念偏离倍率绑定到具体行动）
- Store Reducer 分域拆分（action / time / career / character）
- 条件持久化（仅实际状态变化时写档）
- CI 质量门禁（format + lint + typecheck + test + config + build）

## 下一阶段

> 职业领域模型与职务—职级双通道重构

详见 [开发路线图](DEVELOPMENT_ROADMAP.md) 和 [改版指导](docs/CAREER_REDESIGN_GUIDE.md)。

## 文档

- [架构文档](ARCHITECTURE.md) — 技术决策、系统设计、数据流
- [开发路线图](DEVELOPMENT_ROADMAP.md) — 当前实现、阶段规划
- [开发指南](CONTRIBUTING.md) — 环境准备、编码规范、测试要求
- [版本管理规范](docs/VERSIONING.md) — 版本号、发布和存档兼容政策
- [职业与治理改版指导](docs/CAREER_REDESIGN_GUIDE.md) — 长期产品方向
- [历史设计文档](zhengtu-v3-design.md) — 正式版本体系建立前的设计参考

## 许可证

[GNU AGPLv3](LICENSE)
# 政途人生 v3.0

一款以基层治理与干部成长为主题的仕途模拟游戏。

当前版本是**本地单机优先的可玩原型**，聚焦行政线 L1-L3（科员、副科、正科）的纵向体验。玩家可以完成五步建档，在 Dashboard 中安排部门行动、推进时间、完成 KPI 与年度考核，并连续晋升至 L3。

4 条职业线、11 个级别和更完整的职位体系属于长期设计目标，不代表当前已经实现的内容。

## 当前范围

| 能力     | 当前状态                                                                    |
| -------- | --------------------------------------------------------------------------- |
| 职业发展 | 行政线 L1-L3，共 10 个职位配置；正常流程按每级首个职位晋升                  |
| 核心循环 | 行动排期 → 时间推进 → 到期结算 → KPI/考核 → 晋升                            |
| 行动槽位 | 主要 3 个、次要 2 个、备用 1 个；按重大/次要/日常分类手动选槽并执行冷却规则 |
| 页面     | 本地存档启动页、五步建档、综合 Dashboard                                    |
| 存档     | 每次操作自动写入 localStorage；启动页可继续已有游戏                         |

每次晋升前必须先完成所有在途行动；成功后可开始新任期并继续积累晋升条件。行政职位配置在 L3 封顶，尚无 L4 晋升目标。

## 快速开始

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

无需配置后端即可使用本地自动存档。

登录界面和运行时远程同步暂时停用。项目仍保留 Supabase 远程存档基础代码，供后续云存档阶段接入；以下环境变量不影响当前本地游戏：

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

## 质量检查

```bash
pnpm run ci        # 一键全检：format + lint + typecheck + test + validate:config + build
pnpm dev           # 开发服务器（HMR）
pnpm build         # 生产构建
```

## 技术栈

SolidJS + TypeScript + Vite | Vitest | localStorage | GitHub Pages

## 文档

- [架构文档](ARCHITECTURE.md) — 技术决策、系统设计、数据流
- [开发指南](CONTRIBUTING.md) — 环境准备、编码规范、测试要求
- [开发路线图](DEVELOPMENT_ROADMAP.md) — 当前实现、近期目标和阶段规划
- [设计文档](zhengtu-v3-design.md) — 完整产品与技术设计

## 长期目标

在当前纵向切片稳定后，项目计划逐步扩展：

- 将行政线从 L3 扩展至 L11（正部级）。
- 增加党务、纪检和群团职业线。
- 完善关系、上级互动、风险、个人生活和历史评价等系统。
- 在认证和存档恢复流程稳定后提供用户级云存档。

## 许可证

[GNU AGPLv3](LICENSE)
