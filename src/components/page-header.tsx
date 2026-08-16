/**
 * 公文式页面标题
 *
 * 页面顶部统一标题区：眉题（eyebrow）+ 大标题（宋体）+ 文号式说明行。
 * 所有工作台页面共享，替代旧式返回按钮顶栏。
 */

/**
 * 公文式页面标题组件。
 *
 * @param props.title    页面大标题
 * @param props.eyebrow  眉题（英文/编号式短行，可选）
 * @param props.meta     标题右侧说明（日期、编号等，可选）
 * @param props.desc     标题下方说明文字（可选）
 * @returns 页面标题区 JSX
 */
export function PageHeader(props: {
  title: string;
  eyebrow?: string;
  meta?: string;
  desc?: string;
}) {
  return (
    <header class="doc-heading">
      <div class="doc-heading-main">
        {props.eyebrow && <div class="doc-eyebrow">{props.eyebrow}</div>}
        <h1 class="doc-title">{props.title}</h1>
        {props.desc && <p class="doc-meta">{props.desc}</p>}
      </div>
      {props.meta && <div class="doc-meta">{props.meta}</div>}
    </header>
  );
}
