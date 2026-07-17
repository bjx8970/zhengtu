/**
 * 建档系统类型定义
 *
 * 与 character-creation.tsx 解耦，遵循"类型集中在 src/types/" 规范。
 */

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
}

/** 建档向导的单个步骤定义 */
export interface StepDef {
  title: string;
  field: keyof CharacterData;
  type:
    'input' | 'gender' | 'province' | 'city' | 'gaokao' | 'tier' | 'school' | 'background' | 'path';
}
