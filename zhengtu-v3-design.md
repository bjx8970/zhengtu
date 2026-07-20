# 政途人生 v3.0 技术设计文档

## 1. 概述

本文档基于《从政之路 Mobile App v3.0.0 需求文档》，输出完整的技术设计方案，覆盖技术栈选型、系统架构、数据模型、数据库设计、状态管理、游戏引擎、前端架构和配置管理。目标是让一个人能高效开发、维护这个包含 154 个职位、660 个部门、2000+ 行动的仕途模拟游戏。

### 1.1 规模估算

| 维度     | 数量   | 说明                |
| -------- | ------ | ------------------- |
| 职业线   | 4      | 行政/党务/纪检/群团 |
| 级别     | 11     | 科员→正部           |
| 职位     | ~154   | 每级 3~4 个         |
| 部门     | ~660   | 每职位 4~5 个       |
| 行动     | ~2,000 | 每部门 2~4 个       |
| KPI 指标 | ~660   | 每职位 4~5 项       |
| 页面     | ~35    | 含子页面            |
| 玩家属性 | 50+    | 含嵌套结构          |

### 1.2 设计原则

- **数据驱动**：所有职位/部门/行动从配置数据渲染，不为每个实体写独立页面
- **关注点分离**：游戏引擎（纯逻辑）与 UI 层完全解耦，引擎不知道 UI 存在
- **配置继承**：同级别职位共享模板，只覆盖差异项，减少 80% 配置冗余
- **渐进加载**：配置数据按职业线/级别懒加载，首屏只加载当前所需
- **幂等操作**：所有状态变更通过 action dispatch，支持防抖和回放

---

## 2. 技术栈选型

### 2.1 候选方案对比

| 方案                 | 打包体积(估) | 开发效率       | 状态管理           | 生态           | 部署     |
| -------------------- | ------------ | -------------- | ------------------ | -------------- | -------- |
| Vanilla HTML/JS      | ~50KB        | 低（手动 DOM） | 自建 pub/sub       | 无             | 静态     |
| **Preact + Signals** | **~15KB**    | **高**         | **Signals 响应式** | **React 兼容** | **静态** |
| Svelte 5             | ~30KB        | 高             | 内置 runes         | 较小           | 静态     |
| React 19             | ~45KB        | 高             | useState/Reducer   | 最大           | 静态     |
| Vue 3                | ~35KB        | 中高           | Composition API    | 大             | 静态     |

### 2.2 推荐方案：Preact + Signals + esbuild

**核心理由：**

1. **React 模式迁移成本最低**：v2.x 基于 React Native，Preact API 几乎一致，核心业务逻辑（gameApi、game.ts）可近乎直接移植
2. **Signals 是游戏状态的理想模型**：`signal()` 存值，`computed()` 自动派生，`effect()` 响应变更——天然适配"行动 → 数值变化 → UI 更新"的游戏循环
3. **极小运行时**：Preact 3KB + Signals 5KB = 8KB，远小于 React 的 45KB
4. **esbuild 打包**：亚秒级构建，与之前 zhengtu-web 原型一致
5. **零服务器部署**：纯静态文件 + Supabase 后端，可部署到任何静态托管

**技术栈清单：**

```
前端框架:     Preact 10.x + @preact/signals
构建工具:     esbuild
路由:         自建 hash router（~100行）
样式:         Tailwind CSS（CDN）或 手写 CSS
后端:         Supabase（Auth + Database + Storage）
类型系统:     TypeScript 5.x
配置数据:     JSON 文件（esbuild 打包为 JS 模块）
```

### 2.3 技术栈决策的反对意见

诚实列出 Preact 方案的弱点：

- **Preact 社区比 React 小**：遇到问题时可参考的资料少。缓解：Preact 兼容 React API，大部分 React 方案可直接使用
- **Signals 仍是提案阶段**：API 可能变化。缓解：Signals 是薄封装层，必要时可替换为 useReducer
- **没有 SSR/SSG**：纯客户端渲染，首屏白屏时间。缓解：游戏不需要 SEO，加载时显示启动页即可

### 2.4 备选方案

如果倾向零依赖极致简化，Vanilla JS + 自建 pub/sub 仍可行，但需要额外投入约 2-3 周搭建等价于 Signals 的响应式层。如果倾向 Vue 生态，Vue 3 Composition API + Pinia 也是合理选择，但需要从 React 思维模型切换。

---

## 3. 系统架构

### 3.1 分层架构

```
┌─────────────────────────────────────────────────┐
│                  UI 层 (Preact)                  │
│  Pages → Components → Shared UI (Modal, Toast)  │
├─────────────────────────────────────────────────┤
│              Store 层 (Signals)                  │
│  useGameStore() → computed / effect 自动响应     │
├─────────────────────────────────────────────────┤
│             游戏引擎层 (纯 TypeScript)            │
│  TimeEngine / KPIEngine / BudgetEngine /         │
│  PromotionEngine / EventEngine / ...             │
├─────────────────────────────────────────────────┤
│              数据层 (Repository)                  │
│  ConfigRepo (JSON配置)  |  SaveRepo (Supabase)   │
├─────────────────────────────────────────────────┤
│              基础设施层                           │
│  Supabase Client | Hash Router | EventBus        │
└─────────────────────────────────────────────────┘
```

**依赖规则：上层可以调用下层，下层不能调用上层。** 游戏引擎层是纯函数/纯类，不引用任何 Preact 组件或 DOM API。UI 层通过 Store 层桥接引擎和渲染。

### 3.2 模块交互图

```
用户点击"执行行动"
       │
       ▼
  [UI: DeptActionPage]
       │  dispatch('EXECUTE_ACTION', { deptId, actionId })
       ▼
  [Store: GameStore]
       │  调用引擎
       ▼
  [Engine: ActionEngine.execute()]
       │  返回 ActionResult { kpiChanges, budgetDelta, apCost, cooldown }
       ▼
  [Store: GameStore]
       │  更新 signals → 自动触发 UI 响应
       ▼
  [UI: 自动更新] 部门KPI、预算余额、AP余量、冷却倒计时
       │
       │  副作用：检查是否跨月/跨年
       ▼
  [Engine: TimeEngine.advance()]
       │  触发月度结算、年度评估、随机事件
       ▼
  [Store: 批量更新] → [UI: 弹出事件/考核/晋升通知]
```

### 3.3 目录结构

```
src/
├── main.ts                    # 入口：路由初始化 + 挂载
├── router.ts                  # Hash router 实现
├── app.tsx                    # 根组件 + 路由出口
│
├── config/                    # 配置数据
│   ├── career-lines/
│   │   ├── administrative.ts  # 行政线 11 级配置
│   │   ├── party.ts           # 党务线
│   │   ├── discipline.ts      # 纪检线
│   │   └── mass.ts            # 群团线
│   ├── templates.ts           # 职位/部门模板
│   ├── events.ts              # 随机事件库
│   └── constants.ts           # 全局常量
│
├── engine/                    # 游戏引擎（纯逻辑）
│   ├── time-engine.ts         # 时间推进 + 周期结算
│   ├── kpi-engine.ts          # KPI 计算
│   ├── budget-engine.ts       # 预算计算
│   ├── action-engine.ts       # 行动执行
│   ├── promotion-engine.ts    # 晋升六阶段状态机
│   ├── event-engine.ts        # 随机事件生成
│   ├── career-engine.ts       # 职业线/转职
│   ├── assessment-engine.ts   # 年度考核
│   ├── secretary-engine.ts    # 秘书成长 + 文件批示 + 舆情
│   ├── investigation-engine.ts # 双规审查
│   ├── corruption-engine.ts   # 以权谋私
│   ├── proposal-engine.ts     # 重大议案
│   ├── history-eval-engine.ts # 历史评价
│   ├── successor-engine.ts    # 接班人
│   ├── retirement-engine.ts   # 卸任时机
│   ├── think-tank-engine.ts   # 智库顾问团
│   ├── mentor-engine.ts       # 导师计划
│   ├── opportunity-engine.ts  # 历史机遇
│   ├── constitution-engine.ts # 修宪提案
│   ├── superior-engine.ts     # 上级关系
│   ├── patrol-engine.ts       # 专项调查/巡视
│   ├── personal-life-engine.ts # 个人生活
│   ├── archives-engine.ts     # 档案与成就
│   ├── calendar-engine.ts     # 游戏日历
│   └── relation-engine.ts     # 人脉关系网络
│
├── store/                     # 状态管理（Signals）
│   ├── game-store.ts          # 聚合 store + dispatch
│   ├── player-store.ts        # 玩家基础属性
│   ├── position-store.ts      # 当前职位状态
│   ├── dept-store.ts          # 部门运行时状态
│   ├── career-store.ts        # 职业线/晋升
│   ├── time-store.ts          # 游戏时间
│   ├── event-store.ts         # 事件队列
│   ├── secretary-store.ts     # 秘书状态
│   ├── relation-store.ts      # 人脉/派系
│   └── ui-store.ts            # UI 状态（模态框、Toast 等）
│
├── services/                  # 数据访问层
│   ├── config-repo.ts         # 配置数据懒加载
│   ├── save-repo.ts           # Supabase 存档读写
│   └── auth-service.ts        # Supabase 认证
│
├── pages/                     # 页面组件
│   ├── auth/
│   │   ├── splash.tsx
│   │   └── login.tsx
│   ├── character/
│   │   └── character-creation.tsx  # 建档向导（6 步）
│   ├── dashboard/
│   │   └── dashboard.tsx           # 主仪表盘
│   ├── career/
│   │   ├── career-path.tsx         # 职业线总览
│   │   ├── position-hub.tsx        # 职位主界面
│   │   ├── position-dept.tsx       # 部门玩法（复用）
│   │   └── position-kpi.tsx        # KPI 考核
│   ├── promotion/
│   │   ├── promotion.tsx           # 晋升流程
│   │   └── career-transfer.tsx     # 跨线转职
│   ├── secretary/
│   │   └── secretary.tsx           # 秘书处（5 Tab）
│   ├── systems/                    # 各子系统页面
│   │   ├── events.tsx              # 随机事件
│   │   ├── superior.tsx            # 上级关系
│   │   ├── relations.tsx           # 人脉网络
│   │   ├── factions.tsx            # 派系政治
│   │   ├── personal-life.tsx       # 个人生活（6子Tab）
│   │   ├── calendar.tsx            # 游戏日历
│   │   ├── archives.tsx            # 档案与成就
│   │   ├── patrol.tsx              # 专项调查/巡视
│   │   ├── corruption.tsx          # 以权谋私
│   │   ├── investigation.tsx       # 双规审查
│   │   ├── proposal.tsx            # 重大议案
│   │   ├── history-eval.tsx        # 历史评价
│   │   ├── successor.tsx           # 接班人
│   │   ├── retirement.tsx          # 卸任时机
│   │   ├── think-tank.tsx          # 智库顾问团
│   │   ├── mentor.tsx              # 导师计划
│   │   ├── opportunity.tsx         # 历史机遇
│   │   └── constitution.tsx        # 修宪提案
│   └── ending/
│       └── game-ending.tsx
│
├── components/                # 共享 UI 组件
│   ├── modal.tsx
│   ├── toast.tsx
│   ├── progress-bar.tsx
│   ├── stat-card.tsx
│   ├── tab-bar.tsx
│   ├── action-button.tsx
│   ├── cooldown-timer.tsx
│   └── budget-gauge.tsx
│
├── types/                     # TypeScript 类型定义
│   ├── config.ts              # 配置数据类型
│   ├── player.ts              # 玩家存档类型
│   ├── game.ts                # 游戏运行时类型
│   └── enums.ts               # 枚举
│
└── utils/                     # 工具函数
    ├── math.ts                # clamp, weightedRandom 等
    ├── format.ts              # 数值格式化
    └── debounce.ts            # 防抖
```

---

## 4. 数据模型

### 4.1 枚举定义

```typescript
// types/enums.ts

export enum CareerLine {
  Administrative = 'admin', // 行政线
  Party = 'party', // 党务线
  Discipline = 'discipline', // 纪检线
  Mass = 'mass', // 群团线
}

export enum LevelLabel {
  L1 = '科员',
  L2 = '副科',
  L3 = '正科',
  L4 = '副处',
  L5 = '正处',
  L6 = '正处上',
  L7 = '副厅',
  L8 = '正厅',
  L9 = '正厅上',
  L10 = '副部',
  L11 = '正部',
}

export enum KPITier {
  Excellent = '优秀', // >= 90
  Competent = '称职', // >= 75
  Basic = '基本称职', // >= 60
  Incompetent = '不称职', // < 60
}

export enum PromotionStage {
  Idle = 'idle',
  DemocraticVote = 'democratic_vote',
  OrgInspection = 'org_inspection',
  JointReview = 'joint_review',
  CommitteeVote = 'committee_vote',
  PublicNotice = 'public_notice',
  Appointment = 'appointment',
  Probation = 'probation',
  Completed = 'completed',
  Failed = 'failed',
}

export enum OrgInspectResult {
  Excellent = '优秀',
  Qualified = '合格',
  Suspended = '暂缓使用',
  Rejected = '不宜提拔',
}

export enum FileType {
  Request = '请示',
  Report = '报告',
  Proposal = '方案',
  Suggestion = '建议',
}

export enum FileCategory {
  Economy = '经济类',
  Livelihood = '民生类',
  Ecology = '生态类',
  PartyBuilding = '党建类',
  Safety = '安全类',
}

export enum FileAction {
  Approve = '批准',
  Revise = '修改',
  Reject = '驳回',
  Shelve = '搁置',
}

export enum SentimentType {
  Negative = '负面',
  Neutral = '中性',
  Positive = '正面',
}

export enum Faction {
  Reform = '改革派',
  Pragmatic = '务实派',
  Conservative = '保守派',
}

export enum SecretaryLevel {
  Junior = '初级', // 0-99
  Assistant = '助理', // 100-299
  Director = '主任', // 300-599
  Senior = '资深', // 600-999
  Chief = '首席', // 1000+
}

export enum ReserveCadreTier {
  None = 0,
  First = 1, // 近期提拔
  Second = 2, // 中期储备
  Third = 3, // 长期储备
}

export enum InvestigationEvidence {
  Bribery = '受贿证据',
  AssetAnomaly = '财产申报异常',
  ApprovalViolation = '违规审批记录',
  CommunicationLog = '通讯记录',
  WitnessTestimony = '证人证词',
  LifestyleClue = '生活作风问题线索',
}
```

### 4.2 配置数据类型

```typescript
// types/config.ts

import { CareerLine, FileType, FileCategory } from './enums';

// ============ KPI 指标 ============

export interface KPIIndicatorConfig {
  id: string; // 如 'gdp_growth'
  name: string; // 如 '城市GDP增长率'
  targetValue: number; // 目标值（百分比或绝对值）
  weight: number; // 权重（0~1，同职位下所有权重之和=1）
  unit: '%' | '万元' | '分' | '次' | '个';
  calcType: 'ratio' | 'absolute' | 'inverse';
  // ratio: 完成率 = current / target
  // absolute: 直接取值
  // inverse: 反向指标（如事故率），完成率 = (target - current) / target
}

// ============ 部门行动 ============

export interface DeptActionConfig {
  id: string; // 如 'approve_major_project'
  name: string; // 如 '审批重大工程项目'
  description: string; // 效果描述
  apCost: number; // AP 消耗
  cooldownDays: number; // 冷却天数
  budgetDelta: number; // 额外资金消耗（万元）
  effects: ActionEffect[]; // 对 KPI/属性的影响
  unlockRank?: number; // 解锁条件（可选）
}

export interface ActionEffect {
  target: string; // 目标标识：'dept.kpi.{kpiId}' 或 'player.{attr}'
  operation: 'add' | 'multiply' | 'set';
  value: number;
  // 支持范围值：{ min, max } 随机
  range?: { min: number; max: number };
}

// ============ 部门配置 ============

export interface DepartmentConfig {
  id: string; // 如 'admin_l3_0_dept_urban'
  name: string; // 如 '城建部门'
  consumptionCoefficient: number; // 资金消耗系数
  baseConsumption: number; // 基础月消耗（万元）
  actions: DeptActionConfig[]; // 2~4 个专属行动
  kpiIndicators: KPIIndicatorConfig[]; // 部门级 KPI（1~3 项）
}

// ============ 职位配置 ============

export interface PositionConfig {
  id: string; // 如 'admin_l3_0' (行政线-级别3-职位0)
  name: string; // 如 '镇长'
  level: number; // 1~11
  careerLine: CareerLine;
  departments: DepartmentConfig[]; // 4~5 个部门
  kpiIndicators: KPIIndicatorConfig[]; // 职位级 KPI（4~5 项）
  annualBudget: number; // 年度拨款（万元）
  prerequisites?: {
    // 任职前置条件（用于晋升选择）
    minYearsInLevel?: number;
    requiresGrassroots?: boolean;
    requiresMultiRegion?: boolean;
  };
}

// ============ 级别配置 ============

export interface LevelConfig {
  level: number; // 1~11
  label: string; // '科员' / '副科' / ...
  positions: PositionConfig[]; // 3~4 个职位
  promotionRequirements: PromotionRequirement; // 晋升到下一级的条件
}

export interface PromotionRequirement {
  minYearsInService: number; // 最低任职年限
  minAssessmentPasses: number; // 至少N次称职以上
  politicalConditions: string[]; // 政治条件描述
  specialConditions?: string[]; // 特殊条件（如基层主官经历）
  canBreakRules?: boolean; // 是否允许破格（副厅以上false）
}

// ============ 职业线配置 ============

export interface CareerLineConfig {
  id: CareerLine;
  name: string;
  color: string; // 主题色
  description: string;
  levels: LevelConfig[]; // 11 个级别
  privileges: string[]; // 路线特权说明
}
```

### 4.3 玩家存档类型

```typescript
// types/player.ts

import { CareerLine, PromotionStage, ReserveCadreTier, Faction, SecretaryLevel } from './enums';

// ============ 部门运行时状态 ============

export interface DepartmentState {
  id: string; // 对应 DepartmentConfig.id
  kpiValues: Record<string, number>; // KPI id → 当前值
  monthlyConsumption: number; // 当月消耗
  cumulativeConsumption: number; // 累计消耗
  activityLevel: number; // 活跃度 0.5~2.0
  actionCooldowns: Record<string, number>; // actionId → 冷却到期日（游戏内时间戳）
}

// ============ 秘书状态 ============

export interface SecretaryState {
  id: string;
  name: string;
  experience: number;
  level: SecretaryLevel;
}

// ============ 职业履历 ============

export interface CareerRecord {
  positionId: string;
  positionName: string;
  level: number;
  careerLine: CareerLine;
  startYear: number;
  endYear: number | null; // null = 当前职位
  assessmentResults: string[]; // 年度考核结果
  archived: boolean; // 跨线转职后封存
}

// ============ 人脉关系 ============

export interface RelationState {
  classmates: Record<string, number>; // NPC id → 关系值
  colleagues: Record<string, number>;
  business: Record<string, number>;
  academic: Record<string, number>;
  media: Record<string, number>;
  central: Record<string, number>; // 中央/省级
}

// ============ 派系状态 ============

export interface FactionState {
  alignment: Faction | 'independent';
  reputation: Record<Faction, number>; // 各派系声望
}

// ============ 接班人状态 ============

export interface SuccessorState {
  id: string | null;
  name: string;
  investment: number; // 关注值投入
  readiness: number; // 接位准备度
}

// ============ 玩家存档 ============

export interface PlayerSave {
  // ---- 基础信息 ----
  saveId: string;
  userId: string;
  characterName: string;
  gender: '男' | '女';
  birthPlace: string;
  birthYear: number; // 游戏内出生年
  education: '高中' | '大专' | '本科' | '硕士' | '博士';
  motivation: '为民服务' | '个人抱负' | '家族期望';
  personality: '廉洁型' | '务实型' | '改革型' | '稳健型';
  familyBackground: '普通家庭' | '干部家庭' | '商人家庭';

  // ---- 当前职位 ----
  currentPositionId: string;
  currentLevel: number;
  currentCareerLine: CareerLine;
  yearsInCurrentPosition: number;

  // ---- 资源 ----
  ap: number; // 当前行动体力
  maxAp: number; // AP 上限
  politicalCapital: number; // 政治资本
  remainingBudget: number; // 剩余预算（万元）

  // ---- 考核 ----
  comprehensiveScore: number; // 综合考核得分
  annualAssessments: { year: number; score: number; tier: string }[];

  // ---- 核心属性 ----
  integrity: number; // 廉洁
  stability: number; // 稳定性
  performance: number; // 政绩
  charisma: number; // 魅力
  competence: number; // 能力

  // ---- 晋升 ----
  promotionStage: PromotionStage;
  promotionAttempts: number;
  frozenPeriods: number; // 晋升冻结届数

  // ---- 转职 ----
  transferCount: number; // 剩余转职次数（初始5）
  isLineLocked: boolean; // 副厅级后锁定

  // ---- 部门状态 ----
  departmentStates: Record<string, DepartmentState>;

  // ---- 职业履历 ----
  careerHistory: CareerRecord[];

  // ---- 秘书 ----
  secretary: SecretaryState | null;

  // ---- 人脉 ----
  relations: RelationState;

  // ---- 派系 ----
  factions: FactionState;

  // ---- 上级关系 ----
  superiorFavor: number; // 直属上司好感值

  // ---- 后备干部池 ----
  reserveTier: ReserveCadreTier;
  demoralization: number; // 消沉值

  // ---- 风险 ----
  corruptionRisk: number; // 贪腐风险值
  isUnderInvestigation: boolean;

  // ---- 游戏时间 ----
  gameYear: number;
  gameMonth: number; // 1~12
  gameDay: number; // 1~30

  // ---- 高级系统 ----
  successor: SuccessorState | null;
  thinkTank: { science: string | null; economics: string | null; law: string | null };
  mentees: { id: string; progress: number }[];

  // ---- 成就 ----
  achievements: string[];

  // ---- 统计 ----
  totalActions: number;
  totalDaysPlayed: number;
}
```

### 4.4 随机事件与文件批示类型

```typescript
// types/game.ts

import { FileType, FileCategory, SentimentType } from './enums';

// ============ 随机事件 ============

export interface GameEvent {
  id: string;
  title: string;
  description: string;
  triggerCondition: EventCondition;
  options: EventOption[]; // 3 个选项
}

export interface EventCondition {
  minLevel?: number;
  maxLevel?: number;
  careerLines?: string[];
  minScore?: number;
  requiredFlag?: string;
}

export interface EventOption {
  label: string;
  description: string;
  effects: { target: string; value: number }[];
  risk?: { type: string; probability: number };
}

// ============ 文件批示 ============

export interface PendingDocument {
  id: string;
  type: FileType;
  category: FileCategory;
  title: string;
  summary: string;
  effects: {
    approve: { performance: number; [key: string]: number };
    revise: { performance: number; integrity: number };
    reject: { performance: number };
    shelve: Record<string, number>;
  };
  abilityRequired?: number; // 批准所需能力
}

// ============ 舆情 ============

export interface Sentiment {
  id: string;
  type: SentimentType;
  description: string;
  heatIndex: number; // 热度 0~100
  remainingDays: number; // 剩余时效
  resolved: boolean;
}

// ============ 晋升流程结果 ============

export interface PromotionResult {
  stage: string;
  passed: boolean;
  details: string;
  // 民主推荐：得票数
  voteCount?: number;
  // 组织考察：结论
  inspectionResult?: string;
  // 联审：各部门意见
  reviewOpinions?: Record<string, 'pass' | 'fail'>;
  // 常委票决：赞成/反对票
  committeeVotes?: { for: number; against: number };
  // 公示：举报情况
  complaints?: boolean;
}
```

---

## 5. 数据库设计（Supabase）

### 5.1 表结构

#### users — 扩展用户表

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  phone TEXT UNIQUE NOT NULL,
  display_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- 角色创建状态
  character_created BOOLEAN DEFAULT FALSE,
  character_data JSONB DEFAULT '{}'::jsonb
  -- 包含: name, gender, birthPlace, education,
  --       motivation, personality, familyBackground
);
```

#### game_saves — 游戏存档

```sql
CREATE TABLE game_saves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  slot_name TEXT NOT NULL DEFAULT 'main',

  -- ---- 核心状态（结构化列，用于查询过滤） ----
  current_level INTEGER NOT NULL DEFAULT 1,
  current_career_line TEXT NOT NULL DEFAULT 'admin',
  current_position_id TEXT NOT NULL,
  game_year INTEGER NOT NULL,
  game_month INTEGER NOT NULL DEFAULT 1,

  -- ---- 完整存档（JSONB 大对象） ----
  save_data JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id, slot_name)
);

-- 存档索引
CREATE INDEX idx_saves_user ON game_saves(user_id);
CREATE INDEX idx_saves_level ON game_saves(current_level);
```

**设计说明：** save_data 存储完整的 PlayerSave 对象。核心字段（level, career_line, year）冗余为列，方便后续做排行榜或管理后台查询。读取时直接取 save_data 反序列化为 PlayerSave，写入时全量覆盖 save_data 并同步更新结构化列。

#### game_events — 随机事件日志

```sql
CREATE TABLE game_events (
  id BIGSERIAL PRIMARY KEY,
  save_id UUID NOT NULL REFERENCES game_saves(id),
  event_id TEXT NOT NULL,
  chosen_option INTEGER NOT NULL,
  game_year INTEGER NOT NULL,
  game_month INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_events_save ON game_events(save_id);
```

#### leaderboard — 排行榜（可选）

```sql
CREATE TABLE leaderboard (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  display_name TEXT,
  max_level INTEGER,
  career_line TEXT,
  final_score INTEGER,
  game_ended BOOLEAN DEFAULT FALSE,
  ended_at TIMESTAMPTZ
);
```

### 5.2 RLS（行级安全）策略

```sql
-- users 表：用户只能访问自己的数据
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own data"
  ON users FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own data"
  ON users FOR UPDATE
  USING (auth.uid() = id);

-- game_saves 表：用户只能访问自己的存档
ALTER TABLE game_saves ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD own saves"
  ON game_saves FOR ALL
  USING (auth.uid() = user_id);

-- game_events 表：通过 save_id 关联
ALTER TABLE game_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own events"
  ON game_events FOR SELECT
  USING (save_id IN (
    SELECT id FROM game_saves WHERE user_id = auth.uid()
  ));
```

### 5.3 存档读写流程

```
[读取存档]
1. Supabase query: SELECT save_data FROM game_saves WHERE user_id = ? AND slot_name = 'main'
2. JSON.parse → PlayerSave
3. 注入 Store 层 Signals

[保存存档]
1. 从 Store 层收集所有 Signals 当前值 → 组装 PlayerSave
2. 防抖 500ms（避免频繁写入）
3. Supabase upsert: INSERT ... ON CONFLICT (user_id, slot_name) DO UPDATE
4. 同步更新结构化列 (current_level, current_career_line, game_year, game_month)

[自动保存时机]
- 每次行动执行完毕后
- 页面切换前（beforeunload）
- 每 60 秒定时保存（如果状态有变化）
```

---

## 6. 状态管理

### 6.1 Store 架构（Preact Signals）

采用分域 Store 模式，每个子系统一个 Signal store，通过聚合 store 统一暴露。

```typescript
// store/player-store.ts

import { signal, computed } from '@preact/signals';
import type { PlayerSave } from '../types/player';

// 核心属性 signals
const characterName = signal('');
const education = signal('');
const level = signal(1);
const careerLine = signal<CareerLine>('admin');
const positionId = signal('');
const ap = signal(20);
const maxAp = signal(20);
const politicalCapital = signal(0);
const integrity = signal(50);
const stability = signal(50);
const performance = signal(0);
const charisma = signal(50);
const competence = signal(50);
// ... 更多属性

// 派生状态
const canAct = computed(() => ap.value > 0);
const age = computed(() => gameYear.value - birthYear.value);
const yearsUntilRetirement = computed(() => 65 - age.value);

export function usePlayerStore() {
  return {
    // 读写
    characterName,
    level,
    careerLine,
    positionId,
    ap,
    maxAp,
    politicalCapital,
    integrity,
    stability,
    performance,
    charisma,
    competence,
    // 只读
    canAct,
    age,
    yearsUntilRetirement,
  };
}
```

```typescript
// store/dept-store.ts

import { signal, computed } from '@preact/signals';
import type { DepartmentState } from '../types/player';

// 部门状态 map
const departments = signal<Record<string, DepartmentState>>({});

// 单个部门读取
function getDept(id: string) {
  return computed(() => departments.value[id]);
}

// 预算汇总
const totalMonthlyConsumption = computed(() =>
  Object.values(departments.value).reduce((sum, d) => sum + d.monthlyConsumption, 0),
);

export function useDeptStore() {
  return { departments, getDept, totalMonthlyConsumption };
}
```

```typescript
// store/game-store.ts — 聚合入口

import { usePlayerStore } from './player-store';
import { useDeptStore } from './dept-store';
import { useCareerStore } from './career-store';
import { useTimeStore } from './time-store';
import { useSecretaryStore } from './secretary-store';
import { useUIStore } from './ui-store';

export function useGameStore() {
  return {
    player: usePlayerStore(),
    dept: useDeptStore(),
    career: useCareerStore(),
    time: useTimeStore(),
    secretary: useSecretaryStore(),
    ui: useUIStore(),
  };
}
```

### 6.2 Action Dispatch 模式

所有状态变更通过统一的 dispatch 函数执行，便于日志、防抖和回放。

```typescript
// store/game-store.ts

type GameAction =
  | { type: 'EXECUTE_ACTION'; payload: { deptId: string; actionId: string } }
  | { type: 'ADVANCE_TIME'; payload: { days: number } }
  | { type: 'MONTHLY_SETTLEMENT' }
  | { type: 'ANNUAL_ASSESSMENT' }
  | { type: 'START_PROMOTION'; payload: { targetPositionId: string } }
  | { type: 'PROMOTION_STAGE_RESOLVE'; payload: { result: PromotionResult } }
  | { type: 'CAREER_TRANSFER'; payload: { targetLine: CareerLine } }
  | { type: 'PROCESS_DOCUMENT'; payload: { docId: string; action: FileAction } }
  | { type: 'HANDLE_SENTIMENT'; payload: { sentimentId: string; method: string } }
  | { type: 'LOAD_SAVE'; payload: PlayerSave }
  | { type: 'NEW_GAME'; payload: CharacterCreationData };

function dispatch(action: GameAction) {
  // 1. 日志
  console.log('[dispatch]', action.type, action.payload);

  // 2. 执行引擎逻辑
  const result = engineReducer(action);

  // 3. 更新 Signals
  applyResult(result);

  // 4. 触发自动保存（防抖 500ms）
  scheduleSave();
}
```

### 6.3 存档加载 → Signals 注入

```typescript
function loadSaveIntoSignals(save: PlayerSave) {
  // 基础属性
  characterName.value = save.characterName;
  level.value = save.currentLevel;
  careerLine.value = save.currentCareerLine;
  positionId.value = save.currentPositionId;
  ap.value = save.ap;
  maxAp.value = save.maxAp;
  // ... 所有属性

  // 部门状态
  departments.value = save.departmentStates;

  // 时间
  gameYear.value = save.gameYear;
  gameMonth.value = save.gameMonth;
  gameDay.value = save.gameDay;

  // 秘书
  secretaryExp.value = save.secretary?.experience ?? 0;
  // ...
}
```

---

## 7. 游戏引擎

游戏引擎是纯 TypeScript 模块，不引用任何 UI 或 DOM API。每个引擎模块导出纯函数，接收状态、返回新状态。

### 7.1 时间引擎（time-engine.ts）

时间引擎是游戏的核心节拍器。每次玩家执行行动，消耗 AP 的同时推进游戏天数。

```
时间推进规则：
- 每次行动消耗 1~3 天（取决于行动的 timeCost）
- 每月 30 天（简化处理，不模拟真实日历）
- 每年 12 个月 = 360 天

周期事件触发：
- 月初（day=1）：月度预算结算 + 部门消耗扣除 + 舆情生成（rank4+）
- 年末（month=12, day=30）：年度考核 + 晋升窗口检测
- 每 5 年：换届事件（两会、议案系统）
- 65 岁：强制退休
```

```typescript
// engine/time-engine.ts

interface TimeAdvanceResult {
  newYear: number;
  newMonth: number;
  newDay: number;
  triggers: TimeTrigger[]; // 需要执行的周期事件
}

type TimeTrigger =
  | { type: 'monthly_settlement' }
  | { type: 'annual_assessment'; year: number }
  | { type: 'congress_cycle'; year: number }
  | { type: 'retirement_check' }
  | { type: 'random_event'; eventId: string }
  | { type: 'sentiment_generate'; count: number };

export function advanceTime(
  current: { year: number; month: number; day: number },
  days: number,
  playerLevel: number,
  playerAge: number,
): TimeAdvanceResult {
  const triggers: TimeTrigger[] = [];
  let { year, month, day } = current;

  for (let i = 0; i < days; i++) {
    day++;
    if (day > 30) {
      day = 1;
      month++;
      triggers.push({ type: 'monthly_settlement' });

      // 舆情生成（rank4+）
      if (playerLevel >= 4) {
        const count = weightedRandom(1, 3);
        triggers.push({ type: 'sentiment_generate', count });
      }

      if (month > 12) {
        month = 1;
        year++;
        triggers.push({ type: 'annual_assessment', year });

        // 换届检测（每 5 年）
        if (year % 5 === 0) {
          triggers.push({ type: 'congress_cycle', year });
        }

        // 退休检测
        if (playerAge + (year - current.year) >= 65) {
          triggers.push({ type: 'retirement_check' });
        }
      }
    }

    // 随机事件概率（每天 5%）
    if (Math.random() < 0.05) {
      const eventId = pickRandomEvent(playerLevel);
      if (eventId) triggers.push({ type: 'random_event', eventId });
    }
  }

  return { newYear: year, newMonth: month, newDay: day, triggers };
}
```

### 7.2 KPI 引擎（kpi-engine.ts）

```typescript
// engine/kpi-engine.ts

export interface KPIResult {
  indicatorId: string;
  name: string;
  currentValue: number;
  targetValue: number;
  completionRate: number; // 0~1.5（允许超额完成）
  weight: number;
  weightedScore: number;
}

export interface AssessmentResult {
  totalScore: number;
  tier: KPITier;
  indicators: KPIResult[];
}

export function calculateKPI(
  indicators: KPIIndicatorConfig[],
  deptStates: Record<string, DepartmentState>,
): AssessmentResult {
  const results: KPIResult[] = indicators.map((ind) => {
    // 从部门状态中聚合当前值
    const currentValue = aggregateCurrentValue(ind.id, deptStates);
    let completionRate: number;

    switch (ind.calcType) {
      case 'ratio':
        completionRate = Math.min(currentValue / ind.targetValue, 1.5);
        break;
      case 'inverse':
        completionRate = Math.max((ind.targetValue - currentValue) / ind.targetValue, 0);
        break;
      case 'absolute':
      default:
        completionRate = currentValue >= ind.targetValue ? 1.0 : currentValue / ind.targetValue;
    }

    return {
      indicatorId: ind.id,
      name: ind.name,
      currentValue,
      targetValue: ind.targetValue,
      completionRate,
      weight: ind.weight,
      weightedScore: completionRate * ind.weight * 100,
    };
  });

  const totalScore = results.reduce((sum, r) => sum + r.weightedScore, 0);
  const tier = scoreToKPITier(totalScore);

  return { totalScore, tier, indicators: results };
}

function scoreToKPITier(score: number): KPITier {
  if (score >= 90) return KPITier.Excellent;
  if (score >= 75) return KPITier.Competent;
  if (score >= 60) return KPITier.Basic;
  return KPITier.Incompetent;
}
```

### 7.3 预算引擎（budget-engine.ts）

```typescript
// engine/budget-engine.ts

export function calculateMonthlyConsumption(
  dept: DepartmentState,
  config: DepartmentConfig,
): number {
  // 月度消耗 = 基础消耗 × 消耗系数 × 活跃度
  return config.baseConsumption * config.consumptionCoefficient * dept.activityLevel;
}

export function monthlySettlement(
  departments: Record<string, DepartmentState>,
  configs: DepartmentConfig[],
  remainingBudget: number,
): {
  newRemaining: number;
  deptConsumptions: Record<string, number>;
  isOverBudget: boolean;
} {
  const deptConsumptions: Record<string, number> = {};
  let totalConsumption = 0;

  for (const config of configs) {
    const state = departments[config.id];
    if (!state) continue;
    const consumption = calculateMonthlyConsumption(state, config);
    deptConsumptions[config.id] = consumption;
    totalConsumption += consumption;
  }

  const newRemaining = remainingBudget - totalConsumption;
  return {
    newRemaining,
    deptConsumptions,
    isOverBudget: newRemaining < 0,
  };
}

// 活跃度衰减（每月未行动的部门活跃度下降）
export function decayActivity(
  departments: Record<string, DepartmentState>,
  actedDeptIds: Set<string>,
): Record<string, DepartmentState> {
  const updated = { ...departments };
  for (const [id, state] of Object.entries(updated)) {
    if (actedDeptIds.has(id)) {
      // 行动过的部门活跃度微涨
      updated[id] = {
        ...state,
        activityLevel: clamp(state.activityLevel + 0.1, 0.5, 2.0),
      };
    } else {
      // 未行动部门活跃度衰减
      updated[id] = {
        ...state,
        activityLevel: clamp(state.activityLevel - 0.05, 0.5, 2.0),
      };
    }
  }
  return updated;
}
```

### 7.4 行动引擎（action-engine.ts）

```typescript
// engine/action-engine.ts

export interface ActionResult {
  success: boolean;
  error?: string;
  apConsumed: number;
  budgetDelta: number;
  kpiChanges: { indicatorId: string; delta: number }[];
  playerChanges: { attr: string; delta: number }[];
  newCooldown: { actionId: string; expiresAt: number };
  daysAdvanced: number;
}

export function executeAction(
  actionConfig: DeptActionConfig,
  deptState: DepartmentState,
  playerAp: number,
  remainingBudget: number,
  gameDay: number,
): ActionResult {
  // 1. 前置校验
  if (playerAp < actionConfig.apCost) {
    return {
      success: false,
      error: '行动体力不足',
      apConsumed: 0,
      budgetDelta: 0,
      kpiChanges: [],
      playerChanges: [],
      newCooldown: { actionId: '', expiresAt: 0 },
      daysAdvanced: 0,
    };
  }

  const cooldownEnd = deptState.actionCooldowns[actionConfig.id] ?? 0;
  if (gameDay < cooldownEnd) {
    const remaining = cooldownEnd - gameDay;
    return {
      success: false,
      error: `冷却中，剩余${remaining}天`,
      apConsumed: 0,
      budgetDelta: 0,
      kpiChanges: [],
      playerChanges: [],
      newCooldown: { actionId: '', expiresAt: 0 },
      daysAdvanced: 0,
    };
  }

  if (remainingBudget < actionConfig.budgetDelta) {
    return {
      success: false,
      error: '预算不足',
      apConsumed: 0,
      budgetDelta: 0,
      kpiChanges: [],
      playerChanges: [],
      newCooldown: { actionId: '', expiresAt: 0 },
      daysAdvanced: 0,
    };
  }

  // 2. 计算效果
  const kpiChanges: { indicatorId: string; delta: number }[] = [];
  const playerChanges: { attr: string; delta: number }[] = [];

  for (const effect of actionConfig.effects) {
    const value = effect.range ? weightedRandom(effect.range.min, effect.range.max) : effect.value;

    if (effect.target.startsWith('dept.kpi.')) {
      const kpiId = effect.target.replace('dept.kpi.', '');
      kpiChanges.push({ indicatorId: kpiId, delta: value });
    } else if (effect.target.startsWith('player.')) {
      const attr = effect.target.replace('player.', '');
      playerChanges.push({ attr, delta: value });
    }
  }

  // 3. 返回结果（由 store 层应用到 signals）
  return {
    success: true,
    apConsumed: actionConfig.apCost,
    budgetDelta: actionConfig.budgetDelta,
    kpiChanges,
    playerChanges,
    newCooldown: {
      actionId: actionConfig.id,
      expiresAt: gameDay + actionConfig.cooldownDays,
    },
    daysAdvanced: Math.ceil(actionConfig.apCost / 2), // 每 2 AP = 1 天
  };
}
```

### 7.5 晋升引擎（promotion-engine.ts）— 六阶段状态机

这是整个游戏最复杂的流程引擎，采用有限状态机实现。

```typescript
// engine/promotion-engine.ts

interface PromotionContext {
  playerLevel: number;
  playerScore: number;
  yearsInPosition: number;
  politicalCapital: number;
  corruptionRisk: number;
  factionReputation: Record<Faction, number>;
  relations: RelationState;
  assessmentHistory: { score: number; tier: string }[];
  hasDisciplinaryRecord: boolean;
  hasGrassrootsExperience: boolean;
  hasMultiRegionExperience: boolean;
}

interface PromotionStageInput {
  // 由 store 层在阶段间传递
  democraticVotes?: number;
  inspectionResult?: OrgInspectResult;
  reviewPassed?: boolean;
  committeeFor?: number;
  committeeAgainst?: number;
  hasComplaint?: boolean;
  sentimentEscalated?: boolean;
}

// ===== 阶段 0：门槛校验 =====

export function checkPrerequisites(
  ctx: PromotionContext,
  req: PromotionRequirement,
): { eligible: boolean; missing: string[] } {
  const missing: string[] = [];

  if (ctx.yearsInPosition < req.minYearsInService) {
    missing.push(`任职年限不足（需${req.minYearsInService}年，当前${ctx.yearsInPosition}年）`);
  }

  const passCount = ctx.assessmentHistory.filter((a) => a.tier !== KPITier.Incompetent).length;
  if (passCount < req.minAssessmentPasses) {
    missing.push(`考核称职次数不足（需${req.minAssessmentPasses}次，当前${passCount}次）`);
  }

  if (ctx.hasDisciplinaryRecord) {
    missing.push('存在党纪处分记录');
  }

  if (req.specialConditions?.includes('grassroots') && !ctx.hasGrassrootsExperience) {
    missing.push('缺少基层主官任职经历');
  }

  if (req.specialConditions?.includes('multi_region') && !ctx.hasMultiRegionExperience) {
    missing.push('缺少跨地区历练履历');
  }

  return { eligible: missing.length === 0, missing };
}

// ===== 阶段 1：民主推荐 =====

export function resolveDemocraticVote(
  ctx: PromotionContext,
  playerChoices: { useConnections: boolean },
): { passed: boolean; votes: number; detail: string } {
  // 基础得票 = 综合考核得分 × 0.4 + 魅力 × 0.3 + 上司好感 × 0.3
  let baseScore = ctx.playerScore * 0.4 + ctx.charisma * 0.3 + ctx.superiorFavor * 0.3;

  // 动用人脉拉票
  if (playerChoices.useConnections) {
    baseScore += 10;
    // 副作用：负面台账（概率 30%）
    if (Math.random() < 0.3) {
      // 标记：过度操作留下负面记录
    }
  }

  // 派系博弈：对立派系会投反对票
  const factionPenalty = calculateFactionPenalty(ctx.factions);
  baseScore -= factionPenalty;

  const passed = baseScore >= 60; // 得票前 2 名的阈值
  return {
    passed,
    votes: Math.round(baseScore),
    detail: passed
      ? `民主推荐通过，得票${Math.round(baseScore)}分，进入组织考察名单`
      : `民主推荐未通过，得票${Math.round(baseScore)}分，未进入前2名`,
  };
}

// ===== 阶段 2：组织考察 =====

export function resolveOrgInspection(
  ctx: PromotionContext,
  playerChoices: { influenceInspectors: boolean },
): { result: OrgInspectResult; detail: string } {
  // 考察得分 = 政绩 × 0.3 + 能力 × 0.3 + 考核历史 × 0.2 + 廉洁 × 0.2
  let score =
    ctx.performance * 0.3 + ctx.competence * 0.3 + ctx.playerScore * 0.2 + ctx.integrity * 0.2;

  if (playerChoices.influenceInspectors && ctx.politicalCapital >= 20) {
    score += 8;
  }

  let result: OrgInspectResult;
  if (score >= 80) result = OrgInspectResult.Excellent;
  else if (score >= 60) result = OrgInspectResult.Qualified;
  else if (score >= 40) result = OrgInspectResult.Suspended;
  else result = OrgInspectResult.Rejected;

  return {
    result,
    detail:
      `组织考察结论：${result}` +
      (result === OrgInspectResult.Suspended
        ? '，本次提拔搁置'
        : result === OrgInspectResult.Rejected
          ? '，晋升资格冻结两届'
          : ''),
  };
}

// ===== 阶段 3：联审 =====

export function resolveJointReview(ctx: PromotionContext): {
  passed: boolean;
  opinions: Record<string, boolean>;
  detail: string;
} {
  const departments = ['纪委', '公安', '信访', '审计', '网信'];
  const opinions: Record<string, boolean> = {};

  for (const dept of departments) {
    if (dept === '纪委') {
      // 纪委：廉政审查，corruptionRisk 越高越危险
      opinions[dept] = ctx.corruptionRisk < 50;
    } else if (dept === '信访') {
      // 信访：随机但受声望影响
      opinions[dept] = Math.random() < 1 - ctx.corruptionRisk / 200;
    } else {
      // 其他部门：大概率通过
      opinions[dept] = Math.random() < 0.85;
    }
  }

  const passed = Object.values(opinions).every((v) => v);
  const failedDepts = Object.entries(opinions)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  return {
    passed,
    opinions,
    detail: passed ? '多部门联审全部通过' : `${failedDepts.join('、')}出具负面意见，提拔程序终止`,
  };
}

// ===== 阶段 4：常委票决 =====

export function resolveCommitteeVote(ctx: PromotionContext): {
  passed: boolean;
  forVotes: number;
  againstVotes: number;
  detail: string;
} {
  // 常委人数：奇数（7~13 人，按级别递增）
  const committeeSize = Math.min(7 + Math.floor(ctx.playerLevel / 3) * 2, 13);

  // 基础赞成率 = (声望平均 + 上司好感) / 200
  const avgReputation = Object.values(ctx.factionReputation).reduce((a, b) => a + b, 0) / 3;
  const approvalRate = (avgReputation + ctx.superiorFavor) / 200;

  // 派系对抗会降低赞成率
  const factionPenalty = calculateFactionPenalty(ctx.factions) / 100;
  const finalRate = Math.max(approvalRate - factionPenalty, 0.1);

  let forVotes = 0;
  for (let i = 0; i < committeeSize; i++) {
    if (Math.random() < finalRate) forVotes++;
  }

  const againstVotes = committeeSize - forVotes;
  const passed = forVotes > committeeSize / 2;

  return {
    passed,
    forVotes,
    againstVotes,
    detail: passed
      ? `常委会票决通过（${forVotes}:${againstVotes}）`
      : `常委会票决未通过（${forVotes}:${againstVotes}），本次晋升失败`,
  };
}

// ===== 阶段 5：公示 =====

export function resolvePublicNotice(ctx: PromotionContext): {
  passed: boolean;
  hasComplaint: boolean;
  sentimentEscalated: boolean;
  detail: string;
} {
  // 实名举报概率 = corruptionRisk × 0.5%
  const complaintProb = ctx.corruptionRisk * 0.005;
  const hasComplaint = Math.random() < complaintProb;

  // 网络舆情发酵概率 = corruptionRisk × 0.3%
  const sentimentProb = ctx.corruptionRisk * 0.003;
  const sentimentEscalated = Math.random() < sentimentProb;

  if (sentimentEscalated) {
    return {
      passed: false,
      hasComplaint,
      sentimentEscalated,
      detail: '网络舆情大面积发酵，撤销拟任决定',
    };
  }
  if (hasComplaint) {
    return {
      passed: false,
      hasComplaint,
      sentimentEscalated,
      detail: '公示期间收到实名举报，暂停任命并重新核查',
    };
  }
  return {
    passed: true,
    hasComplaint: false,
    sentimentEscalated: false,
    detail: '公示5个工作日无异议，进入正式任命',
  };
}

// ===== 阶段 6：任命 + 试用期 =====

export function resolveProbation(ctx: PromotionContext): { passed: boolean; detail: string } {
  // 试用期考核 = 能力 × 0.5 + 综合得分 × 0.3 + 随机因素 × 0.2
  const score = ctx.competence * 0.5 + ctx.playerScore * 0.3 + Math.random() * 20;
  const passed = score >= 55;

  return {
    passed,
    detail: passed ? '一年试用期考核合格，正式定岗' : '试用期考核不合格，降回原职级',
  };
}
```

### 7.6 事件引擎（event-engine.ts）

```typescript
// engine/event-engine.ts

export function generateRandomEvents(
  playerLevel: number,
  careerLine: CareerLine,
  eventPool: GameEvent[],
): GameEvent[] {
  return eventPool.filter((e) => {
    const cond = e.triggerCondition;
    if (cond.minLevel && playerLevel < cond.minLevel) return false;
    if (cond.maxLevel && playerLevel > cond.maxLevel) return false;
    if (cond.careerLines && !cond.careerLines.includes(careerLine)) return false;
    return true;
  });
}

export function resolveEventOption(
  event: GameEvent,
  optionIndex: number,
  playerState: Partial<PlayerSave>,
): { effects: Record<string, number>; riskTriggered: boolean; detail: string } {
  const option = event.options[optionIndex];
  const effects: Record<string, number> = {};

  for (const eff of option.effects) {
    effects[eff.target] = eff.value;
  }

  let riskTriggered = false;
  if (option.risk && Math.random() < option.risk.probability) {
    riskTriggered = true;
    // 风险触发：额外负面效果
    effects['corruptionRisk'] = (effects['corruptionRisk'] ?? 0) + 10;
  }

  return {
    effects,
    riskTriggered,
    detail: `选择「${option.label}」` + (riskTriggered ? '（风险触发！）' : ''),
  };
}
```

### 7.7 秘书引擎（secretary-engine.ts）

```typescript
// engine/secretary-engine.ts

const LEVEL_THRESHOLDS = [
  { level: SecretaryLevel.Junior, minExp: 0 },
  { level: SecretaryLevel.Assistant, minExp: 100 },
  { level: SecretaryLevel.Director, minExp: 300 },
  { level: SecretaryLevel.Senior, minExp: 600 },
  { level: SecretaryLevel.Chief, minExp: 1000 },
];

export function addExperience(current: SecretaryState, amount: number): SecretaryState {
  const newExp = current.experience + amount;
  const newLevel =
    LEVEL_THRESHOLDS.filter((t) => newExp >= t.minExp).pop()?.level ?? SecretaryLevel.Junior;

  return { ...current, experience: newExp, level: newLevel };
}

// 文件批示效果计算
export function resolveDocumentAction(
  doc: PendingDocument,
  action: FileAction,
  playerCompetence: number,
): { effects: Record<string, number>; success: boolean; message: string } {
  switch (action) {
    case FileAction.Approve:
      if (doc.abilityRequired && playerCompetence < doc.abilityRequired) {
        return { effects: {}, success: false, message: '能力不足，无法批准该文件' };
      }
      return { effects: doc.effects.approve, success: true, message: '文件已批准' };

    case FileAction.Revise:
      const halved = Object.fromEntries(
        Object.entries(doc.effects.approve).map(([k, v]) => [k, Math.round(v / 2)]),
      );
      return {
        effects: { ...halved, integrity: 1 },
        success: true,
        message: '文件已修改，效果减半，廉洁+1',
      };

    case FileAction.Reject:
      return { effects: doc.effects.reject, success: true, message: '文件已驳回' };

    case FileAction.Shelve:
      return { effects: {}, success: true, message: '文件已搁置' };
  }
}

// 舆情处理效果
export function resolveSentimentAction(
  sentiment: Sentiment,
  method: '删除' | '澄清' | '沉默' | '危机公关' | '公示宣传',
): { heatDelta: number; effects: Record<string, number>; message: string } {
  if (sentiment.type === SentimentType.Positive) {
    return {
      heatDelta: -sentiment.heatIndex,
      effects: { performance: 5, superiorFavor: 3 },
      message: '正面舆情公示宣传',
    };
  }

  switch (method) {
    case '删除':
      return { heatDelta: -60, effects: { integrity: -1 }, message: '删除舆情，热度大降，廉洁-1' };
    case '澄清':
      return { heatDelta: -30, effects: { stability: 1 }, message: '澄清说明，热度缓降，稳定性+1' };
    case '沉默':
      return { heatDelta: +10, effects: {}, message: '保持沉默，热度上升' };
    case '危机公关':
      return {
        heatDelta: -80,
        effects: { performance: -10 },
        message: '危机公关，热度大幅降低，消耗政绩',
      };
    default:
      return { heatDelta: 0, effects: {}, message: '' };
  }
}
```

### 7.8 年度考核引擎（assessment-engine.ts）

```typescript
// engine/assessment-engine.ts

export function annualAssessment(
  kpiResult: AssessmentResult,
  yearsInPosition: number,
): {
  score: number;
  tier: KPITier;
  promotionEligible: boolean;
  frozenPeriods: number;
  consequence: string;
} {
  const { totalScore, tier } = kpiResult;

  let frozenPeriods = 0;
  let consequence = '';

  if (tier === KPITier.Incompetent) {
    frozenPeriods = 1;
    consequence = '年度考核不合格，晋升冻结一届';
  }

  const promotionEligible = tier === KPITier.Excellent || tier === KPITier.Competent;

  return { score: totalScore, tier, promotionEligible, frozenPeriods, consequence };
}
```

### 7.9 职业线引擎（career-engine.ts）

```typescript
// engine/career-engine.ts

// 转职窗口校验
const TRANSFER_NODES = [
  { from: 1, to: 2, label: '科员→副科' },
  { from: 2, to: 3, label: '副科→正科' },
  { from: 3, to: 4, label: '正科→副处' },
  { from: 4, to: 5, label: '副处→正处' },
  { from: 5, to: 7, label: '正处→副厅' },
];

export function canTransfer(
  currentLevel: number,
  nextLevel: number,
  isLineLocked: boolean,
  transferCount: number,
): { allowed: boolean; reason?: string } {
  if (isLineLocked) {
    return { allowed: false, reason: '已晋升副厅级，线路永久锁定' };
  }
  if (transferCount <= 0) {
    return { allowed: false, reason: '转职次数已用完' };
  }
  const node = TRANSFER_NODES.find((n) => n.from === currentLevel && n.to === nextLevel);
  if (!node) {
    return { allowed: false, reason: '当前不在转职窗口期' };
  }
  return { allowed: true };
}

// 转职难度系数（影响审批通过率）
export function transferDifficulty(fromLine: CareerLine, toLine: CareerLine): number {
  // 返回 0~1 的难度系数，1 = 最难
  if (fromLine === CareerLine.Discipline && toLine !== CareerLine.Discipline) return 0.8;
  if (
    fromLine === CareerLine.Mass &&
    (toLine === CareerLine.Administrative || toLine === CareerLine.Party)
  )
    return 0.6;
  if (
    (fromLine === CareerLine.Administrative && toLine === CareerLine.Party) ||
    (fromLine === CareerLine.Party && toLine === CareerLine.Administrative)
  )
    return 0.3;
  return 0.4;
}

// 转职审批
export function resolveTransfer(
  fromLine: CareerLine,
  toLine: CareerLine,
  playerCompetence: number,
  superiorFavor: number,
): { approved: boolean; detail: string } {
  const difficulty = transferDifficulty(fromLine, toLine);
  const approvalChance = ((playerCompetence + superiorFavor) / 200) * (1 - difficulty);
  const approved = Math.random() < approvalChance;

  return {
    approved,
    detail: approved
      ? `干部跨条线交流审批通过，从${fromLine}转入${toLine}`
      : `干部跨条线交流审批未通过`,
  };
}
```

### 7.10 双规审查引擎（investigation-engine.ts）

```typescript
// engine/investigation-engine.ts

import { InvestigationEvidence } from '../types/enums';

interface InvestigationContext {
  corruptionRisk: number; // 0~100
  evidenceCollected: InvestigationEvidence[];
  playerIntegrity: number;
  playerPoliticalCapital: number;
  factionReputation: Record<Faction, number>;
  hasLawyer: boolean;
}

interface EvidenceStrength {
  totalStrength: number; // 0~100，证据总强度
  evidenceCount: number;
  isOverwhelming: boolean; // 总强度 >= 70
}

// 证据强度计算
export function calculateEvidenceStrength(
  evidence: InvestigationEvidence[],
  corruptionRisk: number,
): EvidenceStrength {
  const weights: Record<InvestigationEvidence, number> = {
    [InvestigationEvidence.Bribery]: 25,
    [InvestigationEvidence.AssetAnomaly]: 15,
    [InvestigationEvidence.ApprovalViolation]: 20,
    [InvestigationEvidence.CommunicationLog]: 10,
    [InvestigationEvidence.WitnessTestimony]: 20,
    [InvestigationEvidence.LifestyleClue]: 10,
  };

  const totalStrength = Math.min(
    evidence.reduce((sum, e) => sum + weights[e], 0) * (corruptionRisk / 100),
    100,
  );

  return {
    totalStrength: Math.round(totalStrength),
    evidenceCount: evidence.length,
    isOverwhelming: totalStrength >= 70,
  };
}

// 坦白认罪
export function resolveConfession(ctx: InvestigationContext): {
  outcome: string;
  penalty: string;
  gameOver: boolean;
} {
  // 坦白从轻：降职但不 Game Over
  return {
    outcome: '坦白认罪，从轻处理',
    penalty: '免去领导职务，降级两级，晋升冻结三届',
    gameOver: false,
  };
}

// 辩护抵赖
export function resolveDenial(
  ctx: InvestigationContext,
  evidence: EvidenceStrength,
): { outcome: string; success: boolean; penalty: string; gameOver: boolean } {
  // 辩护成功率 = (100 - 证据强度) × (廉洁/100) × 0.8
  const successRate = (100 - evidence.totalStrength) * (ctx.playerIntegrity / 100) * 0.8;
  const success = Math.random() * 100 < successRate;

  if (success) {
    return {
      outcome: '辩护成功，证据不足，解除审查',
      success: true,
      penalty: '无',
      gameOver: false,
    };
  }
  return {
    outcome: '辩护失败，证据确凿',
    success: false,
    penalty: '开除公职，游戏结束',
    gameOver: true,
  };
}

// 选择辩护律师
export function resolveLawyer(
  ctx: InvestigationContext,
  evidence: EvidenceStrength,
  lawyerQuality: number, // 律师能力 0~100
): { outcome: string; success: boolean; penalty: string; gameOver: boolean } {
  // 律师加成：成功率 +律师能力×0.3
  const baseRate = (100 - evidence.totalStrength) * (ctx.playerIntegrity / 100) * 0.8;
  const successRate = Math.min(baseRate + lawyerQuality * 0.3, 90);
  const success = Math.random() * 100 < successRate;

  if (success) {
    return {
      outcome: '律师辩护成功，案件撤销',
      success: true,
      penalty: '消耗政治资本30',
      gameOver: false,
    };
  }
  return {
    outcome: '律师辩护失败',
    success: false,
    penalty: '开除党籍，降级三级，晋升永久冻结',
    gameOver: false, // 不 Game Over，但严重惩罚
  };
}

// 触发双规检查（每次行动后调用）
export function checkInvestigationTrigger(corruptionRisk: number): {
  triggered: boolean;
  probability: number;
} {
  // 贪腐风险越高，被审查概率越大
  // 风险 50 → 每行动 0.5% 概率触发；风险 100 → 每行动 5% 概率
  const probability = corruptionRisk * 0.0005;
  const triggered = Math.random() < probability;
  return { triggered, probability };
}
```

### 7.11 以权谋私引擎（corruption-engine.ts）

```typescript
// engine/corruption-engine.ts

interface CorruptionAction {
  id: string;
  name: string;
  description: string;
  apCost: number;
  performanceGain: number; // 政绩收益（短期）
  capitalGain: number; // 政治资本收益
  riskIncrease: number; // 巡视风险增加值
  corruptionIncrease: number; // 贪腐风险增加值
  minLevel: number;
}

export const CORRUPTION_ACTIONS: CorruptionAction[] = [
  {
    id: 'project_kickback',
    name: '项目批复回扣',
    description: '在重大项目批复中收取回扣',
    apCost: 5,
    performanceGain: 15,
    capitalGain: 10,
    riskIncrease: 8,
    corruptionIncrease: 12,
    minLevel: 3,
  },
  {
    id: 'land_profit',
    name: '土地出让暗利',
    description: '在土地出让中获取暗箱利益',
    apCost: 8,
    performanceGain: 25,
    capitalGain: 15,
    riskIncrease: 12,
    corruptionIncrease: 18,
    minLevel: 5,
  },
  {
    id: 'illegal_approval',
    name: '违规审批开绿灯',
    description: '为特定企业违规审批，开绿灯',
    apCost: 4,
    performanceGain: 10,
    capitalGain: 8,
    riskIncrease: 6,
    corruptionIncrease: 10,
    minLevel: 3,
  },
  {
    id: 'crony_employment',
    name: '安插关系户就业',
    description: '在公务员/事业单位招录中安插关系户',
    apCost: 6,
    performanceGain: 5,
    capitalGain: 12,
    riskIncrease: 10,
    corruptionIncrease: 15,
    minLevel: 4,
  },
];

export function executeCorruptionAction(
  action: CorruptionAction,
  playerLevel: number,
  currentCorruptionRisk: number,
): {
  effects: Record<string, number>;
  newCorruptionRisk: number;
  detail: string;
} {
  if (playerLevel < action.minLevel) {
    return { effects: {}, newCorruptionRisk: currentCorruptionRisk, detail: '级别不足，无法执行' };
  }

  const newCorruptionRisk = clamp(currentCorruptionRisk + action.corruptionIncrease, 0, 100);

  return {
    effects: {
      performance: action.performanceGain,
      politicalCapital: action.capitalGain,
      corruptionRisk: action.corruptionIncrease,
    },
    newCorruptionRisk,
    detail: `执行「${action.name}」：政绩+${action.performanceGain}，政治资本+${action.capitalGain}，风险+${action.corruptionIncrease}`,
  };
}
```

### 7.12 重大议案引擎（proposal-engine.ts）

```typescript
// engine/proposal-engine.ts

interface Proposal {
  id: string;
  title: string;
  description: string;
  politicalCapitalCost: number;
  votesNeeded: number; // 需要拉拢的代表票数
  effects: Record<string, number>;
  policyUnlocked: string; // 通过后解锁的政策工具
}

export function canSubmitProposal(level: number, gameYear: number): boolean {
  // 需要人大代表级别（level >= 6）且处于两会年（5年一次）
  return level >= 6 && gameYear % 5 === 0;
}

export function submitProposal(
  proposal: Proposal,
  politicalCapital: number,
  relations: RelationState,
): {
  submitted: boolean;
  detail: string;
} {
  if (politicalCapital < proposal.politicalCapitalCost) {
    return { submitted: false, detail: '政治资本不足，无法提交议案' };
  }
  return {
    submitted: true,
    detail: `议案「${proposal.title}」已提交，需拉拢${proposal.votesNeeded}票`,
  };
}

export function gatherVotes(
  proposal: Proposal,
  playerCharisma: number,
  relations: RelationState,
  apSpent: number, // 花费的 AP（每次拉票消耗 AP）
): {
  votesGathered: number;
  detail: string;
} {
  // 拉票效率 = (魅力 + 人脉总和 / 10) × AP 投入 / 100
  const relationBonus = Object.values(relations.colleagues).reduce((a, b) => a + b, 0) / 10;
  const efficiency = ((playerCharisma + relationBonus) * apSpent) / 100;
  const votesGathered = Math.round(efficiency);

  return {
    votesGathered,
    detail: `拉拢到${votesGathered}票（目标${proposal.votesNeeded}票）`,
  };
}

export function resolveProposalVote(
  proposal: Proposal,
  votesGathered: number,
): {
  passed: boolean;
  detail: string;
  effects: Record<string, number>;
} {
  const passed = votesGathered >= proposal.votesNeeded;
  return {
    passed,
    detail: passed
      ? `议案「${proposal.title}」表决通过，解锁政策工具「${proposal.policyUnlocked}」`
      : `议案「${proposal.title}」表决未通过`,
    effects: passed ? proposal.effects : {},
  };
}
```

### 7.13 历史评价引擎（history-eval-engine.ts）

```typescript
// engine/history-eval-engine.ts

interface HistoricalEvaluation {
  economyScore: number; // 经济维度 0~100
  livelihoodScore: number; // 民生维度 0~100
  integrityScore: number; // 廉洁维度 0~100
  reformScore: number; // 改革维度 0~100
  totalScore: number;
  designation: string; // 历史定性
}

export function calculateHistoryEvaluation(
  careerHistory: CareerRecord[],
  playerStats: { performance: number; integrity: number; competence: number },
  achievements: string[],
): HistoricalEvaluation {
  // 经济维度：基于历年政绩累积
  const economyScore = clamp(playerStats.performance / 5, 0, 100);

  // 民生维度：基于考核历史中民生类 KPI 平均
  const livelihoodScore = clamp(careerHistory.length * 5 + playerStats.competence * 0.3, 0, 100);

  // 廉洁维度：直接取廉洁属性
  const integrityScore = playerStats.integrity;

  // 改革维度：基于成就数量和类型
  const reformScore = clamp(achievements.length * 8 + playerStats.competence * 0.2, 0, 100);

  const totalScore = Math.round(
    economyScore * 0.3 + livelihoodScore * 0.25 + integrityScore * 0.25 + reformScore * 0.2,
  );

  // 历史定性
  let designation: string;
  if (totalScore >= 85) designation = '改革先行者';
  else if (totalScore >= 65) designation = '稳健实干家';
  else designation = '平庸守成者';

  return { economyScore, livelihoodScore, integrityScore, reformScore, totalScore, designation };
}

// 强行续任风险评估
export function evaluateForcedRetention(
  currentScore: number,
  corruptionRisk: number,
): { riskMultiplier: number; clearRisk: string } {
  return {
    riskMultiplier: 1.5,
    clearRisk: `风险系数+50%，一旦触发重大负面事件，历史评价${currentScore}分将全盘清零`,
  };
}
```

### 7.14 接班人引擎（successor-engine.ts）

```typescript
// engine/successor-engine.ts

interface SuccessorCandidate {
  id: string;
  name: string;
  competence: number; // 能力值
  loyalty: number; // 忠诚度
}

export function selectSuccessor(
  candidates: SuccessorCandidate[],
  selectedIndex: number,
): { successor: SuccessorState; detail: string } {
  const chosen = candidates[selectedIndex];
  return {
    successor: {
      id: chosen.id,
      name: chosen.name,
      investment: 0,
      readiness: chosen.competence * 0.3, // 初始准备度基于能力
    },
    detail: `选拔${chosen.name}为接班人，初始准备度${Math.round(chosen.competence * 0.3)}%`,
  };
}

export function investInSuccessor(
  successor: SuccessorState,
  investmentAmount: number, // 关注值投入（消耗政治资本）
  mentorCompetence: number, // 导师（玩家）能力
): { updated: SuccessorState; detail: string } {
  // 准备度增长 = 投入 × 导师能力 / 100
  const growth = (investmentAmount * mentorCompetence) / 100;
  const updated = {
    ...successor,
    investment: successor.investment + investmentAmount,
    readiness: clamp(successor.readiness + growth, 0, 100),
  };
  return {
    updated,
    detail: `投入${investmentAmount}关注值，准备度+${growth.toFixed(1)}%（当前${updated.readiness.toFixed(1)}%）`,
  };
}

export function judgeSuccession(successor: SuccessorState): {
  success: boolean;
  legacyBonus: number;
  detail: string;
} {
  const success = successor.readiness >= 70;
  const legacyBonus = success ? Math.round(successor.readiness * 0.5) : 0;
  return {
    success,
    legacyBonus,
    detail: success ? `接班人接位成功！政治遗产加成+${legacyBonus}` : '接班人准备度不足，接位失败',
  };
}
```

### 7.15 卸任时机引擎（retirement-engine.ts）

```typescript
// engine/retirement-engine.ts

export function getRetirementOptions(
  level: number,
  age: number,
  historyScore: number,
): {
  canRetire: boolean;
  canForceRetain: boolean;
  options: { id: string; label: string; description: string; risk?: string }[];
} {
  const canRetire = level >= 12 && age >= 60;
  const canForceRetain = level >= 12 && age >= 60 && age < 68;

  const options = [];
  if (canRetire) {
    options.push({
      id: 'voluntary',
      label: '主动退休',
      description: `锁定当前历史评价${historyScore}分，进入结局`,
    });
  }
  if (canForceRetain) {
    options.push({
      id: 'force_retain',
      label: '强行续任',
      description: '继续掌权，但风险大幅增加',
      risk: '风险系数+50%，重大负面事件将清零历史评价',
    });
  }

  return { canRetire, canForceRetain, options };
}
```

### 7.16 智库顾问团引擎（think-tank-engine.ts）

```typescript
// engine/think-tank-engine.ts

interface Advisor {
  id: string;
  name: string;
  field: 'science' | 'economics' | 'law';
  quality: number; // 顾问质量 0~100
  cost: number; // 招募消耗政治资本
}

export function recruitAdvisor(
  advisor: Advisor,
  politicalCapital: number,
): { recruited: boolean; detail: string } {
  if (politicalCapital < advisor.cost) {
    return { recruited: false, detail: '政治资本不足，无法招募' };
  }
  return {
    recruited: true,
    detail: `招募${advisor.field}顾问${advisor.name}，质量${advisor.quality}`,
  };
}

export function getAdvisorBonus(advisors: {
  science: Advisor | null;
  economics: Advisor | null;
  law: Advisor | null;
}): { policyEndorsement: number; competenceBonus: number } {
  let policyEndorsement = 0;
  let competenceBonus = 0;

  for (const advisor of Object.values(advisors)) {
    if (advisor) {
      policyEndorsement += advisor.quality * 0.1;
      competenceBonus += advisor.quality * 0.05;
    }
  }

  return {
    policyEndorsement: Math.round(policyEndorsement),
    competenceBonus: Math.round(competenceBonus),
  };
}
```

### 7.17 导师计划引擎（mentor-engine.ts）

```typescript
// engine/mentor-engine.ts

interface Mentee {
  id: string;
  name: string;
  potential: number; // 潜力值 0~100
  progress: number; // 培养进度 0~100
}

export function selectMentees(
  candidates: Mentee[],
  maxCount: number, // 每届最多3名
): { selected: Mentee[]; detail: string } {
  // 按潜力排序，选前 maxCount 名
  const sorted = [...candidates].sort((a, b) => b.potential - a.potential);
  const selected = sorted.slice(0, maxCount);
  return {
    selected: selected.map((m) => ({ ...m, progress: 0 })),
    detail: `选拔${selected.length}名潜力股：${selected.map((m) => m.name).join('、')}`,
  };
}

export function guideMentee(
  mentee: Mentee,
  mentorCompetence: number,
  apSpent: number,
): { updated: Mentee; detail: string } {
  const growth = (apSpent * mentorCompetence) / 100;
  const updated = {
    ...mentee,
    progress: clamp(mentee.progress + growth, 0, 100),
  };
  return {
    updated,
    detail: `指导${mentee.name}，培养进度+${growth.toFixed(1)}%（当前${updated.progress.toFixed(1)}%）`,
  };
}

export function evaluateMenteeOutcome(mentee: Mentee): {
  success: boolean;
  bonus: string;
  detail: string;
} {
  const success = mentee.progress >= 80;
  return {
    success,
    bonus: success ? '长期政治资产+1' : '',
    detail: success ? `${mentee.name}培养成功，成为长期政治资产` : `${mentee.name}培养未达标`,
  };
}
```

### 7.18 历史机遇引擎（opportunity-engine.ts）

```typescript
// engine/opportunity-engine.ts

interface HistoricOpportunity {
  id: string;
  title: string;
  description: string;
  minLevel: number;
  successThreshold: number; // 成功所需综合得分
  rewards: { achievement: string; historyRecord: string; bonusScore: number };
}

export function canTriggerOpportunity(
  level: number,
  gameYear: number,
): { canTrigger: boolean; probability: number } {
  if (level < 11) return { canTrigger: false, probability: 0 };
  // 每年 2% 概率触发
  return { canTrigger: true, probability: 0.02 };
}

export function resolveOpportunity(
  opportunity: HistoricOpportunity,
  playerScore: number,
  politicalCapital: number,
  apSpent: number,
): { success: boolean; rewards: Record<string, number>; detail: string } {
  // 成功概率 = (综合得分 + 政治资本 × 0.5 + AP投入 × 2) / successThreshold
  const totalEffort = playerScore + politicalCapital * 0.5 + apSpent * 2;
  const success = totalEffort >= opportunity.successThreshold;

  return {
    success,
    rewards: success
      ? { achievement: 1, historyRecord: 1, bonusScore: opportunity.rewards.bonusScore }
      : {},
    detail: success
      ? `成功主导「${opportunity.title}」！永久历史记录+最高政绩成就`
      : `未能主导「${opportunity.title}」，机遇流失`,
  };
}
```

### 7.19 修宪提案引擎（constitution-engine.ts）

```typescript
// engine/constitution-engine.ts

interface AmendmentProposal {
  id: string;
  title: string;
  description: string;
  politicalCapitalCost: number;
  successThreshold: number;
  rewards: { achievement: string; historyBonus: number };
}

export function canProposeAmendment(level: number): boolean {
  return level >= 13;
}

export function resolveAmendment(
  proposal: AmendmentProposal,
  playerScore: number,
  politicalCapital: number,
  factionReputation: Record<Faction, number>,
  choice: 'push' | 'maintain',
): { success: boolean; effects: Record<string, number>; detail: string } {
  if (choice === 'maintain') {
    return {
      success: true,
      effects: { stability: 5 },
      detail: '选择维护现状，稳定性+5',
    };
  }

  // 推动修宪：需要极高政治资本和派系支持
  const totalSupport =
    politicalCapital + Object.values(factionReputation).reduce((a, b) => a + b, 0) / 3;
  const success = totalSupport >= proposal.successThreshold && playerScore >= 80;

  if (success) {
    return {
      success: true,
      effects: { achievement: 1, historyBonus: proposal.rewards.historyBonus },
      detail: `修宪提案「${proposal.title}」通过！历史级成就`,
    };
  }
  return {
    success: false,
    effects: { stability: -20, politicalCapital: -50 },
    detail: `修宪提案「${proposal.title}」未通过，稳定性-20，政治资本-50`,
  };
}
```

### 7.20 上级关系引擎（superior-engine.ts）

```typescript
// engine/superior-engine.ts

interface SuperiorAction {
  id: string;
  name: string;
  apCost: number;
  favorGain: number;
  description: string;
}

export const SUPERIOR_ACTIONS: SuperiorAction[] = [
  { id: 'report_work', name: '汇报工作', apCost: 3, favorGain: 5, description: '定期汇报工作进展' },
  {
    id: 'seek_guidance',
    name: '请示问题',
    apCost: 2,
    favorGain: 3,
    description: '向上级请教工作难题',
  },
  { id: 'holiday_greet', name: '节日问候', apCost: 1, favorGain: 2, description: '节日送上问候' },
  {
    id: 'invite_dinner',
    name: '邀请用餐',
    apCost: 4,
    favorGain: 8,
    description: '邀请上司共进晚餐',
  },
  {
    id: 'gift',
    name: '赠送礼物',
    apCost: 2,
    favorGain: 6,
    description: '赠送礼物（风险：廉洁-1）',
  },
];

export function executeSuperiorAction(
  action: SuperiorAction,
  playerAp: number,
  currentFavor: number,
): {
  success: boolean;
  effects: Record<string, number>;
  newFavor: number;
  detail: string;
} {
  if (playerAp < action.apCost) {
    return { success: false, effects: {}, newFavor: currentFavor, detail: 'AP不足' };
  }

  const effects: Record<string, number> = { superiorFavor: action.favorGain };
  if (action.id === 'gift') {
    effects.integrity = -1; // 送礼有廉洁风险
  }

  const newFavor = clamp(currentFavor + action.favorGain, 0, 100);
  return {
    success: true,
    effects,
    newFavor,
    detail: `执行「${action.name}」：上司好感+${action.favorGain}`,
  };
}
```

### 7.21 专项调查/巡视引擎（patrol-engine.ts）

```typescript
// engine/patrol-engine.ts

interface PatrolTarget {
  id: string;
  name: string;
  position: string;
  suspicionLevel: number; // 嫌疑程度 0~100
}

interface PetitionCase {
  id: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
  resolved: boolean;
}

// 主导专项巡察（纪检线专属 + rank6+ 可用）
export function initiatePatrol(
  target: PatrolTarget,
  playerLevel: number,
  careerLine: CareerLine,
  apCost: number,
): {
  initiated: boolean;
  detail: string;
} {
  if (careerLine !== CareerLine.Discipline && playerLevel < 6) {
    return { initiated: false, detail: '需纪检线或级别6以上才能主导巡察' };
  }
  return { initiated: true, detail: `对${target.name}（${target.position}）启动专项巡察` };
}

// 巡察结果
export function resolvePatrol(
  target: PatrolTarget,
  playerCompetence: number,
  playerIntegrity: number,
): {
  foundIssues: boolean;
  detail: string;
  effects: Record<string, number>;
} {
  // 发现问题概率 = 嫌疑程度 × (能力/100)
  const detectionRate = (target.suspicionLevel * playerCompetence) / 10000;
  const foundIssues = Math.random() < detectionRate;

  if (foundIssues) {
    return {
      foundIssues: true,
      detail: `巡察发现${target.name}存在严重违纪问题，已移交纪委处理`,
      effects: { performance: 10, integrity: 2, superiorFavor: 5 },
    };
  }
  return {
    foundIssues: false,
    detail: `巡察未发现${target.name}存在问题`,
    effects: { performance: 2 },
  };
}

// 处理信访举报
export function resolvePetition(
  petition: PetitionCase,
  playerCompetence: number,
  apSpent: number,
): {
  resolved: boolean;
  detail: string;
  effects: Record<string, number>;
} {
  // 化解率 = 能力 × AP投入 / (严重程度系数 × 100)
  const severityMultiplier =
    petition.severity === 'high' ? 2 : petition.severity === 'medium' ? 1.5 : 1;
  const resolveRate = (playerCompetence * apSpent) / (severityMultiplier * 100);
  const resolved = Math.random() < resolveRate;

  return {
    resolved,
    detail: resolved
      ? `成功化解信访案件：${petition.description}`
      : `信访案件未能化解：${petition.description}`,
    effects: resolved ? { performance: 5, stability: 3 } : { stability: -2 },
  };
}
```

### 7.22 个人生活引擎（personal-life-engine.ts）

```typescript
// engine/personal-life-engine.ts

// ---- 住房 ----
interface HousingOption {
  id: string;
  name: string;
  cost: number; // 购置成本（消耗政治资本）
  effects: Record<string, number>;
}

export function purchaseHousing(
  option: HousingOption,
  politicalCapital: number,
): { purchased: boolean; effects: Record<string, number>; detail: string } {
  if (politicalCapital < option.cost) {
    return { purchased: false, effects: {}, detail: '政治资本不足' };
  }
  return { purchased: true, effects: option.effects, detail: `购置${option.name}` };
}

// ---- 子女培养 ----
interface ChildEducation {
  id: string;
  stage: string; // 幼儿/小学/中学/大学/研究生
  action: string;
  apCost: number;
  effects: Record<string, number>;
}

export function educateChild(
  education: ChildEducation,
  playerAp: number,
): { success: boolean; effects: Record<string, number>; detail: string } {
  if (playerAp < education.apCost) {
    return { success: false, effects: {}, detail: 'AP不足' };
  }
  return { success: true, effects: education.effects, detail: `执行${education.action}` };
}

// ---- 学习进修 ----
interface StudyOption {
  id: string;
  name: string;
  apCost: number;
  duration: number; // 持续天数
  effects: Record<string, number>;
}

export function study(
  option: StudyOption,
  playerAp: number,
): { success: boolean; effects: Record<string, number>; detail: string } {
  if (playerAp < option.apCost) {
    return { success: false, effects: {}, detail: 'AP不足' };
  }
  return {
    success: true,
    effects: option.effects,
    detail: `参加${option.name}，持续${option.duration}天`,
  };
}

// ---- 健康管理 ----
interface HealthAction {
  id: string;
  name: string;
  apCost: number;
  maxApBonus: number; // AP 上限加成
  effects: Record<string, number>;
}

export function manageHealth(
  action: HealthAction,
  playerAp: number,
  currentMaxAp: number,
): { success: boolean; newMaxAp: number; effects: Record<string, number>; detail: string } {
  if (playerAp < action.apCost) {
    return { success: false, newMaxAp: currentMaxAp, effects: {}, detail: 'AP不足' };
  }
  const newMaxAp = clamp(currentMaxAp + action.maxApBonus, 15, 35);
  return {
    success: true,
    newMaxAp,
    effects: action.effects,
    detail: `${action.name}：AP上限${currentMaxAp}→${newMaxAp}`,
  };
}

// ---- 兴趣爱好 ----
interface HobbyAction {
  id: string;
  name: string;
  apCost: number;
  relationBonus: number;
  effects: Record<string, number>;
}

export function pursueHobby(
  action: HobbyAction,
  playerAp: number,
): { success: boolean; effects: Record<string, number>; detail: string } {
  if (playerAp < action.apCost) {
    return { success: false, effects: {}, detail: 'AP不足' };
  }
  return {
    success: true,
    effects: { ...action.effects, relationBonus: action.relationBonus },
    detail: `${action.name}：人脉+${action.relationBonus}`,
  };
}
```

### 7.23 档案与成就引擎（archives-engine.ts）

```typescript
// engine/archives-engine.ts

// ---- 成就定义 ----
interface Achievement {
  id: string;
  name: string;
  description: string;
  condition: (save: PlayerSave) => boolean;
}

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: 'first_promotion',
    name: '初露锋芒',
    description: '完成首次晋升',
    condition: (s) => s.careerHistory.length > 1,
  },
  {
    id: 'grassroots_hero',
    name: '基层先锋',
    description: '在基层主官岗位任职满5年',
    condition: (s) => s.careerHistory.filter((r) => r.level <= 3 && r.endYear).length > 0,
  },
  {
    id: 'clean_record',
    name: '清廉标兵',
    description: '廉洁值保持90以上超过10年',
    condition: (s) => s.integrity >= 90,
  },
  {
    id: 'economic_miracle',
    name: '经济奇迹',
    description: 'GDP增长率达到15%以上',
    condition: (s) => s.performance >= 500,
  },
  {
    id: 'faction_leader',
    name: '派系领袖',
    description: '任一派系声望达到80',
    condition: (s) => Object.values(s.factions.reputation).some((v) => v >= 80),
  },
  {
    id: 'master_strategist',
    name: '运筹帷幄',
    description: '政治资本累积到200以上',
    condition: (s) => s.politicalCapital >= 200,
  },
  {
    id: 'line_switcher',
    name: '跨界精英',
    description: '完成至少2次跨线转职',
    condition: (s) => s.transferCount <= 3,
  }, // 初始5，剩3说明用了2次
  {
    id: 'minister',
    name: '省部级领导',
    description: '晋升至级别10以上',
    condition: (s) => s.currentLevel >= 10,
  },
  {
    id: 'historical_figure',
    name: '历史人物',
    description: '历史评价总分达到90以上',
    condition: (s) => s.currentLevel >= 11,
  }, // 简化判断
];

export function checkNewAchievements(
  save: PlayerSave,
  currentAchievements: string[],
): { newAchievements: Achievement[]; updatedList: string[] } {
  const newAchievements = ACHIEVEMENTS.filter(
    (a) => !currentAchievements.includes(a.id) && a.condition(save),
  );
  const updatedList = [...currentAchievements, ...newAchievements.map((a) => a.id)];
  return { newAchievements, updatedList };
}

// ---- 从政履历生成 ----
export function generateCareerTimeline(
  history: CareerRecord[],
  currentLine: CareerLine,
): CareerRecord[] {
  // 仅展示当前线路履历（跨线转职后旧线路封存）
  return history.filter((r) => !r.archived || r.careerLine === currentLine);
}
```

### 7.24 游戏日历引擎（calendar-engine.ts）

```typescript
// engine/calendar-engine.ts

interface CalendarEvent {
  id: string;
  name: string;
  month: number; // 1~12
  day: number; // 1~30
  type: 'holiday' | 'political' | 'personal';
  effects: Record<string, number>;
  description: string;
}

export const ANNUAL_EVENTS: CalendarEvent[] = [
  {
    id: 'spring_festival',
    name: '春节',
    month: 1,
    day: 1,
    type: 'holiday',
    effects: { superiorFavor: 2, ap: 5 },
    description: '春节期间走访慰问',
  },
  {
    id: 'two_sessions',
    name: '两会',
    month: 3,
    day: 5,
    type: 'political',
    effects: {},
    description: '全国两会召开（议案系统触发）',
  },
  {
    id: 'national_day',
    name: '国庆节',
    month: 10,
    day: 1,
    type: 'holiday',
    effects: { stability: 2, ap: 3 },
    description: '国庆庆祝活动',
  },
  {
    id: 'party_congress',
    name: '党代会',
    month: 10,
    day: 15,
    type: 'political',
    effects: {},
    description: '党代会召开（每5年一次）',
  },
  {
    id: 'year_end_review',
    name: '年终总结',
    month: 12,
    day: 25,
    type: 'political',
    effects: { performance: 3 },
    description: '年终工作总结',
  },
];

export function getCalendarEvents(
  gameMonth: number,
  gameDay: number,
  gameYear: number,
): CalendarEvent[] {
  return ANNUAL_EVENTS.filter((e) => {
    // 党代会只在每5年的10月触发
    if (e.id === 'party_congress' && gameYear % 5 !== 0) return false;
    // 两会只在两会年触发
    if (e.id === 'two_sessions' && gameYear % 5 !== 0) return false;
    return e.month === gameMonth && e.day === gameDay;
  });
}

export function getRetirementCountdown(birthYear: number, gameYear: number): number {
  return Math.max(65 - (gameYear - birthYear), 0);
}

export function isCongressYear(gameYear: number): boolean {
  return gameYear % 5 === 0;
}
```

### 7.25 人脉关系引擎（relation-engine-extended.ts）

```typescript
// engine/relation-engine-extended.ts

interface NPC {
  id: string;
  name: string;
  category: keyof RelationState;
  position: string;
  influence: number; // 影响力 0~100
  relationship: number; // 关系值 0~100
}

export function buildRelationship(
  npc: NPC,
  action: 'network' | 'favor' | 'gift' | 'dinner',
  playerCharisma: number,
  apCost: number,
): { gain: number; newRelationship: number; detail: string } {
  const baseGain: Record<string, number> = {
    network: 3,
    favor: 5,
    gift: 8,
    dinner: 6,
  };
  const gain = Math.round((baseGain[action] * playerCharisma) / 100);
  const newRelationship = clamp(npc.relationship + gain, 0, 100);

  return {
    gain,
    newRelationship,
    detail: `与${npc.name}关系+${gain}（当前${newRelationship}）`,
  };
}

export function requestFavor(
  npc: NPC,
  favorType: 'vote' | 'information' | 'endorsement' | 'funding',
): {
  granted: boolean;
  relationshipCost: number;
  detail: string;
} {
  const costByType: Record<string, number> = {
    vote: 20,
    information: 10,
    endorsement: 30,
    funding: 25,
  };
  const cost = costByType[favorType];
  const granted = npc.relationship >= cost;
  const relationshipCost = granted ? Math.round(cost * 0.5) : 0;

  return {
    granted,
    relationshipCost,
    detail: granted
      ? `${npc.name}同意帮忙（关系-${relationshipCost}）`
      : `${npc.name}拒绝了请求（关系不足）`,
  };
}
```

---

## 8. 前端架构

### 8.1 路由设计

使用自建 hash router，支持参数化路由。

```typescript
// router.ts

interface Route {
  path: string;
  component: () => JSX.Element;
  auth?: boolean; // 需要登录
  characterCreated?: boolean; // 需要角色已创建
}

const routes: Route[] = [
  // ---- 认证 ----
  { path: '/', component: SplashPage },
  { path: '/login', component: LoginPage },

  // ---- 建档 ----
  { path: '/character', component: CharacterCreation, auth: true },

  // ---- 游戏主界面 ----
  { path: '/dashboard', component: Dashboard, auth: true, characterCreated: true },
  { path: '/career', component: CareerPath, auth: true, characterCreated: true },
  {
    path: '/position/:line/:level/:posIndex',
    component: PositionHub,
    auth: true,
    characterCreated: true,
  },
  {
    path: '/position/:line/:level/:posIndex/dept/:deptIndex',
    component: PositionDept,
    auth: true,
    characterCreated: true,
  },
  {
    path: '/kpi/:line/:level/:posIndex',
    component: PositionKPI,
    auth: true,
    characterCreated: true,
  },

  // ---- 晋升 ----
  { path: '/promotion', component: PromotionPage, auth: true, characterCreated: true },
  { path: '/transfer', component: CareerTransfer, auth: true, characterCreated: true },
  { path: '/reserve', component: ReserveCadre, auth: true, characterCreated: true },

  // ---- 秘书处 ----
  { path: '/secretary', component: SecretaryPage, auth: true, characterCreated: true },

  // ---- 子系统 ----
  { path: '/events', component: EventsPage, auth: true, characterCreated: true },
  { path: '/relations', component: RelationsPage, auth: true, characterCreated: true },
  { path: '/superior', component: SuperiorPage, auth: true, characterCreated: true },
  { path: '/factions', component: FactionsPage, auth: true, characterCreated: true },
  { path: '/personal', component: PersonalLife, auth: true, characterCreated: true },
  { path: '/personal/:tab', component: PersonalLifeTab, auth: true, characterCreated: true },
  { path: '/archives', component: ArchivesPage, auth: true, characterCreated: true },
  { path: '/archives/:tab', component: ArchivesTab, auth: true, characterCreated: true },
  { path: '/calendar', component: CalendarPage, auth: true, characterCreated: true },
  { path: '/patrol', component: PatrolPage, auth: true, characterCreated: true },
  { path: '/corruption', component: CorruptionPage, auth: true, characterCreated: true },
  { path: '/investigation', component: InvestigationPage, auth: true, characterCreated: true },
  { path: '/proposal', component: ProposalPage, auth: true, characterCreated: true },
  { path: '/history-eval', component: HistoryEvalPage, auth: true, characterCreated: true },
  { path: '/successor', component: SuccessorPage, auth: true, characterCreated: true },
  { path: '/retirement', component: RetirementPage, auth: true, characterCreated: true },
  { path: '/think-tank', component: ThinkTankPage, auth: true, characterCreated: true },
  { path: '/mentor', component: MentorPage, auth: true, characterCreated: true },
  { path: '/opportunity', component: OpportunityPage, auth: true, characterCreated: true },
  { path: '/constitution', component: ConstitutionPage, auth: true, characterCreated: true },

  // ---- 结局 ----
  { path: '/ending', component: GameEnding, auth: true, characterCreated: true },
];

// 路由解析
function parseRoute(hash: string): { route: Route; params: Record<string, string> } | null {
  const path = hash.replace('#', '') || '/';
  for (const route of routes) {
    const params = matchPath(route.path, path);
    if (params !== null) return { route, params };
  }
  return null;
}

// 路径匹配（支持 :param）
function matchPath(pattern: string, path: string): Record<string, string> | null {
  const patternParts = pattern.split('/');
  const pathParts = path.split('/');
  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      params[patternParts[i].slice(1)] = pathParts[i];
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }
  return params;
}
```

### 8.2 核心组件设计

#### 数据驱动：PositionHub（职位主界面）

一个组件服务全部 154 个职位，从配置数据动态渲染。

```tsx
// pages/career/position-hub.tsx

import { useGameStore } from '../../store/game-store';
import { useConfigRepo } from '../../services/config-repo';

export function PositionHub({ line, level, posIndex }: RouteParams) {
  const { player, dept } = useGameStore();
  const positionConfig = useConfigRepo().getPosition(line, level, posIndex);

  if (!positionConfig) return <NotFound />;

  return (
    <div class="position-hub">
      {/* 职位头部 */}
      <header>
        <h1>{positionConfig.name}</h1>
        <span class="badge" style={{ background: positionConfig.careerLine.color }}>
          {positionConfig.careerLine.name} · 级别{level}
        </span>
      </header>

      {/* KPI 指标列表 */}
      <section>
        <h2>专属考核指标</h2>
        {positionConfig.kpiIndicators.map((kpi) => (
          <KPIRow key={kpi.id} config={kpi} currentValue={/* 从 store 读取 */} />
        ))}
      </section>

      {/* 部门列表 */}
      <section>
        <h2>管辖部门</h2>
        {positionConfig.departments.map((deptConfig, idx) => (
          <DepartmentCard
            key={deptConfig.id}
            config={deptConfig}
            state={dept.getDept(deptConfig.id).value}
            onEnter={() => navigate(`/position/${line}/${level}/${posIndex}/dept/${idx}`)}
          />
        ))}
      </section>

      {/* 预算状态 */}
      <section>
        <BudgetGauge total={positionConfig.annualBudget} remaining={player.remainingBudget.value} />
      </section>
    </div>
  );
}
```

#### 数据驱动：PositionDept（部门玩法页面）

```tsx
// pages/career/position-dept.tsx

export function PositionDept({ line, level, posIndex, deptIndex }: RouteParams) {
  const { player, dept, dispatch } = useGameStore();
  const deptConfig = useConfigRepo().getDepartment(line, level, posIndex, deptIndex);
  const deptState = dept.getDept(deptConfig.id);

  const handleAction = (actionId: string) => {
    dispatch({ type: 'EXECUTE_ACTION', payload: { deptId: deptConfig.id, actionId } });
  };

  return (
    <div class="position-dept">
      <header>
        <h1>{deptConfig.name}</h1>
        <span>月度消耗：{deptState.value.monthlyConsumption}万元</span>
      </header>

      {/* 行动列表 */}
      <section>
        {deptConfig.actions.map((action) => {
          const cooldownEnd = deptState.value.actionCooldowns[action.id] ?? 0;
          const isCooling = player.gameDay.value < cooldownEnd;
          const canAfford = player.ap.value >= action.apCost;

          return (
            <ActionButton
              key={action.id}
              name={action.name}
              description={action.description}
              apCost={action.apCost}
              disabled={isCooling || !canAfford}
              cooldownRemaining={isCooling ? cooldownEnd - player.gameDay.value : 0}
              onClick={() => handleAction(action.id)}
            />
          );
        })}
      </section>

      {/* KPI 数值 */}
      <section>
        {deptConfig.kpiIndicators.map((kpi) => (
          <StatCard key={kpi.id} label={kpi.name} value={deptState.value.kpiValues[kpi.id]} />
        ))}
      </section>
    </div>
  );
}
```

#### 晋升流程组件

```tsx
// pages/promotion/promotion.tsx

export function PromotionPage() {
  const { career, player, dispatch } = useGameStore();
  const stage = career.promotionStage.value;

  return (
    <div class="promotion">
      {/* 阶段进度条 */}
      <PromotionStepper currentStage={stage} />

      {/* 根据阶段渲染不同内容 */}
      {stage === PromotionStage.Idle && <PromotionEntry />}
      {stage === PromotionStage.DemocraticVote && <DemocraticVoteStage />}
      {stage === PromotionStage.OrgInspection && <OrgInspectionStage />}
      {stage === PromotionStage.JointReview && <JointReviewStage />}
      {stage === PromotionStage.CommitteeVote && <CommitteeVoteStage />}
      {stage === PromotionStage.PublicNotice && <PublicNoticeStage />}
      {stage === PromotionStage.Appointment && <AppointmentStage />}
      {stage === PromotionStage.Probation && <ProbationStage />}
      {stage === PromotionStage.Completed && <PromotionSuccess />}
      {stage === PromotionStage.Failed && <PromotionFailed />}

      {/* 红色警告 */}
      <WarningBanner>
        确认晋升新岗位，原有岗位专属职权与事件永久清空，仅保留职级基础权限，无法回滚
      </WarningBanner>
    </div>
  );
}
```

#### 秘书处组件（5 Tab）

```tsx
// pages/secretary/secretary.tsx

const TABS = [
  { id: 'manage', label: '秘书管理', minRank: 0 },
  { id: 'documents', label: '文件批示', minRank: 0 },
  { id: 'sentiment', label: '舆情管理', minRank: 4 },
  { id: 'coordination', label: '公务协调', minRank: 0 },
  { id: 'assistant', label: '辅助功能', minRank: 0 },
];

export function SecretaryPage() {
  const { player } = useGameStore();
  const [activeTab, setActiveTab] = useState('manage');

  const availableTabs = TABS.filter((t) => player.level.value >= t.minRank);

  return (
    <div class="secretary">
      {/* 秘书信息头部 */}
      <SecretaryHeader />

      {/* Tab 切换 */}
      <TabBar tabs={availableTabs} active={activeTab} onChange={setActiveTab} />

      {/* Tab 内容 */}
      {activeTab === 'manage' && <SecretaryManageTab />}
      {activeTab === 'documents' && <DocumentTab />}
      {activeTab === 'sentiment' && <SentimentTab />}
      {activeTab === 'coordination' && <CoordinationTab />}
      {activeTab === 'assistant' && <AssistantTab />}
    </div>
  );
}
```

### 8.3 页面导航流

```
启动页 → 登录页 → 建档系统（6步向导）→ 主仪表盘
                                           │
          ┌────────────────────────────────┤
          │                                │
          ▼                                ▼
    职业线入口                       各子系统入口
    ├── 职位主界面                   ├── 秘书处
    │   ├── 部门玩法页面             ├── 随机事件
    │   └── KPI 考核页面             ├── 人脉关系
    │                                ├── 派系政治
    ├── 晋升系统（6阶段）            ├── 个人生活
    ├── 跨线转职                     ├── 以权谋私
    ├── 后备干部池                   ├── 双规审查
    │                                ├── 重大议案
    │                                ├── 历史评价
    │                                ├── 接班人
    │                                ├── 智库顾问团
    │                                ├── 导师计划
    │                                ├── 历史机遇
    │                                └── 修宪提案
    │
    └── 游戏结局 ← 退休/双规失败/特殊结局
```

### 8.4 仪表盘条件入口逻辑

```typescript
// 仪表盘上各功能入口的显示条件
const dashboardEntries = [
  { path: '/career', label: '职业线', show: () => true },
  { path: '/kpi/...', label: '考核结果', show: () => true },
  { path: '/superior', label: '上级关系', show: () => true },
  { path: '/relations', label: '人脉网络', show: () => true },
  { path: '/factions', label: '派系政治', show: () => true },
  { path: '/personal', label: '个人生活', show: () => true },
  { path: '/calendar', label: '日历', show: () => true },
  { path: '/archives', label: '档案与成就', show: () => true },
  { path: '/patrol', label: '专项调查', show: () => level >= 6 || careerLine === 'discipline' },
  { path: '/promotion', label: '晋升', show: () => isPromotionEligible() },
  { path: '/transfer', label: '跨线转职', show: () => !isLineLocked && isInTransferWindow() },
  { path: '/reserve', label: '后备干部池', show: () => reserveTier > 0 },
  { path: '/investigation', label: '双规预警', show: () => isUnderInvestigation },
  { path: '/corruption', label: '特殊渠道', show: () => level >= 3 },
  { path: '/proposal', label: '重大议案', show: () => level >= 6 && isCongressYear() },
  { path: '/history-eval', label: '历史评价', show: () => yearsUntilRetirement <= 3 },
  { path: '/successor', label: '接班人培养', show: () => level >= 12 },
  { path: '/retirement', label: '卸任时机', show: () => level >= 12 && isRetirementEligible() },
  { path: '/think-tank', label: '智库顾问团', show: () => level >= 9 },
  { path: '/mentor', label: '导师计划', show: () => level >= 10 },
  { path: '/opportunity', label: '历史机遇', show: () => level >= 11 && hasHistoricOpportunity() },
  { path: '/constitution', label: '修宪提案', show: () => level >= 13 },
];
```

---

## 9. 配置数据管理

### 9.1 问题：154 个职位、660 个部门的配置数据如何管理？

直接手写所有配置约需 15,000 行 JSON/TS，维护成本极高。解决方案是**模板继承 + 差异覆盖**。

### 9.2 模板继承设计

```typescript
// config/templates.ts

// ============ 部门模板 ============
// 同类型的部门共享基础配置，各职位只覆盖差异项

export const DEPT_TEMPLATES: Record<string, Partial<DepartmentConfig>> = {
  urban_dev: {
    name: '城建部门',
    consumptionCoefficient: 1.5,
    baseConsumption: 100,
    actions: [
      {
        id: 'approve_project',
        name: '审批工程项目',
        apCost: 5,
        cooldownDays: 3,
        budgetDelta: 50,
        effects: [{ target: 'dept.kpi.project_completion', operation: 'add', value: 10 }],
      },
      {
        id: 'urban_planning',
        name: '城市规划评审',
        apCost: 3,
        cooldownDays: 2,
        budgetDelta: 20,
        effects: [{ target: 'dept.kpi.planning_score', operation: 'add', value: 5 }],
      },
    ],
    kpiIndicators: [
      {
        id: 'project_completion',
        name: '项目完成度',
        targetValue: 100,
        weight: 0.5,
        unit: '%',
        calcType: 'ratio',
      },
      {
        id: 'planning_score',
        name: '规划评分',
        targetValue: 80,
        weight: 0.5,
        unit: '分',
        calcType: 'ratio',
      },
    ],
  },

  finance: {
    name: '财政部门',
    consumptionCoefficient: 0.8,
    baseConsumption: 60,
    actions: [
      {
        id: 'budget_review',
        name: '预算审查',
        apCost: 3,
        cooldownDays: 2,
        budgetDelta: 10,
        effects: [{ target: 'dept.kpi.fiscal_health', operation: 'add', value: 8 }],
      },
      {
        id: 'tax_collection',
        name: '税收征管',
        apCost: 4,
        cooldownDays: 3,
        budgetDelta: 30,
        effects: [{ target: 'dept.kpi.revenue_rate', operation: 'add', value: 6 }],
      },
    ],
    kpiIndicators: [
      {
        id: 'fiscal_health',
        name: '财政健康度',
        targetValue: 90,
        weight: 0.5,
        unit: '%',
        calcType: 'ratio',
      },
      {
        id: 'revenue_rate',
        name: '税收完成率',
        targetValue: 100,
        weight: 0.5,
        unit: '%',
        calcType: 'ratio',
      },
    ],
  },

  // ... 更多通用部门模板：education, health, public_safety, environment, party_org, propaganda, discipline_inspect, ...
};

// ============ KPI 模板 ============

export const KPI_TEMPLATES: Record<string, KPIIndicatorConfig> = {
  gdp_growth: {
    id: 'gdp_growth',
    name: 'GDP增长率',
    targetValue: 8,
    weight: 0.25,
    unit: '%',
    calcType: 'ratio',
  },
  fiscal_revenue: {
    id: 'fiscal_revenue',
    name: '财政收入完成率',
    targetValue: 100,
    weight: 0.2,
    unit: '%',
    calcType: 'ratio',
  },
  livelihood: {
    id: 'livelihood',
    name: '民生满意度',
    targetValue: 80,
    weight: 0.2,
    unit: '分',
    calcType: 'ratio',
  },
  project_done: {
    id: 'project_done',
    name: '重大项目完成度',
    targetValue: 100,
    weight: 0.15,
    unit: '%',
    calcType: 'ratio',
  },
  safety: {
    id: 'safety',
    name: '安全生产事故率',
    targetValue: 2,
    weight: 0.1,
    unit: '次',
    calcType: 'inverse',
  },
  party_building: {
    id: 'party_building',
    name: '党建工作评分',
    targetValue: 90,
    weight: 0.2,
    unit: '分',
    calcType: 'ratio',
  },
  anti_corruption: {
    id: 'anti_corruption',
    name: '廉政建设评分',
    targetValue: 95,
    weight: 0.25,
    unit: '分',
    calcType: 'ratio',
  },
  case_clearance: {
    id: 'case_clearance',
    name: '案件结案率',
    targetValue: 90,
    weight: 0.3,
    unit: '%',
    calcType: 'ratio',
  },
  petition_resolve: {
    id: 'petition_resolve',
    name: '信访化解率',
    targetValue: 85,
    weight: 0.2,
    unit: '%',
    calcType: 'ratio',
  },
  youth_employ: {
    id: 'youth_employ',
    name: '青年就业率',
    targetValue: 90,
    weight: 0.25,
    unit: '%',
    calcType: 'ratio',
  },
  women_rights: {
    id: 'women_rights',
    name: '妇女权益保障评分',
    targetValue: 85,
    weight: 0.2,
    unit: '分',
    calcType: 'ratio',
  },
};

// ============ 职位工厂 ============

export function buildPosition(
  careerLine: CareerLine,
  level: number,
  index: number,
  name: string,
  deptTemplates: string[], // 引用部门模板 key
  kpiTemplateIds: string[], // 引用 KPI 模板 key
  overrides: {
    annualBudget?: number;
    deptOverrides?: Record<string, Partial<DepartmentConfig>>;
    kpiOverrides?: Record<string, Partial<KPIIndicatorConfig>>;
  } = {},
): PositionConfig {
  const id = `${careerLine}_l${level}_${index}`;

  // 构建部门（从模板 + 覆盖）
  const departments = deptTemplates.map((tplKey, i) => {
    const tpl = DEPT_TEMPLATES[tplKey];
    const deptOverride = overrides.deptOverrides?.[tplKey];
    return {
      ...tpl,
      ...deptOverride,
      id: `${id}_dept_${i}`,
      name: deptOverride?.name ?? tpl.name,
      actions: tpl.actions.map((a) => ({ ...a })),
      kpiIndicators: tpl.kpiIndicators.map((k) => ({ ...k })),
    } as DepartmentConfig;
  });

  // 构建 KPI（从模板 + 覆盖 + 权重重新归一化）
  const kpiIndicators = kpiTemplateIds.map((kpiId) => {
    const tpl = KPI_TEMPLATES[kpiId];
    const kpiOverride = overrides.kpiOverrides?.[kpiId];
    return { ...tpl, ...kpiOverride };
  });

  return {
    id,
    name,
    level,
    careerLine,
    departments,
    kpiIndicators,
    annualBudget: overrides.annualBudget ?? getDefaultBudget(level, careerLine),
  };
}

function getDefaultBudget(level: number, line: CareerLine): number {
  // 基础拨款随级别递增
  const base = [0, 1000, 2000, 3000, 5000, 8000, 12000, 18000, 25000, 35000, 50000, 70000];
  // 党务/群团比行政低 20%，纪检持平
  const multiplier =
    line === CareerLine.Administrative ? 1.0 : line === CareerLine.Discipline ? 1.0 : 0.8;
  return base[level] * multiplier;
}
```

### 9.3 职业线配置示例（行政线级别 1~3）

```typescript
// config/career-lines/administrative.ts

import { CareerLine } from '../../types/enums';
import { buildPosition } from '../templates';

const adminLine: CareerLineConfig = {
  id: CareerLine.Administrative,
  name: '行政线',
  color: '#4A6FA5', // 蓝灰
  description: '以经济发展、民生服务和社会治理为核心的行政管理路线',
  privileges: ['经济管理权', '行政审批权', '财政支配权'],

  levels: [
    // ---- 级别 1：科员 ----
    {
      level: 1,
      label: '科员',
      positions: [
        buildPosition(
          'admin',
          1,
          0,
          '乡镇科员',
          ['general_office', 'civil_affairs', 'agriculture', 'public_safety'],
          ['office_efficiency', 'petition_resolve', 'agricultural_output', 'safety'],
          { annualBudget: 800 },
        ),
        buildPosition(
          'admin',
          1,
          1,
          '社区工作员',
          ['community_service', 'civil_affairs', 'environment', 'cultural'],
          ['resident_satisfaction', 'petition_resolve', 'environment_score', 'cultural_activity'],
          { annualBudget: 600 },
        ),
        buildPosition(
          'admin',
          1,
          2,
          '乡镇办事员',
          ['general_office', 'finance', 'agriculture', 'statistics'],
          ['office_efficiency', 'fiscal_revenue', 'agricultural_output', 'data_accuracy'],
          { annualBudget: 700 },
        ),
      ],
      promotionRequirements: {
        minYearsInService: 3,
        minAssessmentPasses: 2,
        politicalConditions: ['无党纪处分记录'],
      },
    },

    // ---- 级别 2：副科 ----
    {
      level: 2,
      label: '副科',
      positions: [
        buildPosition(
          'admin',
          2,
          0,
          '副镇长',
          ['urban_dev', 'finance', 'public_safety', 'civil_affairs'],
          ['gdp_growth', 'fiscal_revenue', 'safety', 'livelihood'],
          { annualBudget: 2000 },
        ),
        buildPosition(
          'admin',
          2,
          1,
          '乡镇办公室主任',
          ['general_office', 'human_resources', 'propaganda_dept', 'logistics'],
          ['office_efficiency', 'staff_satisfaction', 'propaganda_score', 'cost_control'],
          { annualBudget: 1500 },
        ),
        buildPosition(
          'admin',
          2,
          2,
          '民政助理',
          ['civil_affairs', 'social_security', 'disability_service', 'elderly_care'],
          [
            'livelihood',
            'social_security_coverage',
            'disability_service_score',
            'elderly_care_rate',
          ],
          { annualBudget: 1800 },
        ),
      ],
      promotionRequirements: {
        minYearsInService: 3,
        minAssessmentPasses: 3,
        politicalConditions: ['无党纪处分记录', '人事档案合规'],
      },
    },

    // ---- 级别 3：正科 ----
    {
      level: 3,
      label: '正科',
      positions: [
        buildPosition(
          'admin',
          3,
          0,
          '镇长',
          ['urban_dev', 'finance', 'public_safety', 'civil_affairs', 'agriculture'],
          ['gdp_growth', 'fiscal_revenue', 'livelihood', 'project_done', 'safety'],
          { annualBudget: 5000 },
        ),
        buildPosition(
          'admin',
          3,
          1,
          '乡镇党委委员',
          ['party_org', 'propaganda_dept', 'human_resources', 'discipline_inspect'],
          ['party_building', 'propaganda_score', 'staff_satisfaction', 'anti_corruption'],
          { annualBudget: 3500 },
        ),
        buildPosition(
          'admin',
          3,
          2,
          '科室主任',
          ['general_office', 'finance', 'human_resources', 'statistics'],
          ['office_efficiency', 'fiscal_revenue', 'staff_satisfaction', 'data_accuracy'],
          { annualBudget: 3000 },
        ),
        buildPosition(
          'admin',
          3,
          3,
          '副乡镇党委书记',
          ['party_org', 'general_office', 'public_safety', 'civil_affairs'],
          ['party_building', 'office_efficiency', 'safety', 'livelihood'],
          { annualBudget: 4000 },
        ),
      ],
      promotionRequirements: {
        minYearsInService: 3,
        minAssessmentPasses: 3,
        politicalConditions: ['无党纪处分记录'],
        specialConditions: ['grassroots'],
      },
    },

    // ---- 级别 4~11（结构相同，数据递增）----
    // ...
  ],
};

export default adminLine;
```

### 9.4 配置懒加载

```typescript
// services/config-repo.ts

const careerLineCache: Record<string, CareerLineConfig> = {};

export function useConfigRepo() {
  async function getCareerLine(line: CareerLine): Promise<CareerLineConfig> {
    if (careerLineCache[line]) return careerLineCache[line];

    // 动态 import，esbuild 会自动 code-split
    switch (line) {
      case CareerLine.Administrative:
        careerLineCache[line] = (await import('../config/career-lines/administrative')).default;
        break;
      case CareerLine.Party:
        careerLineCache[line] = (await import('../config/career-lines/party')).default;
        break;
      case CareerLine.Discipline:
        careerLineCache[line] = (await import('../config/career-lines/discipline')).default;
        break;
      case CareerLine.Mass:
        careerLineCache[line] = (await import('../config/career-lines/mass')).default;
        break;
    }
    return careerLineCache[line];
  }

  function getPosition(line: CareerLine, level: number, index: number): PositionConfig | null {
    const config = careerLineCache[line];
    if (!config) return null;
    const levelConfig = config.levels.find((l) => l.level === level);
    return levelConfig?.positions[index] ?? null;
  }

  function getDepartment(
    line: CareerLine,
    level: number,
    posIndex: number,
    deptIndex: number,
  ): DepartmentConfig | null {
    const pos = getPosition(line, level, posIndex);
    return pos?.departments[deptIndex] ?? null;
  }

  return { getCareerLine, getPosition, getDepartment };
}
```

### 9.5 配置数据量估算

| 数据类型                | 估算体积   | 加载策略   |
| ----------------------- | ---------- | ---------- |
| 模板文件 (templates.ts) | ~15KB      | 首屏加载   |
| 行政线配置              | ~40KB      | 懒加载     |
| 党务线配置              | ~40KB      | 懒加载     |
| 纪检线配置              | ~40KB      | 懒加载     |
| 群团线配置              | ~40KB      | 懒加载     |
| 随机事件库              | ~20KB      | 懒加载     |
| 常量定义                | ~5KB       | 首屏加载   |
| **总计**                | **~200KB** | 首屏 ~20KB |

---

## 10. 关键业务流程时序图

### 10.1 执行部门行动 → 月度结算

```
玩家                UI              Store           Engine          Supabase
 │                  │                │                │                │
 │ 点击"审批工程"   │                │                │                │
 │─────────────────>│                │                │                │
 │                  │ dispatch(      │                │                │
 │                  │ EXECUTE_ACTION)│                │                │
 │                  │───────────────>│                │                │
 │                  │                │ ActionEngine   │                │
 │                  │                │ .execute()     │                │
 │                  │                │───────────────>│                │
 │                  │                │                │ 校验 AP/预算   │
 │                  │                │                │ /冷却时间      │
 │                  │                │ ActionResult   │                │
 │                  │                │<───────────────│                │
 │                  │                │                │                │
 │                  │                │ 更新 signals   │                │
 │                  │                │ - ap -= 5      │                │
 │                  │                │ - budget -= 50 │                │
 │                  │                │ - kpi += 10    │                │
 │                  │                │ - cooldown     │                │
 │                  │                │                │                │
 │                  │                │ TimeEngine     │                │
 │                  │                │ .advance(3天)  │                │
 │                  │                │───────────────>│                │
 │                  │                │ 检测到跨月     │                │
 │                  │                │ triggers:      │                │
 │                  │                │ [monthly_      │                │
 │                  │                │  settlement]   │                │
 │                  │                │                │                │
 │                  │                │ BudgetEngine   │                │
 │                  │                │ .monthlySettle │                │
 │                  │                │───────────────>│                │
 │                  │                │ 各部门扣费     │                │
 │                  │                │ 活跃度衰减     │                │
 │                  │                │                │                │
 │                  │ 自动更新       │                │                │
 │ 看到结果动画     │<───────────────│                │                │
 │<─────────────────│                │                │                │
 │                  │                │                │                │
 │                  │                │ scheduleSave() │                │
 │                  │                │───────────────────────────────>│
 │                  │                │                │   upsert save │
```

### 10.2 晋升六阶段完整流程

```
玩家选择目标职位
       │
       ▼
  ┌─ 阶段0：门槛校验 ─┐
  │ checkPrerequisites  │
  │ 资历/政治/编制      │
  └────────┬───────────┘
           │ 通过
           ▼
  ┌─ 阶段1：民主推荐 ──┐
  │ resolveDemocratic   │
  │ Vote()              │
  │ 玩家选择：是否拉票  │
  └────────┬────────────┘
           │ 得票前2名
           ▼
  ┌─ 阶段2：组织考察 ──┐
  │ resolveOrg          │
  │ Inspection()        │
  │ 玩家选择：是否引导  │
  └────────┬────────────┘
           │ 优秀/合格
           ▼
  ┌─ 阶段3：联审 ──────┐
  │ resolveJoint        │
  │ Review()            │
  │ 自动：5部门审查     │
  └────────┬────────────┘
           │ 全部通过
           ▼
  ┌─ 阶段4：常委票决 ──┐
  │ resolveCommittee    │
  │ Vote()              │
  │ 自动：无记名投票    │
  └────────┬────────────┘
           │ 赞成过半
           ▼
  ┌─ 阶段5：公示 ──────┐
  │ resolvePublic       │
  │ Notice()            │
  │ 自动：5天公示期     │
  └────────┬────────────┘
           │ 无异议
           ▼
  ┌─ 阶段6：任命+试用期 ┐
  │ resolveProbation()   │
  │ 一年后自动考核       │
  └────────┬─────────────┘
           │ 合格
           ▼
     正式定岗
     旧岗位封存
     新岗位解锁
```

---

## 11. 边界情况与防御设计

### 11.1 状态钳位

所有数值变更统一通过 `clamp` 函数约束边界，防止溢出。

```typescript
// utils/math.ts

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// 属性边界
const ATTR_BOUNDS = {
  ap: [0, 30],
  integrity: [0, 100],
  stability: [0, 100],
  performance: [0, 9999],
  charisma: [0, 100],
  competence: [0, 100],
  corruptionRisk: [0, 100],
  superiorFavor: [0, 100],
  politicalCapital: [0, 500],
  demoralization: [0, 100],
};

export function clampAttr(key: string, value: number): number {
  const [min, max] = ATTR_BOUNDS[key] ?? [0, 9999];
  return clamp(value, min, max);
}
```

### 11.2 防抖与幂等

```typescript
// 存档保存防抖 500ms
let saveTimer: number | null = null;

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const saveData = collectAllSignals();
    saveRepo.upsert(saveData);
    saveTimer = null;
  }, 500);
}

// 行动执行防抖 300ms
let lastActionTime = 0;

function canExecuteAction(): boolean {
  const now = Date.now();
  if (now - lastActionTime < 300) return false;
  lastActionTime = now;
  return true;
}
```

### 11.3 存档完整性校验

```typescript
function validateSave(save: PlayerSave): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!save.currentPositionId) errors.push('缺少当前职位ID');
  if (save.currentLevel < 1 || save.currentLevel > 11) errors.push('级别超出范围');
  if (save.ap < 0) errors.push('AP 为负数');
  if (!save.gameYear || save.gameYear < 2000) errors.push('游戏年份异常');

  return { valid: errors.length === 0, errors };
}
```

### 11.4 网络异常回滚

```typescript
async function saveWithRollback(save: PlayerSave): Promise<boolean> {
  const previousSave = lastConfirmedSave;

  try {
    await saveRepo.upsert(save);
    lastConfirmedSave = save;
    return true;
  } catch (err) {
    // 回滚到上一次确认的存档
    loadSaveIntoSignals(previousSave);
    showToast('存档保存失败，已恢复到上次状态');
    return false;
  }
}
```

---

## 12. 实施路线图

### Phase 0：基础设施搭建（2~3 sessions）

- 项目初始化：Preact + esbuild + TypeScript + Tailwind
- Hash router 实现
- Supabase 连接 + Auth + 表创建
- Signals store 骨架

### Phase 1：配置数据 + 核心页面（4~5 sessions）

- 模板系统实现
- 行政线级别 1~3 配置（验证模板可行性）
- 建档系统（6步向导）
- 仪表盘
- 职业线入口 + PositionHub + PositionDept（数据驱动）

### Phase 2：游戏引擎（4~5 sessions）

- 时间引擎 + 行动引擎
- KPI 引擎 + 预算引擎
- 月度结算 + 年度考核
- AP 恢复 + 活跃度衰减

### Phase 3：晋升系统（3~4 sessions）

- 六阶段状态机完整实现
- 门槛校验 + 后备干部池
- 跨线转职

### Phase 4：配置数据补全（3~4 sessions）

- 行政线级别 4~11
- 党务线、纪检线、群团线全部配置
- 随机事件库

### Phase 5：子系统页面（5~7 sessions）

- 秘书处（5 Tab）
- 人脉关系 + 派系政治
- 个人生活 + 上级关系
- 以权谋私 + 双规审查
- 重大议案 + 历史评价
- 接班人 + 智库 + 导师 + 历史机遇 + 修宪

### Phase 6：收尾与打磨（2~3 sessions）

- 游戏结局
- 存档/读档/多槽位
- 数值平衡调优
- 移动端适配
- 性能优化

**总计估算：23~31 sessions**

---

## 附录 A：与 v2.x 的映射关系

| v2.x 模块                            | v3.0 对应                                      | 变化说明                                  |
| ------------------------------------ | ---------------------------------------------- | ----------------------------------------- |
| game.ts (PlayerSave 350+字段)        | types/player.ts                                | 扁平字段重组为嵌套对象，总字段数减少至~50 |
| gameApi.ts (6481行 120+导出)         | engine/_.ts + store/_.ts                       | 按职责拆分为 9 个引擎模块 + 9 个 store    |
| gameConfig.ts (53导出)               | config/templates.ts + config/career-lines/*.ts | 扩展为模板继承系统                        |
| GameContext.tsx (advanceTime 1100行) | engine/time-engine.ts                          | 提取为纯函数，与 React 解耦               |
| home.tsx (3823行)                    | pages/dashboard/dashboard.tsx + 各子系统页面   | 按功能拆分为独立页面                      |
| secretary.tsx                        | pages/secretary/secretary.tsx                  | 重构为 5 Tab + 新增文件批示/舆情          |

## 附录 B：Supabase 部署检查清单

- [ ] 创建项目，获取 URL + anon key
- [ ] 执行 SQL 建表脚本
- [ ] 配置 RLS 策略
- [ ] 配置手机号验证码认证（需开通 SMS provider）
- [ ] 设置 database function: `upsert_save(user_id, slot, save_data)` 用于原子存档
- [ ] 配置 CORS（允许本地开发域名）
- [ ] 备份策略：每日自动备份

## 附录 C：性能预算

| 指标           | 目标值           |
| -------------- | ---------------- |
| 首屏 JS 体积   | < 200KB gzipped  |
| 首屏加载时间   | < 2s (4G)        |
| 行动执行响应   | < 100ms          |
| 存档保存延迟   | < 500ms          |
| 配置数据懒加载 | < 300ms per line |
| 内存占用       | < 50MB           |
