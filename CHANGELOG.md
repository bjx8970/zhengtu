# Changelog

本文件记录政途人生的用户可见变化、重要开发者契约变化和兼容性变化。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/)，版本号遵循语义化版本。

## [Unreleased]

## [0.1.0-alpha.1] - 2026-07-21

首个纳入正式版本管理的构建。不支持无 SaveEnvelope 封装的裸 PlayerSave 存档；基础工程重构期间（PR #88）生成的完整 Schema 1 Envelope 继续兼容。

### Added

- 严格存档解码器（Zod `.strict()` 全层级 + 跨字段一致性校验）
- `SaveEnvelope` 存档封装（schemaVersion + contentVersion + revision + savedAt）
- 不兼容或损坏存档的安全备份机制（最多 3 份轮转）
- 启动页分类显示存档错误提示（旧版/未来版本/损坏）
- 统一时间轴引擎 `advanceTimeline()`（行动完成 → 月度结算 → 年度考核严格按时间顺序）
- 行动实例级运行时快照 `runtimeSnapshot`（理念偏离倍率绑定到具体行动）
- Store Reducer 分域拆分（action / time / career / character / shared）
- 条件持久化（仅实际状态变化时写档，LOAD_SAVE 不触发持久化）
- 启动存档状态服务（解除循环依赖）
- 构建时版本注入（`__APP_VERSION__` 来自 package.json）
- 版本管理规范文档 `docs/VERSIONING.md`
- 职业与治理改版指导文档 `docs/CAREER_REDESIGN_GUIDE.md`

### Changed

- `game-store.ts` 从 1064 行精简到约 290 行，领域逻辑委托给 reducers/
- 时间推进使用统一绝对日坐标（`totalDaysPlayed`），修复跨年 13 月事件
- 存档加载改为严格解码，不再内联迁移
- 启动页从 Store 派生可继续状态
- 内容版本格式改为 `YYYY.MM.REVISION`

### Fixed

- 修复时间推进中月度/年度结算先于行动完成的顺序错误
- 修复并发行动共享玩家级临时偏离倍率的问题
- 修复跨年时产生 month=13 的月度事件

### Removed

- 删除玩家级临时字段 `_pendingDeviationMultiplier` 和 `pendingStyleConflict`
- 删除旧存档自动迁移代码（本版本不支持裸 PlayerSave 及非当前 Schema 的存档）

### Save compatibility

- **当前 Schema 版本：1**
- **当前内容版本：2026.07.1**
- 正式版本体系建立前的裸 PlayerSave 存档（无 SaveEnvelope 封装）**不受支持**
- 基础工程重构期间（PR #88）生成的 `schemaVersion: 1` 存档仍可加载（解码器仅校验 schemaVersion）
- 不兼容存档不会被静默覆盖，会保留只读备份并在启动页显示提示
- 未来版本存档（schemaVersion > 当前）会被拒绝
- 后续 Schema 变化将通过单独迁移处理，迁移失败时保留原始备份
