# 政途人生 v3.0 — 开发路线图

> 本文档供 AI 编码会话延续使用，包含完整的项目状态、架构约定、待开发功能和实现指南。
> 最后更新：2026-07-17

---

## 1. 项目当前状态

### 1.1 运行统计

| 指标 | 数值 |
|------|------|
| 已合并 PR | 10 个 (#1-#10, #16) |
| 开放 PR | 1 个 (#21 feat/character-creation-v2) |
| 开放 Issue | 10 个 |
| 源文件总数 | 39 个 |
| 引擎文件 | 10 个 |
| 页面文件 | 12 个（7 页 + 5 个建档子组件） |
| 测试文件 | 9 个 |
| 测试用例 | 159 个 |

### 1.2 技术栈

```
框架: SolidJS + TypeScript + Vite
状态: createStore + produce (Solid built-in)
路由: 自建 hash router
样式: 内联 style 对象 + CSS 变量 design tokens
后端: Supabase（Auth + Database）
配置: JSON 文件，ConfigLoader 单例加载
校验: zod schema (scripts/validate-config.ts)
```

### 1.3 质量门禁命令

```bash
pnpm format:check    # Prettier
pnpm lint            # ESLint v9 flat config (0 errors required)
pnpm typecheck       # tsc --noEmit (strict mode)
pnpm test            # vitest run
pnpm validate:config # tsx scripts/validate-config.ts
pnpm build           # vite build
```

### 1.4 分支工作流

```
1. git checkout -b <type>/<desc> from main    # 从 main 新建分支
2. 编写代码 + 测试
3. git push + 创建 PR
4. CI 全部通过 + OpenCode review 通过
5. Squash Merge 到 main

分支命名: feat/<name> | fix/<name> | refactor/<name> | docs/<name> | chore/<name>
```

**禁止直接 push main。**

---

## 2. 架构约定

### 2.1 分层架构（自顶向下）

```
UI (Solid pages/components)
  → Store (createStore + dispatch)
    → Engine (pure functions)
      → Config (JSON + loader)
```

- **引擎函数必须纯函数**：无 DOM、无全局状态、无 store 引用
- **引擎文件 ≤ 200 行**
- **所有类型放在 `src/types/`**
- **状态变更唯一入口**：`dispatch(action)` → `reduceGameState(draft, action)`
- **测试用 `createTestStore()` 隔离**，不 import 模块级 store
- **JSON 配置优先**：游戏数值修改只改 JSON，不改代码

### 2.2 关键约定

- `<For each={list}>` 替代 `Array.map()`（ESLint `solid/prefer-for` 强制）
- `玩家属性变更` 用 `applyPlayerAttr()` 会校验 clamp
- `non-null !` 必须带安全说明注释
- `familyBackground/promotionPath` 存储英文 ID（`'worker'`），UI 显示中文名
- `PromotionStage` 等枚举用英文值 key，中文值 value

### 2.3 文件命名

```
源文件: kebab-case.ts
页面组件: kebab-case.tsx
测试文件: *.test.ts (非 .spec.ts)
引擎 domain: src/engine/<domain>/<module>.ts
引擎测试:   src/engine/<domain>/__tests__/<module>.test.ts
```

---

## 3. 现有引擎模块

### 3.1 已完成 (10/29)

```
src/engine/
├── core/           ✅ 3/3
│   ├── time.ts        # 时间推进 + 周期检测
│   ├── action.ts      # 行动执行 + 校验
│   └── effect.ts      # 效果解析 (⚠️ 缺测试)
├── governance/     ✅ 3/3
│   ├── kpi.ts         # KPI 完成率 + 等次
│   ├── budget.ts      # 月度消耗 + 结算
│   └── assessment.ts  # 年度考核 + 晋升资格
├── career/         ✅ 3/3
│   ├── promotion.ts         # 晋升阶段 0-2
│   ├── promotion-final.ts   # 晋升阶段 3-6
│   └── faction-penalty.ts   # 派系惩罚计算
└── index.ts       ✅
```

### 3.2 待开发 (19/29)

```
⬜ social/        0/3
   relations.ts      # 人脉网络管理（关系值变化、网络扩展）
   factions.ts       # 派系博弈（声望计算、派系对抗）
   superior.ts       # 上级互动（好感度、汇报、请示）

⬜ office/        0/3
   secretary.ts      # 秘书管理（经验值、等级晋升）
   documents.ts      # 文件批示（公文生成、审批效果）
   sentiment.ts      # 舆情管理（舆情生成、热度衰减、应对）

⬜ risk/          0/3
   investigation.ts  # 双规审查（证据收集、定罪判定）
   corruption.ts     # 贪腐风险（risk 增长/衰减、触发阈值）
   patrol.ts         # 巡视组（随机检查、问题反馈）

⬜ legacy/        0/6
   successor.ts      # 接班人培养
   think-tank.ts     # 智囊团
   mentor.ts         # 导师系统
   opportunity.ts    # 历史机遇
   constitution.ts   # 修宪
   history-eval.ts   # 历史评价

⬜ personal/      0/3
   life.ts           # 个人生活（住房、子女教育、健康）
   calendar.ts       # 日历事件
   archives.ts       # 档案查询

⬜ 杂项/          0/3
   events.ts         # 随机事件引擎
   proposals.ts      # 重大议案
   retirement.ts     # 退休结算
```

---

## 4. 现有页面模块

### 4.1 已完成页面 (7)

| 页面 | 路由 | 文件 | 状态 |
|------|------|------|------|
| Splash | `/` | `pages/auth/splash.tsx` | ✅ |
| Login | `/login` | `pages/auth/login.tsx` | ✅ Phase 0 占位 |
| 建档 | `/character` | `pages/character/character-creation.tsx` + 5 子组件 | ✅ v2 (PR #21) |
| 仪表盘 | `/dashboard` | `pages/dashboard/dashboard.tsx` | ✅ |
| KPI | `/kpi` | `pages/career/position-kpi.tsx` | ✅ |
| 部门行动 | `/dept/:idx` | `pages/career/position-dept.tsx` | ⚠️ 有 blank page bug (#17) |
| 晋升 | `/promotion` | `pages/career/promotion.tsx` | ✅ |

### 4.2 待开发页面 (~9)

| 页面 | 路由 | 优先级 | 说明 |
|------|------|--------|------|
| 上级关系 | `/superior` | 中 | Dashboard 入口已注册，#20 |
| 人脉网络 | `/relations` | 中 | Dashboard 入口已注册，#20 |
| 个人生活 | `/personal` | 中 | Dashboard 入口已注册，#20 |
| 档案成就 | `/archives` | 低 | Dashboard 入口已注册，#20 |
| 秘书处 | `/secretary` | 中 | 设计文档 §7.7 |
| 转职 | `/transfer` | 中 | career/transfer.ts |
| 双规审查 | `/investigation` | 低 | risk/investigation.ts |
| 议案 | `/proposals` | 低 | proposals.ts |
| 结局 | `/ending` | 低 | retirement.ts |

---

## 5. 配置文件结构

### 5.1 目录结构

```
src/config/
├── constants.json                      # 全局常量（阈值、属性边界）
├── loader.ts                          # ConfigLoader 单例
├── templates/
│   ├── departments.json               # 19 个部门模板
│   ├── departments-extra.json         # 额外 11 个部门模板
│   ├── kpis.json                      # 32 个 KPI 指标模板
│   ├── events.json                    # 3 个随机事件
│   ├── regions.json                   # 31 省（2008 分数线 + 城市）
│   ├── universities.json              # 4 档 40 所院校
│   └── backgrounds.json               # 5 家庭背景 + 4 晋升通道
└── career-lines/
    ├── administrative.json            # 行政线 L1-L3 (10 职位) ⚠️ 缺 L4-L11
    ├── party.json                     # 党务线（空壳）
    ├── discipline.json                # 纪检线（空壳）
    └── mass.json                      # 群团线（空壳）
```

### 5.2 JSON 修改规则

修改数值直接编辑对应 JSON，然后运行 `pnpm validate:config` 验证即可，不需要改代码。

---

## 6. 可玩的游戏流程

### 6.1 当前流程

```
Splash → Login(跳过) → 建档(5步) → NEW_GAME
  → 仪表盘
    ├─ /dept/:idx → EXECUTE_ACTION → KPI 变化 + 时间推进
    ├─ 推进时间 → 月度结算 + 年度考核 → frozenPeriods
    ├─ /kpi → 查看 KPI 等次
    └─ /promotion → START_PROMOTION
        → 6 阶段 → 成功(L++)
        → 失败(消沉)
              ↓
         回到仪表盘继续循环
              ↓
        L3→L4: 无配置 → 循环终止
```

### 6.2 当前阻塞 (Critical)

| 问题 | Issue | 说明 |
|------|-------|------|
| 部门页面空白 | #17 | `deptState` 首次访问返回 null，Show 条件阻断 |
| L4+ 无配置 | #18 | 晋升到 L3 后无目标，游戏循环终止 |

---

## 7. 建档系统 v2 详解 (PR #21)

### 7.1 5 步流程

| 步 | 内容 | 数据源 |
|----|------|--------|
| 1 | 姓名 + 性别 | — |
| 2 | 省份 → 城市（级联滚动列表） | `regions.json` (31 省, 2008 分数线) |
| 3 | 高三成绩（Box-Muller 正态随机 + 无限重掷） | 各省独立 `scoreDistribution` |
| 4 | 档次 → 院校（向下兼容：985 可选 211→本科） | `universities.json` (4 档 40 所) |
| 5 | 家庭背景 + 晋升通道（双列 + 加成预览） | `backgrounds.json` (5+4) |

### 7.2 特殊规则

- **民族加分**：7 个自治区 `ethnicBonus: 10-30`，加到有效分
- **预科班**：西藏/新疆/青海，额外降 50 分，入职延迟 1 年
- **分数线**：各省独立设定 4 条线（2008 年实际值），直接写死在 regions.json 不用计算
- **分数分布**：各省独立 `mean/stddev`（如河南 mean=470 stddev=95，北京 mean=430 stddev=85）

### 7.3 关键类型

```typescript
// CharacterData (src/types/character.ts)
interface CharacterData {
  characterName: string;
  gender: '男' | '女';
  province: string;
  city: string;
  gaokaoScore: number;
  gaokaoTier: string;      // '985' | '211' | '本科' | '专科'
  university: string;
  universityTier: string;
  familyBackground: string; // 'peasant' | 'worker' | 'merchant' | 'cadre' | 'academic'
  promotionPath: string;    // 'xuandiao' | 'gongwuyuan' | 'junzhuan' | 'guoqi'
  isPreparatory: boolean;
}

// PlayerSave 关键变更 (src/types/player.ts)
// 删除: education, motivation, personality
// 新增: gaokaoScore, gaokaoTier, university, universityTier, promotionPath, isPreparatory
// birthPlace: string → { province: string; city: string }
// familyBackground union: 中文名 → 英文 ID
// startYear: 2024 → 2012
// defaultStartingAge: 30 → 22
// birthYear = startYear - defaultStartingAge = 1990
```

### 7.4 子组件位置

```
src/pages/character/
├── character-creation.tsx   # 主组件（251 行, 导航 + 5 步容器）
├── StepBasicInfo.tsx        # Step 1: 姓名 + 性别 (76 行)
├── StepBirthplace.tsx       # Step 2: 省份→城市级联 (142 行)
├── StepGaokao.tsx           # Step 3: 高考成绩 (101 行)
├── StepSchool.tsx           # Step 4: 档次→院校 (148 行) [schools 用 createMemo]
└── StepBackground.tsx       # Step 5: 背景×通道 (157 行)
```

---

## 8. 设计令牌系统 (PR #10)

### 8.1 全局配色

```typescript
// 文件: src/utils/theme.ts + src/styles/tokens.css
colors = {
  primary: '#be2d2d',        // 中国红（权力操作）
  secondary: '#2b4e6e',      // 藏蓝（信息查看）
  bgMain: '#1a1a2e',         // 深蓝黑底色
  bgCard: '#0f0f23',         // 深色卡片
  bgCardLight: '#ffffff',    // 亮色卡片
  bgInput: '#f8f7f5',        // 输入框底色
  textPrimary: '#e8e6e3',    // 正文
  textSecondary: '#8b8680',  // 弱化文字
  textDark: '#1a1a1a',       // 亮卡文字
  success: '#4caf50',        // 正向
  warning: '#e6a817',        // 警告
  danger: '#c44d4d',         // 危险
  border: '#3a3540',         // 深色分隔
  borderLight: '#d4c5b9',    // 亮色分隔
}
radius = { sm: '2px', md: '4px', lg: '8px', xl: '12px' }
font = { title: '楷体', body: '系统 sans-serif' }
```

### 8.2 工具函数

```typescript
// src/utils/theme.ts
cardStyle(pad?)      → 亮色卡片样式对象
darkCardStyle(pad?)  → 暗色卡片样式对象
pageBase             → 页面容器基础样式
progressBarColor(rate) → 进度条颜色（≥1 success, ≥0.6 primary, else danger）
```

---

## 9. 晋升引擎详解 (PR #9)

### 9.1 六阶段状态机

```
① democratic_vote  → ② org_inspection → ③ joint_review
④ committee_vote   → ⑤ public_notice  → ⑥ probation
```

### 9.2 关键流程

- `START_PROMOTION` → `checkPrerequisites()` → 阶段 0（门槛）
- `PROMOTION_RESOLVE_STAGE` → 各阶段引擎函数 + 玩家选择
- 晋升中锁定 ADVANCE_TIME / EXECUTE_ACTION
- Store gate: `canAct(stage)` 只有 idle/completed/failed 时允许操作

### 9.3 测试确定性

- 引擎函数 `rng` 参数可注入（默认 Math.random）
- Store `PROMOTION_RESOLVE_STAGE` 支持 `_rng` 字段注入

### 9.4 配置 (`constants.json.promotion`)

```json
"promotion": {
  "democraticVote": { "passThreshold": 60, "connectionsBonus": 10, "connectionsRiskProbability": 0.3 },
  "orgInspection": { "excellentThreshold": 80, "qualifiedThreshold": 60, "suspendedThreshold": 40, "influencePoliticalCost": 20, "influenceScoreBonus": 8 },
  "jointReview": { "disciplineCorruptionThreshold": 50, "otherDepartmentsPassRate": 0.85 },
  "committeeVote": { "minSize": 7, "maxSize": 13, "sizePerLevelInterval": 2 },
  "publicNotice": { "complaintProbPerRisk": 0.005, "sentimentProbPerRisk": 0.003 },
  "probation": { "passThreshold": 55 },
  "progression": { "demoralizationOnFail": 5, "demoralizationOnRejected": 8, "politicalCapitalBonusOnSuccess": 10 }
}
```

---

## 10. 已知 Bugs & Issues

| Issue | 标题 | 严重度 | 状态 |
|-------|------|--------|------|
| #17 | 部门行动页面首次访问空白 — deptState 懒初始化为 null | 🔴 bug | Open |
| #18 | 行政线配置仅填充 L1-L3 | 🟡 content | Open |
| #19 | 核心游戏流程缺少集成测试覆盖 | 🟡 quality | Open |
| #20 | 仪表盘 4 个子系统入口路由未注册，点击 404 | 🟡 feature | Open |
| #11 | effect.ts 缺少测试（引擎层 ≥90% 覆盖率门槛） | 🟡 bug | Open |
| #12 | 晋升引擎硬编码 10 处数值 | 🟡 bug | Open |
| #13 | 代码规范违反：GameAction + JSDoc + non-null | 🟡 bug | Open |
| #14 | AGENTS.md 持久化策略描述与实际行为矛盾 | 🟡 bug | Open |
| #15 | 清理未使用依赖及废弃 ESLint 参数 | 🟡 chore | Open |
| #7 | 建档阶段选择按钮显示异常 | 🟡 bug | Open |

---

## 11. 后续开发优先级 (建议顺序)

### P0 — Critical (应立即修复)

1. **#17 部门页面空白 bug** — `deptState` 改为返回零值默认状态
   - 文件: `src/pages/career/position-dept.tsx:53`
   - `return state.departmentStates[cfg.id] ?? null` → `?? { id: ..., kpiValues: {}, ... }`

### P1 — 核心循环 (解锁游戏可玩性)

2. **#18 行政线 L4-L11 配置补全** — `administrative.json` 加 ~30 个职位
3. **#20 404 入口处理** — 隐藏或实现未完成的子系统入口

### P2 — 引擎扩展 (增加系统深度)

4. **social/relations.ts + superior.ts** — 人脉 + 上级互动
5. **career/transfer.ts + reserve.ts** — 转职引擎 + 后备干部池
6. **#12 晋升引擎硬编码外移** — 将引擎中 10 处数值迁移到 constants.json

### P3 — 子系统 UI (增加页面)

7. **/superior 页面** — 上级互动 UI
8. **/relations 页面** — 人脉网络 UI
9. **secretary 页面** — 秘书处 (5 Tab 设计)
10. **personal/life page** — 个人生活

### P4 — 打磨

11. **#11 effect.ts 补测试** — 覆盖率门槛
12. **#13 代码规范** — 统一 GameAction 类型位置 + JSDoc
13. **#15 清理** — 依赖和 ESLint

---

## 12. Store 关键文件说明

### 12.1 `src/store/game-store.ts` (674 行)

```
createInitialState(overrides?)     # 创建初始 PlayerSave
GameAction union type              # 所有 action 类型定义 (共 11 个)
reduceGameState(draft, action)     # 唯一的状态 reducer
  ├─ SET_GRANULARITY              # 切换推进粒度
  ├─ EXECUTE_ACTION               # 执行部门行动
  ├─ ADVANCE_TIME                 # 推进时间（触发持久化）
  ├─ START_PROMOTION              # 启动晋升
  ├─ RESET_PROMOTION              # 重置晋升状态
  ├─ PROMOTION_RESOLVE_STAGE      # 晋升阶段推进
  ├─ LOAD_SAVE                    # 加载存档
  └─ NEW_GAME                     # 新游戏（含背景+通道加成）
dispatch(action)                   # 派发动作（写 localStorage + Supabase）
createTestStore(overrides?)        # 隔离测试 store
useGameStore()                     # 组件 hooks
```

### 12.2 关键辅助函数

```
canAct(stage)                      # 非 idle/completed/failed 禁止操作
buildPromotionContext(draft)       # 从 draft 提取晋升上下文
resolveTriggers(draft, triggers)   # 处理周期事件 (月度/年度)
applyPlayerAttr(draft, attr, delta, bounds)  # 带 clamp 的属性变更
```

---

## 13. 工具文件

### 13.1 `src/utils/gaokao.ts` (高考分数引擎)

```typescript
generateGaokaoScore(province)      # Box-Muller 正态随机 + 档次判定
determineTier(raw, effective, bonus, province)  # 分数判定档次
getAvailableTiers(earnedTier)      # 获取可选的向下档次列表
```

### 13.2 `src/utils/math.ts`

```typescript
clamp(value, min, max)             # 钳位
clampAttr(key, value, bounds)      # 按属性名钳位
normalRandom(mean, stddev)         # Box-Muller 正态随机
weightedRandom(min, max)           # 均匀随机整数
randomInt(max)                     # 0~max-1 随机
pickRandom(arr)                    # 随机选取
```

### 13.3 `src/utils/theme.ts`

```typescript
colors / radius / space / font     # 设计令牌常量
pageBase / cardStyle / darkCardStyle  # 样式工具函数
progressBarColor(rate)             # 进度条颜色
```

### 13.4 `src/utils/format.ts`

```typescript
formatDate(year, month, day)       # 日期格式化
formatGranularity(g)               # 推进粒度格式化
formatPercent(rate)                # 百分比格式化
formatCurrency(amount)             # 货币格式化
```

---

## 14. 活动分支

| 分支 | 状态 | PR | 说明 |
|------|------|----|------|
| `feat/character-creation-v2` | Open | #21 | 建档 5 步向导 v2（3 轮审查修复完毕，待合并） |

---

## 15. 新会话快速启动指南

```bash
# 1. 切换到项目目录
cd /root/github/zhengtu

# 2. 从 main 创建新分支
git checkout main && git checkout -b feat/<your-feature>

# 3. 初始化 Node 环境
export NVM_DIR="/root/.nvm" && . "$NVM_DIR/nvm.sh"
export PNPM_HOME="/root/.local/share/pnpm" && export PATH="$PNPM_HOME:$PATH"

# 4. 运行测试确认基线
pnpm typecheck && pnpm test && pnpm build

# 5. 开始开发...
```

### 常用命令速查

```bash
pnpm format:check          # 检查格式
pnpm prettier --write 'src/**/*.{ts,tsx,json}'  # 修复格式
pnpm lint                  # ESLint 检查
pnpm typecheck             # TypeScript 检查
pnpm test                  # 运行所有测试
pnpm test -- --reporter=verbose <file>  # 运行单个测试文件
pnpm validate:config       # 配置校验
pnpm build                 # 生产构建
pnpm run ci                # 全量 CI

# 查看 PR/Issue
gh pr list --state merged
gh issue list

# Git 操作
git log origin/main --oneline -10
git add . && git commit -m "type(scope): description"
git push -u origin <branch>
gh pr create --title "..." --body "..." --base main
```

---

## 16. 引擎伪代码概要 (未来开发参考)

### 16.1 social/relations.ts (~80 行)

```typescript
// 关系值变化 - 纯函数
export function modifyRelation(relations: RelationState, category: string, npcId: string, delta: number): RelationState
// 添加新联系人
export function addContact(relations: RelationState, category: string, npcId: string, initialValue: number): RelationState
// 获取最高关系值联系人
export function getTopContacts(relations: RelationState, category: string, topN: number): { id: string; value: number }[]
```

### 16.2 social/superior.ts (~100 行)

```typescript
// 上级互动 - 纯函数
export function interactWithSuperior(favor: number, action: SuperiorAction, politicalCapital: number, config: GameConfig): { newFavor: number; capitalCost: number; result: string }
// 派系对齐度计算
export function calcAlignment(factionAlignment: string, superiorFaction: string): number
// 汇报效果计算
export function reportToSuperior(favor: number, competence: number): { favorGain: number; detail: string }
```

### 16.3 career/transfer.ts (~120 行)

```typescript
// 跨线转职 - 纯函数
export function canTransfer(currentLevel: number, transferCount: number, config: GameConfig): boolean
export function getTransferOptions(currentLine: CareerLine, currentLevel: number, config: GameConfig): CareerLine[]
export function executeTransfer(currentLine: CareerLine, targetLine: CareerLine, currentLevel: number): { newPositionId: string; cost: number }
```

### 16.4 risk/corruption.ts (~90 行)

```typescript
// 贪腐风险增长/衰减
export function updateCorruptionRisk(currentRisk: number, actionRisk: number, config: GameConfig): number
export function checkInvestigationTrigger(risk: number, randomValue: number, config: GameConfig): boolean
export function calcInvestigationOutcome(evidence: EvidenceStrength, integrity: number): { convicted: boolean; penalty: string }
```

---

## 17. 事件系统 (events.json 当前仅 3 个事件)

### 设计原则

- 事件触发条件: `minLevel`, `maxLevel`, `careerLines`, `minScore`, `requiredFlag`
- 每个事件 3 个选项，每个选项有 `effects` (target/value pairs)
- 可选 `risk` 字段（概率 + 风险类型）

### 示例事件结构

```json
{
  "id": "evt_inspection_notice",
  "title": "巡视组进驻通知",
  "description": "上级纪委巡视组将于下月进驻你所在地区，进行为期三个月的常规巡视。",
  "triggerCondition": { "minLevel": 3, "careerLines": ["admin"] },
  "options": [
    { "label": "积极配合", "description": "主动提供材料，配合巡视工作", "effects": [{"target": "player.integrity", "value": 5}, {"target": "player.superiorFavor", "value": 5}] },
    { "label": "打招呼", "description": "通过关系打招呼，试图降低检查力度", "effects": [{"target": "player.corruptionRisk", "value": 10}, {"target": "player.politicalCapital", "value": -10}], "risk": {"type": "investigation", "probability": 0.3} },
    { "label": "置之不理", "description": "正常运作，不特别应对", "effects": [{"target": "player.stability", "value": 3}] }
  ]
}
```

### 事件数量需求

| 级别段 | 事件数 | 说明 |
|--------|--------|------|
| L1-L3 (科员-正科) | ~10 | 基础事件 |
| L4-L6 (副处-副厅) | ~15 | 增加复杂度 |
| L7-L9 (正厅-副部) | ~10 | 高级政治 |
| L10-L11 (正部) | ~5 | 顶级政治 |
| 跨级 | ~10 | 通用事件 |

---

## 18. 数据配置补全 (Issue #18)

### 18.1 行政线 L4-L11 职位定义

每级需要 3-4 个职位，每个需要：
- `id`, `name`, `departmentTemplateIds`, `kpiTemplateIds`, `annualBudget`
- 对应的 `promotionRequirements`

```
L4 (副处): 副县长, 市局副局长, 县委副书记, 副调研员
L5 (正处): 县长, 市局局长, 县委书记, 调研员
L6 (副厅): 副市长, 省厅副厅长, 市委常委, 副巡视员
L7 (正厅): 市长, 省厅厅长, 市委副书记, 巡视员
L8 (副部): 副省长, 部委副部长, 省委常委, 副部级
L9 (正部): 省长, 部长, 省委书记, 正部级
L10: 国务院副总理, 国务委员
L11: 国务院总理
```

### 18.2 其他职业线 (party/discipline/mass)

各线至少需要 L1-L3 的初始职位定义，后续可逐步扩展。

---

## 19. 后续改动时的关键注意点

1. **加新 engine 函数** → 必须在 `src/engine/<domain>/__tests__/` 写测试 → 在 `src/engine/index.ts` export
2. **加新 action 类型** → 先加 `GameAction` union → 再加 `reduceGameState` case
3. **改 PlayerSave 字段** → 同步更新 `createInitialState()` 默认值
4. **改 JSON 配置** → 同步更新 `types/config.ts` 接口 + `validate-config.ts` zod schema + `loader.ts` 加载
5. **UI 引用新数据** → 通过 `getConfigLoader().getXxx()` 访问，不走全局变量
6. **改已有类型** → 搜索所有引用并更新测试
7. **拆分大文件** → engine ≤200 行，UI 建议 ≤300 行
