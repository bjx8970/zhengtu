/**
 * 建档系统类型定义
 *
 * 与 character-creation.tsx 解耦，遵循"类型集中在 src/types/" 规范。
 */

import type { CareerLine } from './enums';

/** 建档向导收集的角色数据 */
export interface CharacterData {
  characterName: string;
  gender: '男' | '女';
  province: string;
  city: string;
  gaokaoScore: number;
  gaokaoTier: string;
  university: string;
  universityTier: string;
  familyBackground: string;
  promotionPath: string;
  isPreparatory: boolean;
  careerLine: CareerLine;
}
