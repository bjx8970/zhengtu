# Phase 3 验收矩阵

> 基线：`0.3.0-alpha.1` / Schema 10 / 内容版本 `2026.08.7`

本矩阵把 Issue #125 的产品验收项绑定到可重复执行的自动化证据。浏览器完整路径只读取 localStorage 做断言，不写入时间、考核、机会、事件、政策或职业状态；四年 Store 场景也只调用公开 `dispatch()`。

| 验收项 | 自动化证据 | 结论 |
| --- | --- | --- |
| 建档→个人任务→转正→两次职级→副职→治理→正职 | `tests/e2e/phase3-natural-career.spec.ts` 自然 UI 路径；`src/store/__tests__/phase3-reachability.test.ts` 四年 dispatch 场景 | 两条路径均到达 `admin_l3_0` |
| 职级与任职双通道独立 | 自然 UI 路径断言两次 `rank-change-feedback` 与两次 `appointment-change-feedback`；Store 场景核对任职实例/职级分别不变 | 通过 |
| 试用期延期/失败且状态一致 | `probation-timeline.test.ts`：`stops a large advance on final failure and persists a coherent career terminal` | 通过 |
| 职级资格不足被拒绝 | 自然 UI 初始阶段不显示办理按钮并展示试用限制；`civil-service-rank-eligibility.test.ts` 枚举服务日、考核、职数与限制 | 通过 |
| 选拔落选后可继续 | `career-opportunity-reducer.test.ts` 归档失败流程；`township-chief-path.test.ts` 失败分支后仍可启动治理行动 | 通过 |
| 机会过期不可重复接受 | `township-chief-path.test.ts`：`expires an unaccepted window and blocks acceptance/final appointment during running work` | 通过 |
| 在途工作阻止任职且无部分提交 | `career-opportunity-reducer.test.ts`：`blocks acceptance and final appointment while personal work is running` | 通过 |
| blocking 刷新恢复、同日 continuation 不重复 | 自然 UI 在产业园危机弹窗刷新；`event-timeline.test.ts` 覆盖同日恢复、顺序与去重 | 通过 |
| 试用中、任务中、职级后、选拔中、blocking、副职后刷新 | 自然 UI 路径逐点 `reload()` 并继续至镇长；已有专项 Playwright 覆盖任务快照与阻塞事件 | 通过 |
| 大步推进命中试用到期与稳定同日顺序 | `probation-timeline.test.ts` 大步跨期；`event-timeline.test.ts` 行动→政策→事件→月结→考核顺序 | 通过 |
| producer、经济和里程碑漂移自动失败 | `phase3-acceptance.test.ts`、`phase3-reachability.test.ts` 与 `pnpm validate:config` | 通过 |
| 桌面与移动端可操作、正式页面无 console error | Playwright 桌面完整路径收集 console/page error；390×844 移动端建档→任务→推进→职业页 | 通过 |

发布门禁：`pnpm run ci`、`pnpm test:e2e`、GitHub Actions 全绿，并经人工审查批准后方可合并。
