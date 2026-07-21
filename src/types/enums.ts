/**
 * 游戏全局枚举定义
 *
 * 所有枚举使用英文作为内部 key（用于 JSON 序列化、数据库存储），
 * 值可以是中文（用于 UI 显示）或英文（用于内部标识）。
 * 枚举值的选择原则：需要反向查找（根据显示文本找 key）的值用中文，
 * 纯内部标识用英文。
 */

/** 四条职业路线 */
export enum CareerLine {
  Administrative = 'admin',
  Party = 'party',
  Discipline = 'discipline',
  Mass = 'mass',
}

/** 11 级职务级别标签（按现实公务员级别体系） */
export enum LevelLabel {
  L1 = '科员',
  L2 = '副科',
  L3 = '正科',
  L4 = '副处',
  L5 = '正处',
  L6 = '副厅',
  L7 = '正厅',
  L8 = '副省',
  L9 = '正省',
  L10 = '副部',
  L11 = '正部',
}

/** 年度考核等次（分别对应 >=90, >=75, >=60, <60） */
export enum KPITier {
  Excellent = '优秀',
  Competent = '称职',
  Basic = '基本称职',
  Incompetent = '不称职',
}

/** 晋升六阶段状态机状态 */
export enum PromotionStage {
  Idle = 'idle',
  /** 等待玩家选择目标职位 */
  TargetSelection = 'target_selection',
  DemocraticVote = 'democratic_vote',
  OrgInspection = 'org_inspection',
  JointReview = 'joint_review',
  CommitteeVote = 'committee_vote',
  PublicNotice = 'public_notice',
  Appointment = 'appointment',
  Probation = 'probation',
  Completed = 'completed',
  Failed = 'failed',
}

/** 组织考察结论 */
export enum OrgInspectResult {
  Excellent = '优秀',
  Qualified = '合格',
  Suspended = '暂缓使用',
  Rejected = '不宜提拔',
}

/** 秘书处文件类型 */
export enum FileType {
  Request = '请示',
  Report = '报告',
  Proposal = '方案',
  Suggestion = '建议',
}

/** 文件所属分类（决定对哪些 KPI 维度生效） */
export enum FileCategory {
  Economy = '经济类',
  Livelihood = '民生类',
  Ecology = '生态类',
  PartyBuilding = '党建类',
  Safety = '安全类',
}

/** 文件批示可选操作 */
export enum FileAction {
  Approve = '批准',
  Revise = '修改',
  Reject = '驳回',
  Shelve = '搁置',
}

/** 舆情性质 */
export enum SentimentType {
  Negative = '负面',
  Neutral = '中性',
  Positive = '正面',
}

/** 三种从政理念风格（内部标识用英文，显示用中文） */
export enum LeadershipStyle {
  Innovation = 'innovation',
  Pragmatic = 'pragmatic',
  Principled = 'principled',
}

/** 秘书等级（按经验值递增） */
export enum SecretaryLevel {
  Junior = '初级',
  Assistant = '助理',
  Director = '主任',
  Senior = '资深',
  Chief = '首席',
}

/** 后备干部梯队 */
export enum ReserveCadreTier {
  None = 0,
  /** 近期提拔 */
  First = 1,
  /** 中期储备 */
  Second = 2,
  /** 长期储备 */
  Third = 3,
}

/** 双规审查中可收集的证据类型 */
export enum InvestigationEvidence {
  Bribery = '受贿证据',
  AssetAnomaly = '财产申报异常',
  ApprovalViolation = '违规审批记录',
  CommunicationLog = '通讯记录',
  WitnessTestimony = '证人证词',
  LifestyleClue = '生活作风问题线索',
}

/** 时间推进粒度：玩家可选择按天/按周/按月推进 */
export type TimeGranularity = 'day' | 'week' | 'month';
