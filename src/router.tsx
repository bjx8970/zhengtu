/**
 * Hash Router
 *
 * 基于 location.hash 的轻量级路由器（~60 行）。
 * 选择 hash 路由的原因：
 * - GitHub Pages 部署不需要服务端 fallback
 * - 纯客户端 SPA，无需 SSR/SSG
 * - 实现简单，零依赖
 *
 * 使用方式：
 *   const { resolveRoute } = createRouter(routes)
 *   然后 resolveRoute() 返回当前匹配的 { route, params }
 */

import type { JSX } from 'solid-js';

type PageProps = Record<string, string>;

/** 路由定义 */
export interface Route {
  path: string;
  component: (props: PageProps) => JSX.Element;
  auth?: boolean;
  characterCreated?: boolean;
}

import { createSignal } from 'solid-js';

/**
 * 创建路由器实例。
 *
 * @param routes 路由表数组
 * @returns currentPath（当前 hash）和 resolveRoute（获取当前匹配的路由和参数）
 */
export function createRouter(routes: Route[]) {
  const [currentPath, setCurrentPath] = createSignal(window.location.hash.replace('#', '') || '/');

  function onHashChange() {
    setCurrentPath(window.location.hash.replace('#', '') || '/');
  }

  window.addEventListener('hashchange', onHashChange);

  /** 检查 path 是否匹配 pattern（支持 :param 占位符） */
  function matchPath(pattern: string, path: string): Record<string, string> | null {
    const patternParts = pattern.split('/');
    const pathParts = path.split('/');
    if (patternParts.length !== pathParts.length) return null;

    const params: Record<string, string> = {};
    for (let i = 0; i < patternParts.length; i++) {
      const pp = patternParts[i]!;
      const pathp = pathParts[i]!;
      if (pp.startsWith(':')) {
        params[pp.slice(1)] = pathp;
      } else if (pp !== pathp) {
        return null;
      }
    }
    return params;
  }

  /** 遍历路由表，返回第一个匹配的 route + params */
  function resolveRoute(): { route: Route; params: Record<string, string> } | null {
    const path = currentPath();
    for (const route of routes) {
      const params = matchPath(route.path, path);
      if (params !== null) return { route, params };
    }
    return null;
  }

  return { currentPath, resolveRoute };
}

/** 导航到指定路径 */
export function navigate(to: string): void {
  window.location.hash = to;
}
