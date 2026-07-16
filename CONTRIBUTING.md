# 开发指南

## 环境准备

```bash
# 1. 安装 Node.js 22+ 和 pnpm
corepack enable pnpm    # 或 npm install -g pnpm

# 2. 安装依赖
pnpm install

# 3. 启动开发服务器
pnpm dev                # http://localhost:3000
```

**Supabase 配置（可选）**：创建 `.env` 文件：

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

不配置 Supabase 时，游戏使用 localStorage 本地存储，功能不受影响。

## 开发流程

```
main ─────●──────────●──────  (保护分支，自动部署)
           ＼        ／
feat/xxx     ●──●──●           (从 main 拉出)
```

1. 从 `main` 新建分支：`git checkout -b feat/xxx`
2. 编写代码 + 测试
3. 推送 + 创建 PR
4. CI 自动检查：format → lint → typecheck → test → validate:config → build
5. 审查通过后 Squash Merge 到 main
6. main 自动部署到 GitHub Pages

### Commit 信息规范

使用 [Conventional Commits](https://www.conventionalcommits.org/zh-hans) 格式：

```
<type>(<scope>): <short summary>

type:     feat | fix | refactor | test | docs | style | chore | config
scope:    engine | store | config | pages | ci | types | deps (可选)
summary:  中文，祈使句，不加句号

示例：
  feat(engine): 实现月度预算结算逻辑
  fix(store): 修复推进时间后槽位未重置的问题
  test(engine): 补充时间引擎跨年边界用例
  refactor(config): 合并 departments 与 departments-extra
  chore(deps): 升级 vitest 到 v4
  docs: 补充 ARCHITECTURE.md 数据流图
```

### PR 提交前 Checklist

创建 PR 前确认以下事项：

- [ ] 所有自动化检查通过：运行 `pnpm ci`
- [ ] 新增/修改的引擎函数有对应测试，覆盖率不低于阈值
- [ ] 新增 JSON 配置运行过 `pnpm validate:config` 且包含引用完整性验证
- [ ] Commit 信息符合 Conventional Commits 格式
- [ ] 公开函数和接口有 JSDoc 注释（`@param`/`@returns`）
- [ ] 无遗留的调试日志（`console.log` 等）—— CI 会将 `no-console` 作为 warning
- [ ] 涉及配置修改时，在 PR 描述中注明影响的职位/部门范围

PR 被合并前，Reviewer 额外检查：

- [ ] 引擎函数为纯函数，签名符合规范
- [ ] 无引入全局状态依赖
- [ ] 测试覆盖了正常路径 + 边界情况（空值、负数、极值）

## 代码规范

### 提交前检查

```bash
pnpm format          # 格式化代码
pnpm lint            # 检查代码风格
pnpm typecheck       # TypeScript 类型检查
pnpm test            # 运行测试
pnpm validate:config # 校验配置 JSON
pnpm ci              # 一键全量检查
```

### TypeScript

- 启用 strict 模式，禁止 `any`（必要时用 `// eslint-disable-next-line` 抑制）
- 未使用变量用 `_` 前缀忽略（`argsIgnorePattern: '^_'`)
- 禁止 non-null assertion（`!`）（特殊情况下允许并加注释）
- 类型定义在 `src/types/`，禁止分散在业务代码中

### 引擎函数

- 必须是纯函数：接收参数，返回数据，不引用全局状态
- 文件命名：`kebab-case.ts`
- 单文件不超过 200 行，超过则拆分
- 函数签名显式声明入参和返回值类型
- 测试文件放在同级 `__tests__/` 目录

### 组件 (SolidJS)

- 函数组件 + JSX
- 无样式依赖（Phase 0 使用内联 style）
- 页面组件放在 `src/pages/<domain>/`，共享组件放在 `src/components/`
- 使用 `createStore` 的单 store，组件通过 `useGameStore()` 获取

### 配置数据

- 纯 JSON 文件（不写 TypeScript 工厂函数）
- 模板在 `src/config/templates/`，职业线在 `src/config/career-lines/`
- 新增模板后运行 `pnpm validate:config` 确保引用完整
- 配置运行时由 `ConfigLoader` 展开

### 注释规范

所有源代码文件必须包含注释，降低阅读和维护成本。

**文件头**：每个 `.ts` / `.tsx` 文件顶部使用 JSDoc 块描述模块职责。

```typescript
/**
 * 时间推进引擎
 *
 * 核心职责：
 * 1. 按天数推进游戏时间
 * 2. 检测周期边界并生成 TimeTrigger
 *
 * 纯函数，不引用全局状态。
 */
```

**函数**：公开导出的函数必须有 JSDoc，包含 `@param` 和 `@returns`。

```typescript
/**
 * 推进游戏时间，逐天检测周期事件。
 *
 * @param current         当前时间状态
 * @param days            推进天数
 * @param playerBirthYear 玩家出生年份
 * @returns 新时间状态 + 触发的周期事件列表
 */
export function advanceTime(current: TimeState, days: number, ...): TimeAdvanceResult
```

**接口/类型**：字段含义非自明时添加行内注释。

```typescript
export interface SlotState {
  max: number;       // 当前粒度的最大槽位数
  available: number; // 当前剩余可用槽位数
}
```

**关键逻辑**：非直观的算法、边界条件、设计决策应添加行内注释说明"为什么"。

```typescript
// 每天约消耗槽位数的 1.5 倍天数
const daysAdvanced = Math.max(1, Math.ceil(actionConfig.slotCost * 1.5));
```

**节点标记**：占位未实现的功能使用 `// Phase N 实现` 标记，方便后续定位。

```typescript
case 'EXECUTE_ACTION': {
  // Phase 2 实现：调用 actionEngine.execute() + timeEngine.advance()
  break;
}
```

**不要求注释的情况**：变量名自解释、简单的赋值/返回值、框架样板代码（如 `render(() => <App />, root)`）。



## 测试规范

### 分层

| 层 | 目录 | 框架 | 覆盖率要求 |
|----|------|------|-----------|
| Engine | `__tests__/` | Vitest | ≥ 90% lines |
| Config | `__tests__/` | Vitest | ≥ 80% lines |
| Store | `__tests__/` | Vitest | ≥ 70% lines |
| Component | `__tests__/` | @solidjs/testing-library | ≥ 40% (软目标) |

### 何时需要写测试

| 场景 | 是否必须 | 说明 |
|------|---------|------|
| 新增引擎函数 | ✅ 必须 | 覆盖率达标后 PR 才能合并 |
| 修改引擎逻辑 | ✅ 必须 | 如原测试不足，同步补充 |
| 新增 JSON 配置 | ✅ 结构测试 | `loader.test.ts` 的数据完整性遍历会自动覆盖 |
| 修改 JSON 数值 | ❌ 不需要 | 数值调整不涉及逻辑变更 |
| 新增页面组件 | 🔶 建议 | 至少 smoke test（渲染不崩溃）；复杂交互建议写 |
| 纯重构（不改行为） | ❌ 不需要 | 前提：原测试全部通过 |
| Store dispatch | ✅ 必须 | 达到 70% lines |
| 工具函数 (utils/) | ✅ 必须 | 纯函数极易测试，写 1-2 个关键用例即可 |

### 引擎测试模板

```typescript
import { describe, it, expect } from 'vitest';
import { functionUnderTest } from '../file';

describe('functionUnderTest', () => {
  describe('normal path', () => {
    it('should do X when given Y', () => {
      const result = functionUnderTest(input);
      expect(result).toEqual(expected);
    });
  });

  describe('edge cases', () => {
    it('should handle null input', () => {
      expect(() => functionUnderTest(null)).toThrow();
    });
  });
});
```

### 运行测试

```bash
pnpm test              # 运行一次
pnpm test:watch        # 监听模式
pnpm test:ui           # 可视化界面
pnpm test:coverage     # 生成覆盖率报告
```

## Quality Gates（CI 强制）

| 检查 | 阻断合并 |
|------|---------|
| Prettier format check | ✅ |
| ESLint (0 errors) | ✅ |
| TypeScript typecheck | ✅ |
| Vitest (全部通过) | ✅ |
| 覆盖率低于阈值 | ✅ |
| Config 校验 | ✅ |
| Build 成功 | ✅ |

### CI 流水线说明

提交 PR 后 GitHub Actions 自动运行（`.github/workflows/ci.yml`）：

| 步骤 | 命令 | 说明 |
|------|------|------|
| format:check | `prettier --check` | 代码格式一致性；失败时运行 `pnpm format` 自动修复 |
| lint | `eslint src/` | 代码质量和潜在错误；**0 error 才通过**，warning 不阻断 |
| typecheck | `tsc --noEmit` | TypeScript 类型检查；类型错误直接阻断 |
| test | `vitest run --coverage` | 单元/集成测试 + 覆盖率报告；测试失败或覆盖率不达标均阻断 |
| validate:config | `tsx scripts/validate-config.ts` | JSON 配置 schema 校验 + 模板引用完整性 |
| build | `vite build` | 生产构建；确保代码可打包 |

合入 main 后触发部署流水线（`.github/workflows/deploy.yml`）：typecheck → test → build → GitHub Pages 部署。

## 目录命名

| 类型 | 命名 | 示例 |
|------|------|------|
| 页面 | `kebab-case` | `position-hub.tsx` |
| 组件 | `kebab-case` | `action-button.tsx` |
| 工具 | `kebab-case` | `format-number.ts` |
| 类型 | `kebab-case` | `player.ts` |
| 测试 | `*.test.ts` | `time.test.ts` |
| 引擎 | `kebab-case.ts` | `time-engine.ts` |
| 配置 | `kebab-case.json` | `administrative.json` |
| 枚举/常量 | `kebab-case.ts` | `enums.ts` |

## 常见任务

### 新增一个职业线

1. 在 `src/config/career-lines/` 创建 JSON（引用已有模板的 id）
2. 在 `src/config/loader.ts` 注册新的 JSON import 和 LINE_CONFIGS 条目
3. 运行 `pnpm validate:config`
4. 如果新增部门类型，先在 `src/config/templates/departments-extra.json` 添加模板

### 新增一个引擎模块

1. 在对应域目录创建文件（如 `src/engine/governance/budget.ts`）
2. 编写纯函数：`export function calculateMonthlyConsumption(...): number`
3. 创建 `src/engine/governance/__tests__/budget.test.ts`
4. 在 `src/engine/index.ts` 添加导出
5. 覆盖率 ≥ 90% lines

### 新增一个页面

1. 在 `src/pages/<domain>/` 创建 `.tsx`
2. 在 `src/app.tsx` 添加路由
3. 在 `src/router.tsx` 的路由表中注册
4. 在仪表盘添加入口条件 `dashboardEntries`

### 修改配置数值

1. 编辑对应的 JSON 文件
2. 运行 `pnpm validate:config`
3. 运行 `pnpm test` 确保快照/结构测试通过
4. HMR 热更新（开发模式下）
