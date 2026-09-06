/**
 * Debug Bundle 导出器
 *
 * 把录制会话组装为自包含的可重放诊断包（zhengtu-debug-*.json）：
 * 初始状态 + 操作日志 + 当前状态 + 配置快照 + 完整性信息。
 *
 * Bundle 不是游戏存档：普通「导入存档」流程不得接受该文件，
 * 它只由 debug-replay 等诊断工具消费。
 */

import { unwrap } from 'solid-js/store';
import { useGameStore } from '../store/game-store';
import { getConfigLoader } from '../config/loader';
import { CURRENT_CONTENT_VERSION, CURRENT_SCHEMA_VERSION } from '../types/save';
import {
  DEBUG_SCHEMA_VERSION,
  type DebugBundle,
  type DebugConfigSnapshot,
  type DebugMetadata,
} from './debug-types';
import { getDebugTraceSession } from './debug-recorder';
import { hashSave } from './state-hash';

/**
 * 采集录制环境实际加载的全部配置快照。
 *
 * @returns 配置快照（深拷贝，导出后与运行时会话解耦）
 */
export function buildConfigSnapshot(): DebugConfigSnapshot {
  const loader = getConfigLoader();
  return {
    contentVersion: CURRENT_CONTENT_VERSION,
    gameConfig: structuredClone(loader.getGameConfig()),
    positions: structuredClone(loader.getAllPositions()),
    institutions: structuredClone(loader.getAllInstitutions()),
    eventDefinitions: loader.getAllEventDefinitions(),
    policyDefinitions: loader.getAllPolicyDefinitions(),
    careerOpportunityDefinitions: loader.getAllCareerOpportunityDefinitions(),
    personalTaskTemplates: loader.getAllPersonalTaskTemplates(),
    cadreTemplates: loader.getCadreTemplates(),
    relativeSelectionConfig: loader.getRelativeSelectionConfig(),
    civilServiceRankDefinitions: loader.getAllCivilServiceRankDefinitions(),
    civilServiceRankProgressionRules: loader.getAllCivilServiceRankProgressionRules(),
    experienceQualificationRules: loader.getCareerExperienceQualificationRules(),
    leadershipStyleConfig: structuredClone(loader.getLeadershipStyleConfig()),
  };
}

/**
 * 组装 Debug Bundle。
 *
 * @returns 完整 Bundle（纯数据，可直接 JSON 序列化）
 * @throws 当前没有活动轨迹（未建档/未载入存档）时抛出
 */
export function buildDebugBundle(): DebugBundle {
  const session = getDebugTraceSession();
  if (!session) {
    throw new Error('当前没有可导出的 Debug 轨迹（需先建档或载入存档）');
  }
  const { state } = useGameStore();
  const currentState = structuredClone(unwrap(state));

  const lastRecord = session.journal[session.journal.length - 1];
  const finalStateHash = lastRecord ? lastRecord.afterStateHash : hashSave(session.initialState);

  const metadata: DebugMetadata = {
    appVersion: __APP_VERSION__,
    commitSha: __GIT_COMMIT_SHA__,
    saveSchemaVersion: CURRENT_SCHEMA_VERSION,
    contentVersion: CURRENT_CONTENT_VERSION,
    debugSchemaVersion: DEBUG_SCHEMA_VERSION,
    saveId: currentState.character.saveId,
    characterName: currentState.character.characterName,
    traceCompleteness: session.completeness,
    startedAtDay: session.startedAtDay,
    startedAtWallClock: session.initialState.updatedAt,
    exportedAtDay: currentState.time.totalDaysPlayed,
    exportedAtWallClock: Date.now(),
  };

  return {
    debugSchemaVersion: DEBUG_SCHEMA_VERSION,
    metadata,
    initialState: structuredClone(session.initialState),
    currentState,
    journal: [...session.journal],
    configSnapshot: buildConfigSnapshot(),
    integrity: {
      journalLength: session.journal.length,
      finalStateHash,
    },
  };
}

/**
 * 生成导出文件名（zhengtu-debug-<标识>-<日期>.json）。
 *
 * @param metadata Bundle 元信息
 * @returns 文件名（不含路径）
 */
export function debugBundleFileName(metadata: DebugMetadata): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  const tag = (metadata.saveId || metadata.characterName || 'save')
    .replace(/[^\w-]+/g, '_')
    .slice(0, 24);
  return `zhengtu-debug-${tag}-${now.getFullYear()}${month}${day}.json`;
}

/**
 * 导出 Debug Bundle 为 JSON 下载（移动端浏览器标准下载行为）。
 *
 * @returns 导出的文件名
 * @throws 当前没有活动轨迹时抛出
 */
export function downloadDebugBundle(): string {
  const bundle = buildDebugBundle();
  const fileName = debugBundleFileName(bundle.metadata);
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return fileName;
}
