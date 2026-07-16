/**
 * 建档系统类型定义
 *
 * 与 character-creation.tsx 解耦，遵循"类型集中在 src/types/" 规范。
 */

/** 建档向导收集的角色数据 */
export interface CharacterData {
  characterName: string;
  gender: '男' | '女';
  birthPlace: string;
  education: '高中' | '大专' | '本科' | '硕士' | '博士';
  motivation: '为民服务' | '个人抱负' | '家族期望';
  personality: '廉洁型' | '务实型' | '改革型' | '稳健型';
}

/** 建档向导的单个步骤定义 */
export interface StepDef {
  title: string;
  field: keyof CharacterData;
  type: 'input' | 'options';
  options?: string[];
}
