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
import { LoginPage } from './pages/auth/login';
import { Dashboard } from './pages/dashboard/dashboard';
import { PositionKPI } from './pages/career/position-kpi';
import { PositionDept } from './pages/career/position-dept';
import { CharacterCreation } from './pages/character/character-creation';
import { Promotion } from './pages/career/promotion';
import { PositionSuperior } from './pages/career/position-superior';
import { PositionRelations } from './pages/career/position-relations';
import { PositionPersonal } from './pages/career/position-personal';
import { PositionArchives } from './pages/career/position-archives';

/** 全局路由表 */
const routes: Route[] = [
  { path: '/', component: SplashPage },
  { path: '/login', component: LoginPage },
  { path: '/character', component: CharacterCreation },
  { path: '/dashboard', component: Dashboard },
  { path: '/kpi', component: PositionKPI },
  { path: '/dept/:deptIndex', component: PositionDept },
  { path: '/promotion', component: Promotion },
  { path: '/superior', component: PositionSuperior },
  { path: '/relations', component: PositionRelations },
  { path: '/personal', component: PositionPersonal },
  { path: '/archives', component: PositionArchives },
];

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
