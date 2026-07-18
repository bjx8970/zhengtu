# 政途人生 v3.0 — 架构文档

## 技术栈

| 层 | 技术 |
|---|------|
| 框架 | SolidJS 1.9 (Vite 6 + vite-plugin-solid) |
| 状态管理 | `createStore` + `produce` (Solid 内置) |
| 语言 | TypeScript 5.7 (strict) |
| 样式 | 内联 style (Phase 0)；后续可选 Tailwind |
| 路由 | 自建 Hash Router (~100 行) |
| 后端 | Supabase (Auth + Database) |
| 持久化 | localStorage (即时备份) + Supabase upsert (推进时提交) |
| 配置 | JSON 模板 + ConfigLoader 运行时展开 |
| 测试 | Vitest + @solidjs/testing-library |
| 校验 | zod schema (`scripts/validate-config.ts`) |
| CI/CD | GitHub Actions (ci.yml + deploy.yml → GitHub Pages) |

## 目录结构

```
src/
├── main.tsx                    # 入口
├── app.tsx                     # 根组件 + 路由出口
├── router.tsx                  # Hash router
│
├── types/                      # TypeScript 类型
│   ├── enums.ts                # 全部枚举
│   ├── config.ts               # 配置数据类型
│   ├── player.ts               # PlayerSave
│   └── game.ts                 # 运行时类型
│
├── config/                     # 纯 JSON 数据（与代码分离）
│   ├── templates/              # 可复用模板
│   │   ├── departments.json    # 部门模板（合并 departments-extra.json）
│   │   ├── kpis.json           # KPI 指标模板
│   │   └── events.json         # 随机事件模板
│   ├── career-lines/           # 4 条职业线定义
│   │   ├── administrative.json
│   │   ├── party.json
│   │   ├── discipline.json
│   │   └── mass.json
│   ├── constants.json          # 全局常量
│   └── loader.ts              # ConfigLoader 单例
│
├── engine/                     # 游戏引擎（纯函数，不引用 UI）
│   ├── core/                   # 核心循环
│   │   ├── time.ts             # 时间推进 + 周期检测
│   │   ├── action.ts           # 行动执行 + 校验
│   │   └── effect.ts           # 效果解析工具
│   ├── governance/             # 治理域 (kpi / budget / assessment)
│   ├── career/                 # 职业域 (promotion / transfer / reserve)
│   ├── social/                 # 社交域 (relations / factions / superior)
│   ├── office/                 # 办公域 (secretary / documents / sentiment)
│   ├── risk/                   # 风险域 (investigation / corruption / patrol)
│   ├── legacy/                 # 高级系统 (successor/think-tank/mentor/…)
│   ├── personal/               # 个人域 (life / calendar / archives)
│   ├── proposal.ts             # 重大议案
│   ├── retirement.ts           # 卸任时机
│   ├── events.ts               # 随机事件
│   └── index.ts                # 聚合导出
│
├── store/
│   └── game-store.ts           # 单一 store (createStore + dispatch)
│
├── services/
│   ├── supabase.ts             # Supabase client 单例
│   └── save-repo.ts            # 存档读写 + 本地/远程仲裁
│
├── pages/                      # 页面组件（按功模块分目录）
├── components/                 # 共享 UI 组件
└── utils/                      # 纯工具函数 (math / format / debounce)
```

## 分层架构

```
UI 层 (Preact/Solid)  ←→  Store 层 (createStore)  ←→  引擎层 (纯函数)  ←→  数据层 (ConfigRepo / SaveRepo)
       ↑                       ↑                         ↑                      ↑
   只能调用 Store           桥接引擎和 UI           不引用 UI/DOM            纯 JSON + Supabase
```

**依赖规则**：上层可调下层，下层不可调上层。

## 核心数据流

### 行动 → 推进 → 保存完整链路

```
 玩家点击"执行行动"              玩家点击"推进一周"
        │                               │
        ▼                               ▼
  ┌─────────────┐               ┌──────────────┐
  │ UI 组件      │               │ Dashboard    │
  │ PositionDept │               │ 推进按钮      │
  └──────┬───────┘               └──────┬───────┘
         │ dispatch(                     │ dispatch(
         │   EXECUTE_ACTION)             │   ADVANCE_TIME)
         ▼                               ▼
  ┌─────────────────────────────────────────┐
  │              game-store.ts              │
  │  setState(produce(draft => {            │
  │    actionEngine.execute(draft, ...)     │
  │    // 校验: 槽位|冷却|预算              │
  │    // 应用: kpiChanges + playerChanges  │
  │                                        │
  │    timeEngine.advance(draft, days)      │
  │    // 判断: 跨月? 跨年? 5年周期?        │
  │    // 生成: triggers[]                  │
  │                                        │
  │    resolveTriggers(draft, triggers)     │
  │    // 月度结算: budgetEngine.settle()   │
  │    // 年度考核: assessmentEngine.run()  │
  │  }))                                    │
  └──────────────┬──────────────────────────┘
                 │
         ┌───────┴────────┐
         ▼                ▼
  ┌──────────┐    ┌──────────────┐
  │ UI 更新   │    │ saveRepo     │
  │           │    │ .upsert()    │
  │ Solid 自动 │    │              │
  │ 追踪变更   │    │ Supabase     │
  │ 字段级渲染 │    │ localStorage │
  └──────────┘    └──────────────┘
```

### 晋升六阶段流程

```
 触发晋升窗口 (年度考核通过)
        │
        ▼
  ┌─ 阶段0：门槛校验 ──────────────────┐
  │ promotionEngine.checkPrerequisites  │
  │ 资历 / 考核 / 处分 / 基层经历        │
  └────────────┬───────────────────────┘
               │ 通过
               ▼
  ┌─ 阶段1：民主推荐 (玩家可干预：拉票) ─┐
  │ promotionEngine.resolveDemocraticVote│
  │ 得票前2名 → 进入考察名单            │
  └────────────┬───────────────────────┘
               │ 通过
               ▼
  ┌─ 阶段2：组织考察 (玩家可干预：引导) ─┐
  │ promotionEngine.resolveOrgInspection│
  │ 优秀/合格 → 通过；暂缓/不宜 → 终止  │
  └────────────┬───────────────────────┘
               │ 通过
               ▼
  ┌─ 阶段3：联审 (自动) ────────────────┐
  │ promotionEngine.resolveJointReview  │
  │ 纪委+公安+信访+审计+网信五部门       │
  └────────────┬───────────────────────┘
               │ 全部通过
               ▼
  ┌─ 阶段4：常委票决 (自动) ────────────┐
  │ promotionEngine.resolveCommitteeVote│
  │ 无记名投票，赞成过半通过            │
  └────────────┬───────────────────────┘
               │ 通过
               ▼
  ┌─ 阶段5：公示 (自动) ────────────────┐
  │ promotionEngine.resolvePublicNotice │
  │ 无举报/无舆情发酵 → 通过            │
  └────────────┬───────────────────────┘
               │ 通过
               ▼
  ┌─ 阶段6：任命+试用期 ───────────────┐
  │ promotionEngine.resolveProbation   │
  │ 一年后考核：合格→定岗；不合格→降回  │
  └────────────────────────────────────┘
```

## 行动系统：槽位制

玩家没有传统"体力值 (AP)"，改用**行动槽位**。

| 槽位等级 | 数量 | 用途 |
|---------|------|------|
| 主要 | 3 | 核心工作，唯一可执行重大行动 |
| 次要 | 2 | 常规工作 |
| 备用 | 1 | 加班槽位，附带健康与消沉惩罚 |

行动按分类决定可用槽位：

| 分类 | 可用槽位 | 冷却 | 同部门并行 |
|------|----------|------|------------|
| 重大 | 仅主要 | 14 天 | 禁止 |
| 次要 | 主要/次要/备用 | 7 天 | 禁止 |
| 日常 | 主要/次要/备用 | 无冷却 | 允许 |

- 玩家在 UI 中选择槽位等级，系统使用该等级第一个空位
- 冷却按部门实例记录，从名义完成日（`startedAtDay + durationDays`）起算
- `startAction()` 校验分类/槽位对齐、预算、重复性和冷却
- `completeActions()` 推进时间后检查到期行动并收集完成项
- 备用槽使用 `constants.json` 中的 `reservePenalty` 扣减健康并增加消沉
- Engine 走 StartActionInput 对象参数，纯函数不修改输入

## 配置数据：模板继承

### 数据流

```
departments.json (模板定义)
    +
career-lines/administrative.json (引用模板名 + 差异覆盖)
    ↓
ConfigLoader.getPosition()
    ↓
完整 PositionConfig (展开后的 departments + kpiIndicators)
```

### 示例

```jsonc
// 模板只定义一次
{ "urban_dev": { "name": "城建部门", "actions": [...], "kpiTemplateIds": [...] } }

// 职位配置只引用模板名
{ "id": "admin_l3_0", "name": "镇长", "departmentTemplateIds": ["urban_dev", "finance", ...] }
```

修改数值只需编辑 JSON，不需要改代码。配置校验脚本保证引用完整性。

## 状态管理：createStore + produce

```typescript
// 一个大 store，嵌套追踪
const [state, setState] = createStore<GameState>(initial);

// dispatch 修改 state
dispatch({ type: 'ADVANCE_TIME', granularity: 'week' }) {
  setState(produce(draft => {
    // 直接修改 draft，produce 自动追踪变更
    draft.slots.available = draft.slots.max;
    draft.time = timeEngine.advance(draft.time, 7);
  }));
}

// 序列化
const snapshot = unwrap(state); // 一键取纯对象，用于存档
```

引擎函数直接操作 draft，不需要返回中间对象。

## 持久化：阶段提交

```
[操作阶段：内存]            [推进时间：提交]
│                           │
├─ 执行行动 × N             ├─ 计算推进天数
├─ 处理文件批示              ├─ 月度/年度结算
├─ 选择事件选项              ├─ unwrap(state)
└─ 所有修改只在 store        ├─ Supabase upsert
                            └─ localStorage.setItem
```

加载时仲裁：比较本地与远程的 `updatedAt`，取较新的。

## 引擎模块设计规范

每个引擎文件：

1. **一个文件一个职责**，禁止合并无关功能
2. **纯函数**：接收数据、返回数据，不引用 DOM 或 `state`
3. **禁止超长文件**：单个文件 >200 行时拆分
4. **参数化依赖**：所有外部状态通过参数传入

```typescript
// ✅ 可测试
export function advanceTime(current: TimeState, days: number, birthYear: number): TimeAdvanceResult

// ❌ 不可测试
export function advanceTime(days: number): void  // 隐式读取全局 state
```

## 职业枚举值使用英文 key

所有枚举值使用英文作为内部 key，中文用于显示：

```typescript
export enum Faction {
  Reform = 'reform',           // 内部标识
  Pragmatic = 'pragmatic',
  Conservative = 'conservative',
}
```

## 性能预算

| 指标 | 目标 |
|------|------|
| 首屏 JS | < 200KB gzipped |
| 首屏加载 | < 2s (4G) |
| 行动响应 | < 100ms |
| 存档保存 | < 500ms |
