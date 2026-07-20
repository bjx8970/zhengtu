/**
 * 应用入口
 *
 * 挂载 SolidJS App 到 #root DOM 节点。
 * 注意：SolidJS render() 追加内容而非替换，必须先清空容器。
 *
 * 启动流程：
 * - localStorage 有当前版本存档 → LOAD_SAVE → 启动页可继续游戏
 * - localStorage 无存档 → 启动页 → 建档
 * - localStorage 有不兼容旧档 → 启动页显示不兼容提示
 */

import { render } from 'solid-js/web';
import { App } from './app';
import { dispatch } from './store/game-store';
import { readLocalSave, type LocalSaveLoadResult } from './services/save-repo';

/** 启动时一次性读取的存档加载结果（避免组件渲染时重复读取） */
export let startupSaveResult: LocalSaveLoadResult = { status: 'empty' };

const root = document.getElementById('root');
if (root) {
  // 启动时读取一次，结果传给应用状态
  startupSaveResult = readLocalSave();
  if (startupSaveResult.status === 'loaded') {
    dispatch({ type: 'LOAD_SAVE', save: startupSaveResult.state });
  }

  root.innerHTML = '';
  render(() => <App />, root);
}
