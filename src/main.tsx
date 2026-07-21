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
import { readLocalSave } from './services/save-repo';
import { setStartupSaveResult } from './services/startup-save-state';

const root = document.getElementById('root');
if (root) {
  // 启动时读取一次，结果存入独立服务
  const saveResult = readLocalSave();
  setStartupSaveResult(saveResult);
  if (saveResult.status === 'loaded') {
    dispatch({ type: 'LOAD_SAVE', save: saveResult.state });
  }

  root.innerHTML = '';
  render(() => <App />, root);
}
