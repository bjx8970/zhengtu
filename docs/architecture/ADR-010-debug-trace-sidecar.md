# ADR-010：旁路式可重放 Debug Bundle

## 状态

已接受（Phase 4 之后独立诊断能力，`feat/debug-trace-bundle`）。

## 背景

竞选（相对选拔）、NPC 生命周期、Vacancy 级联和事件 continuation 等链路大量
消费随机数与运行时 ID。生产端 `dispatch()` 的 `GameAction` 通常不携带
`_rng` / `_idFactory`（二者是可选的测试注入字段），reducer 一律回退到
`payload._rng ?? Math.random` 与 `payload._idFactory ?? createRuntimeIdFactory(...)`
——导致开发机上无法复现玩家遇到的随机相关缺陷：`Math.random()` 的返回序列
和 `crypto.randomUUID()` 的结果都不可能重现。

正式存档（`SaveEnvelope` + `PlayerSave`，Schema 14）只承载世界事实，不是
用户操作日志；为 debug 能力向正式存档增加历史字段，会让 Debug 数据进入
schema 兼容性契约、云存档与迁移负担，将来移除时还需要清洗全部历史存档。

## 决策

采用**旁路式（sidecar）**架构：Debug 系统观察正式执行，正式执行完全不依赖
Debug 系统。

### 录制边界

唯一侵入点是 `game-store.ts::dispatch()`：

- 动作执行前开始捕获（`debugTraceWrapAction`）；
- 对支持 `_rng` / `_idFactory` 的动作类型**总是注入**记录型包装
  （调用方已提供则包装之，未提供则包装 `Math.random` / **按动作类型解析的
  领域前缀默认 ID 工厂**）——默认工厂来自 `store/runtime-dependencies.ts`
  的穷举映射（timeline/event/policy/rank/career/task/action），reducer 回退
  与 instrumentation 共用同一解析器，保证 Debug 开启前后产生的运行时 ID
  语义完全一致，注入是纯旁路观察；这是设计中最关键的不变量；
- `changed === true` 的动作收口为一条 `DebugActionRecord`（seq、序列化动作、
  前后游戏日、randomDraws、generatedIds、前后状态哈希）；未变化的动作丢弃捕获；
- `NEW_GAME` 重置轨迹为 `complete`（建档时生成 `saveId` 作为轨迹关联键）；
- `LOAD_SAVE` 以 `partial` 建立候选会话，异步按「saveId 主键 → 末状态哈希」
  认领 IndexedDB 中的既有轨迹。**认领必须通过末状态连续性校验**
  （`stored.lastStateHash === 载入快照哈希`）才继承完整历史；同 saveId 但
  哈希不一致（载入更旧/回滚备份）时，换用全新 `branch-` 键记录独立分支，
  绝不覆盖或拼接原历史——否则 journal 会出现时间倒流，重放必然伪分歧；
- 认领未决期间 commit 仅入内存（不写 IndexedDB）；认领落定后**三种结果
  （继承 / 主键无历史 / 新分支）统一走同一条 flush 路径**：窗口期记录按最终
  traceKey 与最终 seq 原子补写，meta 尾哈希取最终 journal 末条的
  afterStateHash（无窗口记录才用载入哈希）——否则刷新后会因 meta 落后或
  记录丢失而误判、丢数据。

### 状态哈希

`cyrb53`（同步、零依赖）作用于排除 `updatedAt` 墙钟字段的 JSON 序列化。
录制与重放走完全相同的 reducer 序列，键序一致，因此同 initialState +
同动作序列必然得到同哈希。跨设备直接比对哈希不在保证范围内。

### 持久化与导出

- IndexedDB `zhengtu-debug`：`traces`（元数据 + 初始状态快照）与 `journal`
  （append-only），与 `zhengtu_autosave` 完全隔离；全部失败仅 `console.warn`；
- journal 追加与 meta 更新合并为**单个跨 store 读写事务**（`commitTraceBatch`），
  原子生效——避免浏览器在两次独立事务之间退出时留下「meta 尾哈希已前进但
  journal 缺尾记录」的组合（认领连续性判断依赖二者一致）；
- 导出 Bundle（`zhengtu-debug-<saveId>-<日期>.json`）包含：initialState、
  currentState、journal、录制环境配置快照（ConfigLoader 全量防御性副本）、
  版本元数据（appVersion / commitSha / saveSchemaVersion / contentVersion /
  debugSchemaVersion / traceCompleteness）与完整性信息。
- **Bundle 不是游戏存档**：普通导入存档流程不得接受该文件。

### 重放

`replayBundle` 从 initialState 逐条重放：按录制顺序回放随机数与 ID
（超量消费抛错并记为 `replay_threw`，欠量消费记为 under-consumed），每步比对
前后哈希，终态与 currentState 快照比对。首个分歧直接给出「首次产生状态分歧
的操作序号」。

### UI 与开关

- 设置页（`/settings`，导航可见，移动端可用）承载版本信息与调试区块：
  轨迹状态、导出、清除（确认后清除并以当前状态重建记录）。
- 编译期开关 `__ZHENGTU_DEBUG_TRACE__`（`VITE_ENABLE_DEBUG_TRACE`，dev 与
  生产构建默认开启——移动端正式部署版需要导出能力；设为 `false` 验证彻底
  移除）。`__GIT_COMMIT_SHA__` 随构建注入用于诊断溯源。

## 替代方案

- **把操作历史塞进 PlayerSave**：污染正式 schema、云存档膨胀、删除需迁移
  全部历史档——否决。
- **仅在测试环境注入 `_rng`/`_idFactory`**（现状）：生产随机性不可捕获，
  无法复现玩家缺陷——否决。
- **按 action 存全量状态快照**：长会话体积爆炸；哈希 + 首末快照即可定位
  分歧——否决。

## 后果

- 正式 `PlayerSave` / `SaveEnvelope` 零改动：无 schema 升级、无迁移、
  云存档不受影响。
- 开启时每个有效动作同步哈希两次状态（cyrb53，毫秒级），移动端可接受。
- 重放在当前运行环境配置上进行；配置与录制环境不一致导致的分歧本身即为
  诊断信息（`metadata.contentVersion` 标明录制环境）。
- 完整移除清单：删除 `src/debug/**`、设置页调试区块、`game-store.ts`
  dispatch 周边约 12 行接线、vite/vitest define 与 env 声明、本 ADR。
  不需要升级 Save Schema、写迁移或清洗任何存档。
