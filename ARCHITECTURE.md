# 政途人生 v3.0 — 架构文档

## 当前范围

当前版本是可运行的单机重写原型，已实现角色创建、行政线 L1–L3、部门行动、时间推进、KPI 与晋升流程。关系、秘书、个人生活、调查和档案等入口仅作为后续接入标识展示，不应跳转到占位页面。

## 技术栈

| 层     | 技术                                                                           |
| ------ | ------------------------------------------------------------------------------ |
| UI     | SolidJS 1.9、Vite 6、`vite-plugin-solid`                                       |
| 状态   | Solid `createStore` + `produce`，通过 `dispatch(action)` 修改                  |
| 语言   | TypeScript strict mode                                                         |
| 样式   | `src/styles/tokens.css` 设计令牌 + 组件样式；`src/utils/theme.ts` 提供 TS 镜像 |
| 路由   | `src/router.tsx` 自建 Hash Router；路由声明集中在 `src/app.tsx`                |
| 配置   | JSON 模板 + `ConfigLoader` 运行时展开 + zod 完整性校验                         |
| 持久化 | 每次 action 写 localStorage；远程同步暂时停用                                  |
| 测试   | Vitest、jsdom、Solid Testing Library、V8 coverage                              |
| 部署   | GitHub Actions → GitHub Pages                                                  |

## 实际目录

```text
src/
├── main.tsx                 # 清空挂载点并启动 Solid 应用
├── app.tsx                  # 根组件与当前路由声明
├── router.tsx               # Hash Router
├── components/              # 共享 UI 与后续功能接入矩阵
├── pages/                   # loading/character/dashboard；login 暂不注册
├── styles/                  # 全局 CSS 与设计令牌
├── types/                   # config/game/player/ui/enums 类型
├── utils/                   # 格式化、数学、主题等工具
├── config/
│   ├── career-lines/        # 当前已接入 administrative.json
│   ├── templates/           # 部门、KPI 等复用模板
│   ├── constants.json       # 时间、槽位、晋升等常量
│   └── loader.ts            # ConfigLoader
├── engine/
│   ├── core/                # action/effect/time 纯函数
│   ├── governance/          # assessment/budget/kpi 纯函数
│   ├── career/              # promotion/faction-penalty 纯函数
│   └── index.ts             # 引擎聚合导出
├── store/game-store.ts      # 唯一运行时状态与 reducer
└── services/
    ├── supabase.ts          # 可选 Supabase client
    └── save-repo.ts         # 本地/远程存档与仲裁
```

未出现在上述目录中的领域模块尚未实现。后续模块应按阶段新增，不能先以空路由伪装为可用功能。

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

## 核心数据流

### 启动行动

```text
Dashboard START_ACTION
  → reducer 查找部门与行动配置
  → startAction() 校验分类、选定槽位、预算、重复行动与冷却
  → 写入选定等级的第一个空槽，扣减预算
  → 备用槽额外应用配置化健康与消沉处罚
  → writeLocalSave(unwrap(state))
```

行动具有 `durationDays`、`category` 和 `cooldownDays`。槽位固定为：

| 等级      | 数量 | 用途                               |
| --------- | ---: | ---------------------------------- |
| primary   |    3 | 核心工作，唯一可执行重大行动       |
| secondary |    2 | 次要事项                           |
| reserve   |    1 | 加班备用；使用时附加健康与士气惩罚 |

| 分类 | 可用槽位 | 冷却 | 同部门同行动并行 |
| ---- | -------- | ---- | ---------------- |
| 重大 | 仅主要   | 14 天 | 禁止             |
| 次要 | 全部     | 7 天  | 禁止             |
| 日常 | 全部     | 无    | 允许             |

冷却按部门实例记录绝对截止日，从名义完成日 `startedAtDay + durationDays` 起算。Engine 使用 `StartActionInput` 对象参数且不修改输入。

### 推进时间

```text
Dashboard ADVANCE_TIME
  → advanceTime() 计算新日期与周期触发器
  → completeActions() 收集到期行动
  → 应用行动效果、月度预算与年度考核
  → 推进晋升阶段并更新通知
  → writeLocalSave()
```

槽位不会因“推进一次”整体重置；每个 occupant 到达 `completesAtDay` 后才释放。引擎返回结果，store reducer 负责把结果写回 draft。

### 晋升流程

当前阶段依次为：门槛校验 → 民主推荐 → 组织考察 → 多部门联审 → 常委会票决 → 任前公示 → 正式任命 → 试用期。民主推荐和组织考察允许玩家选择策略，其余阶段按配置和引擎规则自动结算。

## 配置模型

```text
templates/departments*.json + templates/kpis.json
                    ↓ 引用
career-lines/administrative.json
                    ↓ ConfigLoader 展开
PositionConfig（部门、行动、KPI）
```

修改数值优先编辑 JSON；新增模板或引用后必须运行 `pnpm validate:config`。当前可玩配置是行政线 L1–L3，共 10 个职位；其他职业线属于后续阶段。

## 持久化语义

- 每次 `dispatch` 完成后立即把最新快照写入 localStorage，降低刷新或离线时的数据损失。
- 启动时读取本地存档；有效存档在首页展示摘要并可继续游戏。
- 登录路由和运行时 Supabase 同步暂时停用，当前流程不依赖用户身份或网络。
- `fetchRemoteSave()`、`upsertSave()` 和 `selectNewer()` 仅作为后续云存档接入点保留。

## 扩展约束

1. 新 Engine 函数保持纯函数并添加同级 `__tests__/*.test.ts`。
2. 新 action 先扩展 `GameAction`，再只在 `reduceGameState` 增加分支，并用 `createTestStore()` 测试。
3. Engine 文件超过 200 行时按职责拆分，并在 `src/engine/index.ts` 注册导出。
4. 未实现功能使用 `// Phase N 实现` 标记或 `FeatureRoadmap` 的 `planned` 状态。
5. 所有导出函数补充包含 `@param` 和 `@returns` 的 JSDoc。

## 质量与性能目标

提交前运行 `pnpm run ci`，顺序为 format、lint、typecheck、coverage test、config validation、build。覆盖率门槛为 Engine 90%、Config 80%、Store 70%。生产构建继续以首屏 JS 小于 200 KB gzip、交互响应小于 100 ms 为目标。
