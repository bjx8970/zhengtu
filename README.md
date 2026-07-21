# 政途人生

一款以公务员职业生涯与公共治理为主题的模拟游戏。

**当前版本：`0.1.0-alpha.1`**（首个纳入正式版本管理的构建）

当前是**本地单机优先的可玩原型**，聚焦行政线 L1-L3（科员、副科、正科）的纵向体验。玩家可以完成六步建档，在 Dashboard 中安排部门行动、推进时间、完成 KPI 与年度考核，并连续晋升至 L3。

已完成基础工程整理（严格存档解码、统一时间轴、行动运行时快照、Store Reducer 拆分），但尚未完成职务与职级双通道、NPC 和岗位机会系统。

## 当前可玩内容

| 能力     | 当前状态                                                                    |
| -------- | --------------------------------------------------------------------------- |
| 建档     | 六步角色创建（基本信息→出生地→高考→学校→背景→职业线）                       |
| 职业发展 | 行政线 L1-L3，共 10 个职位配置；正常流程按每级首个职位晋升                  |
| 核心循环 | 行动排期 → 时间推进 → 到期结算 → KPI/考核 → 晋升                            |
| 行动槽位 | 主要 3 个、次要 2 个、备用 1 个；按重大/次要/日常分类并执行冷却规则         |
| 时间推进 | 1 天 / 7 天 / 30 天；统一时间轴确保行动完成→月度结算→年度考核顺序           |
| 考核     | 五维年度考核（德、能、勤、绩、廉）                                          |
| 晋升     | 民主推荐→组织考察→联审→票决→公示→任命→试用期                                |
| 存档     | SaveEnvelope 封装 + 严格 Schema 校验 + 不兼容存档安全备份                   |

### 实际可达页面

| 路由           | 页面           | 状态 |
| -------------- | -------------- | ---- |
| `/`            | 启动页         | 可用（含存档状态提示） |
| `/character`   | 六步建档       | 可用 |
| `/main`        | 综合 Dashboard | 可用 |
| `/departments` | 部门行动       | 可用 |
| `/assessment`  | 考核详情       | 可用 |
| `/career`      | 职业履历       | 可用 |

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
