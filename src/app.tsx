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
import { TasksPage } from './pages/tasks/tasks-page';
import { DepartmentsPage } from './pages/departments/departments-page';
import { AssessmentPage } from './pages/assessment/assessment-page';
import { CareerPage } from './pages/career/career-page';
import { PoliciesPage } from './pages/policies/policies-page';
import { EventsPage } from './pages/events/events-page';
import { BlockingEventModal } from './components/blocking-event-modal';
import { AppShell } from './components/app-shell';

/** 全局路由表（shell 页面统一渲染在机关工作台外壳内） */
const routes: Route[] = [
  { path: '/', component: SplashPage },
  { path: '/character', component: CharacterCreation },
  { path: '/main', component: HomePage, shell: true },
  { path: '/tasks', component: TasksPage, shell: true },
  { path: '/departments', component: DepartmentsPage, shell: true },
  { path: '/assessment', component: AssessmentPage, shell: true },
  { path: '/career', component: CareerPage, shell: true },
  { path: '/policies', component: PoliciesPage, shell: true },
  { path: '/events', component: EventsPage, shell: true },
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
            <div class="doc-scroll">
              <div class="doc-page" style={{ display: 'grid', 'place-items': 'center' }}>
                <div class="card card-pad" style={{ 'text-align': 'center' }}>
                  <h2 class="doc-title">404</h2>
                  <p class="doc-meta" style={{ margin: '0.5rem 0 1rem' }}>
                    页面未找到
                  </p>
                  <a class="btn btn-primary" href="#/">
                    返回首页
                  </a>
                </div>
              </div>
            </div>
          );
        }
        const Component = result.route.component;
        const page = <Component {...result.params} />;
        return result.route.shell ? <AppShell>{page}</AppShell> : page;
      })()}
      <BlockingEventModal />
    </div>
  );
}
