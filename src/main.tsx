/**
 * 应用入口
 *
 * 挂载 SolidJS App 到 #root DOM 节点。
 * 所有框架配置（Vite、路由、状态管理）在此之前的 import 阶段已初始化。
 */

import { render } from 'solid-js/web';
import { App } from './app';

const root = document.getElementById('root');
if (root) {
  render(() => <App />, root);
}
