/**
 * 应用入口
 *
 * 挂载 SolidJS App 到 #root DOM 节点。
 * 注意：SolidJS render() 追加内容而非替换，必须先清空容器
 * 否则 index.html 中的 loading 占位会与 App 叠加显示。
 *
 * 启动流程：localStorage 有存档 → LOAD_SAVE → 启动页可继续游戏
 *          localStorage 无存档 → 启动页 → 建档
 */

import { render } from 'solid-js/web';
import { App } from './app';
import { dispatch } from './store/game-store';
import { readLocalSave } from './services/save-repo';

const root = document.getElementById('root');
if (root) {
  // 从 localStorage 恢复上次会话（LOAD_SAVE 不触发写回，不会产生循环）
  const saved = readLocalSave();
  if (saved) {
    dispatch({ type: 'LOAD_SAVE', save: saved });
  }

  root.innerHTML = '';
  render(() => <App />, root);
}
