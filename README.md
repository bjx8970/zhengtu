# 政途人生 v3.0

仕途模拟游戏。从科员到正部，在 4 条职业线、154 个职位、660 个部门中做出选择，书写你的从政生涯。

## 快速开始

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

可选：创建 `.env` 配置 Supabase 实现云存档（不配置则使用本地存储）：

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

## 质量检查

```bash
pnpm ci            # 一键全检：format + lint + typecheck + test + validate:config + build
pnpm dev           # 开发服务器（HMR）
pnpm build         # 生产构建
```

## 技术栈

SolidJS + TypeScript + Vite | Vitest | Supabase | GitHub Pages

## 文档

- [架构文档](ARCHITECTURE.md) — 技术决策、系统设计、数据流
- [开发指南](CONTRIBUTING.md) — 环境准备、编码规范、测试要求
- [设计文档](zhengtu-v3-design.md) — 完整产品与技术设计（3722 行）

## 游戏规模

| 维度 | 数量 |
|------|------|
| 职业线 | 4 (行政/党务/纪检/群团) |
| 级别 | 11 (科员→正部) |
| 职位 | ~154 |
| 部门 | ~660 |
| 行动 | ~2,000 |

## 行动系统

槽位制，按推进粒度分配每日可执行行动数：

| 推进粒度 | 槽位数 |
|---------|--------|
| 按天 | 3 |
| 按周 | 4 |
| 按月 | 6 |

## 许可证

[GNU AGPLv3](LICENSE)
