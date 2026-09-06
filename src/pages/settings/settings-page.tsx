/**
 * 设置页
 *
 * 常驻可见的系统设置入口（移动端优先）：
 * - 版本信息：应用版本、构建提交、存档结构/内容版本、当前存档标识；
 * - 调试：Debug Trace 轨迹状态、「导出 Debug Bundle」「清除 Debug Trace」。
 *
 * Debug 区块仅在编译期开关开启时渲染（默认开启；生产可用
 * VITE_ENABLE_DEBUG_TRACE=false 彻底移除）。
 */

import { createSignal, Show } from 'solid-js';
import { unwrap } from 'solid-js/store';
import { PageHeader } from '../../components/page-header';
import { useGameStore } from '../../store/game-store';
import { getTraceStatusSignal, clearDebugTrace } from '../../debug/debug-recorder';
import { downloadDebugBundle } from '../../debug/debug-exporter';
import { DEBUG_TRACE_ENABLED } from '../../debug/debug-flags';
import { CURRENT_CONTENT_VERSION, CURRENT_SCHEMA_VERSION } from '../../types/save';

/** 版本信息行 */
function VersionRow(props: { label: string; value: string }) {
  return (
    <div class="flex between center gap-sm" style={{ 'flex-wrap': 'wrap' }}>
      <span class="text-sm">{props.label}</span>
      <span class="tag tag-gray">{props.value}</span>
    </div>
  );
}

/**
 * 设置页组件。
 *
 * @returns 设置页 JSX
 */
export function SettingsPage() {
  const { state } = useGameStore();
  const traceStatus = getTraceStatusSignal();
  const [notice, setNotice] = createSignal('');
  const [busy, setBusy] = createSignal(false);

  /** 导出 Debug Bundle（手机端浏览器走标准下载流程） */
  async function handleExport() {
    setBusy(true);
    setNotice('');
    try {
      const fileName = downloadDebugBundle();
      setNotice(`已导出 ${fileName}（仅供开发诊断，不是游戏存档）`);
    } catch (error) {
      setNotice(`导出失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  /** 清除 Debug Trace（确认后同时清除内存与 IndexedDB，并以当前状态重建记录） */
  async function handleClear() {
    if (!window.confirm('确定清除当前 Debug Trace 吗？已记录的操作日志不可恢复。')) return;
    setBusy(true);
    setNotice('');
    try {
      await clearDebugTrace(unwrap(state));
      setNotice('已清除 Debug Trace，并从当前时刻重新开始记录。');
    } catch (error) {
      setNotice(`清除失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader eyebrow="设置 · SETTINGS" title="设置" desc="应用版本与系统诊断信息" />

      <Show when={notice()}>
        <p class="banner">{notice()}</p>
      </Show>

      <section class="card">
        <div class="card-title">
          <span class="card-title-mark" aria-hidden="true" />
          版本信息
        </div>
        <div class="card-pad flex-col gap-sm">
          <VersionRow label="应用版本" value={__APP_VERSION__} />
          <VersionRow label="构建提交" value={__GIT_COMMIT_SHA__ ?? '未知（本地构建未注入）'} />
          <VersionRow label={`存档结构版本（Schema）`} value={String(CURRENT_SCHEMA_VERSION)} />
          <VersionRow label="内容版本" value={CURRENT_CONTENT_VERSION} />
          <VersionRow
            label="当前存档"
            value={`${state.character.characterName || '尚未建档'} · ${
              state.character.saveId || '无标识（旧档）'
            }`}
          />
        </div>
      </section>

      <Show when={DEBUG_TRACE_ENABLED}>
        <section class="card">
          <div class="card-title">
            <span class="card-title-mark" aria-hidden="true" />
            调试
          </div>
          <div class="card-pad flex-col gap-sm">
            <Show
              when={traceStatus()}
              fallback={
                <p class="doc-meta">
                  当前未在记录操作轨迹。新建角色或重新载入存档后将自动开始记录。
                </p>
              }
            >
              {(status) => (
                <>
                  <VersionRow
                    label="记录完整性"
                    value={
                      status().completeness === 'complete' ? '完整（自建档起）' : '部分（自载入起）'
                    }
                  />
                  <VersionRow label="已记录有效操作" value={`${status().journalLength} 条`} />
                  <VersionRow label="记录起点" value={`第 ${status().startedAtDay} 日`} />
                </>
              )}
            </Show>
            <p class="doc-meta">
              Debug Bundle 记录操作日志、随机数与运行时 ID，用于开发者复现问题；
              它不是游戏存档，不会上传，仅保存在本机。
            </p>
            <div class="flex gap-sm" style={{ 'flex-wrap': 'wrap' }}>
              <button class="btn btn-primary" disabled={busy()} onClick={() => void handleExport()}>
                导出 Debug Bundle
              </button>
              <button class="btn" disabled={busy()} onClick={() => void handleClear()}>
                清除 Debug Trace
              </button>
            </div>
          </div>
        </section>
      </Show>
    </>
  );
}
