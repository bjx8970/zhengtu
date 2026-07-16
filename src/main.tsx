/**
 * 应用入口
 *
 * 挂载 SolidJS App 到 #root DOM 节点。
 * 注意：SolidJS render() 追加内容而非替换，必须先清空容器
 * 否则 index.html 中的 loading 占位会与 App 叠加显示。
 */

import { render } from 'solid-js/web';
import { App } from './app';

const root = document.getElementById('root');
if (root) {
  root.innerHTML = '';
  render(() => <App />, root);
}
