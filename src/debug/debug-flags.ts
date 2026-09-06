/**
 * Debug Trace 编译期开关
 *
 * 该值为 vite.config.ts define 注入的编译期常量（__ZHENGTU_DEBUG_TRACE__）。
 * 设为 false 构建时，本模块与全部 debug/* 代码可被 dead-code elimination 移除；
 * 正式游戏状态与存档 schema 永远不依赖本开关。
 */

/** Debug Trace 是否参与本次构建。 */
export const DEBUG_TRACE_ENABLED = __ZHENGTU_DEBUG_TRACE__;
