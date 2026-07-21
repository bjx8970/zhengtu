# 政途人生 — 架构文档

> 当前版本：0.1.0-alpha.1 | 存档 Schema：1 | 内容版本：2026.07.1

## 当前范围

当前版本是可运行的单机原型，已存在行政线 L1-L11 的配置与 L11 终局代码（36 个职位），但连续晋升链路尚未通过真实验证（当前存在 `multi_region` 履历判定阻塞）。已完成基础工程整理（严格存档解码、统一时间轴、行动快照、Reducer 拆分）。

当前职业模型为旧式单一线性等级结构（`currentLevel` 同时表达职位高低、机关层级和晋升目标）。职务与职级双通道、岗位领域交流和机会驱动选拔尚未实现，属于后续重构对象。

## 技术栈

| 层     | 技术                                                                           |
| ------ | ------------------------------------------------------------------------------ |
| UI     | SolidJS 1.9、Vite 6、`vite-plugin-solid`                                       |
| 状态   | Solid `createStore` + `produce`，通过 `dispatch(action)` 修改                  |
| 语言   | TypeScript strict mode                                                         |
| 样式   | `src/styles/tokens.css` 设计令牌 + 组件样式；`src/utils/theme.ts` 提供 TS 镜像 |
| 路由   | `src/router.tsx` 自建 Hash Router；路由声明集中在 `src/app.tsx`                |
| 配置   | JSON 模板 + `ConfigLoader` 运行时展开 + zod 完整性校验                         |
| 持久化 | 条件写入 localStorage（仅状态实际变化时）；远程同步暂时停用                    |
| 测试   | Vitest、jsdom、Solid Testing Library、V8 coverage                              |
| 部署   | GitHub Actions → GitHub Pages                                                  |

## 实际目录

```text
src/
├── main.tsx                     # 启动时读取存档并挂载 Solid 应用
├── app.tsx                      # 根组件与当前路由声明
├── router.tsx                   # Hash Router
├── vite-env.d.ts                # Vite 环境类型（含 __APP_VERSION__）
├── components/                  # 共享 UI 与后续功能接入矩阵
├── pages/
│   ├── auth/splash.tsx          # 启动页（存档状态提示）
│   ├── character/               # 六步建档
│   ├── home/home-page.tsx       # 综合 Dashboard（日程概览 + 跳转入口）
│   ├── departments/             # 部门治理（行动安排与槽位管理）
│   ├── assessment/              # 考核详情页面
│   └── career/                  # 晋升任命（完整晋升状态机）
├── styles/                      # 全局 CSS 与设计令牌
├── types/
│   ├── player.ts                # PlayerSave、SlotOccupant 等
│   ├── game.ts                  # TimelineEvent、ActionRuntimeSnapshot 等
│   ├── save.ts                  # SaveEnvelope、Schema/内容版本常量
│   ├── actions.ts               # Reducer Payload 类型
│   ├── config.ts / enums.ts / character.ts / ui.ts
├── utils/                       # 格式化、数学、主题等工具
├── config/
│   ├── career-lines/            # 当前已接入 administrative.json
│   ├── templates/               # 部门、KPI 等复用模板
│   ├── constants.json           # 时间、槽位、晋升等常量
│   └── loader.ts                # ConfigLoader
├── engine/
│   ├── core/
│   │   ├── action.ts            # 行动校验与效果解析
│   │   ├── effect.ts            # 效果应用
│   │   ├── time.ts              # 时间推进基础
│   │   ├── timeline.ts          # 统一时间轴引擎
│   │   └── event.ts             # 事件处理
│   ├── governance/              # assessment/budget/kpi/dimensions
│   ├── career/                  # promotion/deviation-penalty/spectrum 等
│   └── index.ts                 # 引擎聚合导出
├── store/
│   ├── game-store.ts            # Store 入口、dispatch、条件持久化
│   ├── reducers/
│   │   ├── action-reducer.ts    # START_ACTION + runtimeSnapshot 绑定
│   │   ├── time-reducer.ts      # ADVANCE_TIME + 统一时间轴结算
│   │   ├── career-reducer.ts    # 晋升流程
│   │   ├── character-reducer.ts # NEW_GAME / LOAD_SAVE
│   │   └── shared.ts            # 共享辅助函数
│   └── save-codec/
│       └── index.ts             # 严格存档解码器（Zod Schema）
└── services/
    ├── save-repo.ts             # 本地/远程存档读写
    ├── startup-save-state.ts    # 启动存档状态服务
    └── supabase.ts              # 可选 Supabase client
```

## 分层与依赖

```text
UI（页面/组件） → Store（dispatch/reducer） → Engine（纯函数） → Config（JSON/loader）
                                  ↓
                         SaveRepo（持久化边界）
```

- UI 读取 store，并只通过 `dispatch(action)` 发起状态修改。
- `reduceGameState(draft, action)` 是生产 store 与 `createTestStore()` 共用的唯一 action 处理入口。
- Engine 不读取 DOM、全局 store 或持久化服务；接收数据并返回结果。
- ConfigLoader 展开模板引用；业务代码不复制 JSON 配置。
- 类型集中在 `src/types/`，避免在业务模块散落跨层模型。

## Store 架构

### game-store.ts 当前职责

- 创建 Solid Store 和 `dispatch` 函数
- 调用 `reduceGameState()` 委托给各领域 reducer
- 判断状态是否实际变化（`changed` 返回值）
- 仅在实际变化时更新 `updatedAt` 并写入 localStorage
- `LOAD_SAVE` 不触发持久化（避免启动时覆盖原存档）

### Reducer 分域

| Reducer | 处理的 Action |
| ------- | ------------- |
| `action-reducer.ts` | START_ACTION（含 runtimeSnapshot 计算） |
| `time-reducer.ts` | ADVANCE_TIME（使用统一时间轴） |
| `career-reducer.ts` | START_PROMOTION / SELECT_TARGET / RESOLVE_STAGE / RESET |
| `character-reducer.ts` | NEW_GAME / LOAD_SAVE |
| `shared.ts` | applyPlayerAttr / initializeDepartmentStates 等 |

### 测试 Store

`createTestStore()` 创建隔离 Store，其 `dispatch` 不触发 localStorage 写入。持久化集成测试使用模块级 `dispatch()`。

## 存档语义

### SaveEnvelope 字段

```typescript
interface SaveEnvelope {
  schemaVersion: number;    // 存档结构版本（当前：1）
  contentVersion: string;   // 内容配置版本（当前：2026.07.1）
  revision: number;         // 同一存档的逻辑修订号
  savedAt: number;          // 保存时间戳
  state: PlayerSave;        // 实际游戏状态
}
```

### 严格解码行为

- 只接受当前 `schemaVersion` 的完整 SaveEnvelope
- 裸旧版 PlayerSave（无 Envelope 封装）→ 拒绝（`legacy_save_unsupported`）
- `schemaVersion < CURRENT` → 拒绝
- `schemaVersion > CURRENT` → 拒绝（`future_version`）
- 结构验证失败 → 拒绝（`invalid_envelope`）
- **不支持自动迁移**
- 不兼容存档创建只读备份（最多 3 份轮转，相同内容不重复）
- 启动页按错误类别显示提示

### 兼容性说明

解码器仅校验 `schemaVersion`，不校验 `contentVersion`。因此基础工程重构期间（PR #88）生成的 `schemaVersion: 1` 存档在当前版本仍可加载。正式版本体系建立前（PR #88 之前）的裸 PlayerSave 存档因缺少 Envelope 封装而被拒绝。

### revision 和 updatedAt

- `revision`：每次写档递增，标识同一存档的修订次数
- `updatedAt`：`PlayerSave` 中的时间戳，仅在状态实际变化时由 dispatch 更新

## 时间轴语义

### 唯一绝对日坐标

以 `totalDaysPlayed`（从开局第 0 天起算）为唯一绝对日坐标。

### 时间事件类型

```typescript
type TimelineEvent =
  | ActionCompletionTimelineEvent   // 行动完成
  | MonthlySettlementTimelineEvent  // 月度结算
  | AnnualAssessmentTimelineEvent   // 年度考核
  | PoliticalCycleTimelineEvent     // 政治周期（预留）
  | RetirementCheckTimelineEvent;   // 退休检查（预留）
```

### 同日事件排序

同一天内按类型优先级：行动完成(0) < 月度结算(1) < 年度考核(2) < 政治周期(3) < 退休检查(4)。

### 跨月和跨年

月度事件的 `month` 表示刚结束的月份（不出现 month=13）。跨年时正确计算年份递增。

### 并发行动

每个行动使用自己的 `runtimeSnapshot` 中的偏离倍率，互不干扰。

## 行动运行时快照

```typescript
interface ActionRuntimeSnapshot {
  effectivenessMultiplier: number;    // 理念偏离效果倍率
  styleConflictTriggered: boolean;    // 是否触发风格冲突
  styleAlignment?: string;            // 行动的理念对齐方向
}
```

- 理念偏离倍率和冲突状态绑定到具体行动实例（`SlotOccupant.runtimeSnapshot`）
- 不再使用玩家级临时倍率
- 配置在行动执行期间变化不会影响已启动行动的快照

## 配置模型

```text
templates/departments*.json + templates/kpis.json
                    ↓ 引用
career-lines/administrative.json
                    ↓ ConfigLoader 展开
PositionConfig（部门、行动、KPI）
```

修改数值优先编辑 JSON；新增模板或引用后必须运行 `pnpm validate:config`。

## 当前遗留模型（下一阶段重构对象）

以下结构仍然存在于当前代码中，是后续职业领域模型重构的目标：

- `currentLevel`：单一等级同时表达职位高低、机关层级和晋升目标
- `currentCareerLine`：固定封闭职业线
- `politicalCapital`：万能资源
- 固定晋升状态机：玩家主动触发
- `transferCount` / `isLineLocked`：固定转职次数
- `endgameReached`：基于单一等级的终局字段

这些不是当前已完成的新能力，而是待重构的旧结构。

## 扩展约束

1. 新 Engine 函数保持纯函数并添加同级 `__tests__/*.test.ts`。
2. 新 action 先扩展 `GameAction`，再只在 `reduceGameState` 增加分支，并用 `createTestStore()` 测试。
3. Engine 文件超过 200 行时按职责拆分，并在 `src/engine/index.ts` 注册导出。
4. 未实现功能使用 `// Phase N 实现` 标记。
5. 所有导出函数补充包含 `@param` 和 `@returns` 的 JSDoc。

## 质量与性能目标

提交前运行 `pnpm run ci`。覆盖率门槛为 Engine 90%、Config 80%、Store 70%。
