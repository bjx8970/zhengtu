/**
 * 应用根组件
 *
 * 职责：
 * - 全局布局容器
 * - 注册路由表并渲染匹配的页面组件
 * - 404 兜底显示
 *
 * 新增页面时在此文件的 routes 数组和对应 imports 中注册。
 */

import type { JSX } from 'solid-js';
import { createRouter, type Route } from './router';
import { SplashPage } from './pages/auth/splash';
import { CharacterCreation } from './pages/character/character-creation';
import { HomePage } from './pages/home/home-page';
import { DepartmentsPage } from './pages/departments/departments-page';
import { AssessmentPage } from './pages/assessment/assessment-page';

/** 全局路由表 */
const routes: Route[] = [
  { path: '/', component: SplashPage },
  { path: '/character', component: CharacterCreation },
  { path: '/main', component: HomePage },
  { path: '/departments', component: DepartmentsPage },
  { path: '/assessment', component: AssessmentPage },
];

/**
 * 应用根组件。
 *
 * @returns 应用根组件 JSX
 */
export function App(): JSX.Element {
  const { resolveRoute } = createRouter(routes);

  return (
    <div style={{ height: '100%', display: 'flex', 'flex-direction': 'column' }}>
      {(() => {
        const result = resolveRoute();
        if (!result) {
          return (
            <div style={{ padding: '2rem', 'text-align': 'center' }}>
              <h2>404</h2>
              <p>页面未找到</p>
              <a href="#" onClick={() => (window.location.hash = '/')}>
                返回首页
              </a>
            </div>
          );
        }
        const Component = result.route.component;
        return <Component {...result.params} />;
      })()}
    </div>
  );
}
