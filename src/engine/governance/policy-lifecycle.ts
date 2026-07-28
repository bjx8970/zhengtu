/**
 * 政策生命周期公共入口
 *
 * 以稳定的导出面组合各个小型纯转换模块，供 Store 和测试调用。
 */

export { createPolicySnapshot } from './policy-lifecycle-shared';
export type { PolicyTransitionFailure, PolicyTransitionResult } from './policy-lifecycle-shared';
export { proposePolicy } from './policy-proposal';
export type { ProposePolicyParams } from './policy-proposal';
export { approvePolicy } from './policy-approval';
export type { ApprovePolicyParams } from './policy-approval';
export { activatePolicy } from './policy-activation';
export type { ActivatePolicyParams } from './policy-activation';
export { suspendPolicy, resumePolicy } from './policy-suspension';
export type { SuspendPolicyParams, ResumePolicyParams } from './policy-suspension';
export { advancePolicyPhase } from './policy-phase-advance';
export type { AdvancePolicyPhaseParams } from './policy-phase-advance';
export { failPolicy, completePolicy, repealPolicy } from './policy-terminal';
export type { FailPolicyParams, CompletePolicyParams, RepealPolicyParams } from './policy-terminal';
