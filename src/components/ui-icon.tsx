/** 工作台线性图标：本地 SVG，无外部字体或图片依赖。 */
import { For } from 'solid-js';
import type { UiIconName } from '../types/ui';

const PATHS: Record<UiIconName, string[]> = {
  home: ['M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z'],
  tasks: ['M9 5H5v16h14V5h-4', 'M9 3h6v4H9z M8 12l2 2 5-5 M8 18h8'],
  departments: ['M4 21V7l8-4 8 4v14 M2 21h20 M8 10h1 M15 10h1 M8 14h1 M15 14h1 M10 21v-4h4v4'],
  assessment: ['M4 3v18h17 M8 16v-5 M13 16V7 M18 16V4'],
  career: ['M3 8h18v12H3z M8 8V4h8v4 M3 12l9 4 9-4 M12 13v4'],
  policies: ['M6 3h9l4 4v14H6z M14 3v5h5 M9 12h7 M9 16h7'],
  events: ['M5 17h14l-2-3V9a5 5 0 0 0-10 0v5z M10 21h4 M12 2v2'],
  moon: ['M20 15A8 8 0 0 1 9 4a8 8 0 1 0 11 11Z'],
  sun: [
    'M12 3V1 M12 23v-2 M3 12H1 M23 12h-2 M4 4l2 2 M18 18l2 2 M4 20l2-2 M18 6l2-2',
    'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  ],
  arrow: ['M4 12h16 M14 6l6 6-6 6'],
  clock: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 7v5l3 2'],
  wallet: ['M3 7h17v14H3z M3 7V4h14v3 M20 12h-6v5h6 M16 14.5h1'],
  plus: ['M12 5v14 M5 12h14'],
  logout: ['M9 4H4v16h5 M10 12h11 M17 8l4 4-4 4'],
};

/**
 * 渲染装饰图标；可访问名称由所在按钮或链接提供。
 * @param props 图标名称和可选样式类
 * @returns 不参与辅助技术朗读的 SVG
 */
export function UiIcon(props: { name: UiIconName; class?: string }) {
  return (
    <svg
      class={`ui-icon ${props.class ?? ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <For each={PATHS[props.name]}>{(d) => <path d={d} />}</For>
    </svg>
  );
}
