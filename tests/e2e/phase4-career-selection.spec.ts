/**
 * Phase 4 相对选拔浏览器验收。
 *
 * 每个测试先通过真实建档获得严格合法的 Schema 14 envelope，再建立完整的
 * 冻结 Selection 事实；之后只通过职业页、推进按钮和刷新验证持久化展示。
 */

import { expect, test, type Page } from '@playwright/test';

type JsonValue = boolean | number | string | null | JsonRecord | JsonValue[];

interface JsonRecord {
  [key: string]: JsonValue;
}

type SelectionScenario = 'player-appointed' | 'npc-winner' | 'no-candidates' | 'intermediate';

function asRecord(value: JsonValue | undefined, name: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`Expected ${name} to be a record`);
  return value;
}

function asRecords(value: JsonValue | undefined, name: string): JsonRecord[] {
  if (!Array.isArray(value)) throw new Error(`Expected ${name} to be an array`);
  return value.map((item, index) => asRecord(item, `${name}[${index}]`));
}

function requiredValue(record: JsonRecord, key: string): JsonValue {
  const value = record[key];
  if (value === undefined) throw new Error(`Expected ${key} in seeded record`);
  return value;
}

async function createCharacter(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Math.random = () => 0.5;
  });
  await page.goto('/');
  await page.getByRole('button', { name: /开始新游戏/ }).click();
  await page.getByTestId('character-name').fill('相对选拔验收干部');
  await page.getByTestId('character-next').click();
  await page.locator('[data-testid^="birthplace-province-"]').first().click();
  await page.locator('[data-testid^="birthplace-city-"]').first().click();
  await page.getByTestId('character-next').click();
  await page.getByTestId('generate-gaokao-score').click();
  await page.getByTestId('character-next').click();
  await page.locator('[data-testid^="university-tier-"]').first().click();
  await page
    .locator('[data-testid^="university-"]:not([data-testid^="university-tier-"])')
    .first()
    .click();
  await page.getByTestId('character-next').click();
  await page.locator('[data-testid^="family-background-"]').first().click();
  await page.locator('[data-testid^="promotion-path-"]').first().click();
  await page.getByTestId('character-next').click();
  await page.locator('[data-testid^="career-line-"]:not([disabled])').click();
  await page.getByTestId('character-complete').click();
  await expect(page).toHaveURL(/#\/main$/);
}

async function saveEnvelope(page: Page): Promise<JsonRecord> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('zhengtu_autosave');
    if (!raw) throw new Error('Expected a local save');
    return JSON.parse(raw) as JsonRecord;
  });
}

function candidate(id: string, type: 'player' | 'npc', score: number): JsonRecord {
  return {
    candidateId: id,
    candidateType: type,
    currentPositionId: null,
    institutionId: null,
    regionId: null,
    leadershipRank: 'none',
    civilServiceRank: 'clerk_2',
    appointmentStartedAtDay: null,
    serviceStartedAtDay: 0,
    assessments: [],
    specialties: {},
    restrictionTypes: [],
    scoringInputs: { assessment: score },
  };
}

function stageResult(
  stage: string,
  values: JsonRecord[],
  survivors: string[],
  resolvedAtDay = 10,
): JsonRecord {
  return {
    stage,
    resolvedAtDay,
    candidates: values,
    survivingCandidateIds: survivors,
  };
}

function processStage(
  stage: string,
  values: JsonRecord[],
  survivors: string[],
  resolvedAtDay = 10,
): JsonRecord {
  const player = values.find((value) => value.candidateId === 'player');
  return {
    stage,
    resolvedAtDay,
    outcome: player && player.eliminated === false ? 'passed' : 'failed',
    score: typeof player?.score === 'number' ? player.score : null,
    detail: '冻结阶段审计',
    candidateResults: values,
    survivingCandidateIds: survivors,
  };
}

async function seedSelection(page: Page, scenario: SelectionScenario): Promise<void> {
  await createCharacter(page);
  const envelope = await saveEnvelope(page);
  const state = asRecord(envelope.state, 'state');
  const career = asRecord(state.career, 'career');
  const organization = asRecord(state.organization, 'organization');
  const vacancies = asRecords(organization.vacancies, 'vacancies');
  const vacancy = vacancies.find((item) => item.status === 'open');
  if (!vacancy) throw new Error('Expected an initial open Vacancy');
  const vacancyId = vacancy.vacancyId;
  if (typeof vacancyId !== 'string') throw new Error('Expected Vacancy ID');

  const cadres = asRecords(organization.cadres, 'cadres');
  const npc = cadres[0];
  if (!npc || typeof npc.cadreId !== 'string') throw new Error('Expected an NPC cadre');
  const npcId = npc.cadreId;
  const player = candidate('player', 'player', 94);
  const npcCandidate = candidate(npcId, 'npc', 78);
  const npcWins = scenario === 'npc-winner';
  const rankedCandidates = npcWins
    ? [
        { candidateId: npcId, score: 94, rank: 1, eliminated: false },
        { candidateId: 'player', score: 78, rank: 2, eliminated: false },
      ]
    : [
        { candidateId: 'player', score: 94, rank: 1, eliminated: false },
        { candidateId: npcId, score: 78, rank: 2, eliminated: false },
      ];
  const finalCandidates = rankedCandidates.map((candidate) => ({
    ...candidate,
    eliminated: candidate.candidateId !== (npcWins ? npcId : 'player'),
  }));
  const survivors = rankedCandidates
    .filter((candidate) => !candidate.eliminated)
    .map((candidate) => candidate.candidateId);
  const terminalSurvivors = finalCandidates
    .filter((candidate) => !candidate.eliminated)
    .map((candidate) => candidate.candidateId);
  const scenarioDay = scenario === 'intermediate' ? 0 : 10;
  const stages = [
    'eligibility_review',
    'democratic_recommendation',
    'organization_inspection',
    'collective_decision',
    'public_notice',
    'appointment',
  ];
  const firstStage = stageResult('eligibility_review', rankedCandidates, survivors, scenarioDay);
  const allStageResults = stages.map((stage, index) =>
    stageResult(
      stage,
      index === stages.length - 1 ? finalCandidates : rankedCandidates,
      index === stages.length - 1 ? terminalSurvivors : survivors,
      scenarioDay,
    ),
  );
  const processResults = stages.map((stage, index) =>
    processStage(
      stage,
      index === stages.length - 1 ? finalCandidates : rankedCandidates,
      index === stages.length - 1 ? terminalSurvivors : survivors,
      scenarioDay,
    ),
  );
  const selectionId = `e2e-selection-${scenario}`;
  const processId = `e2e-process-${scenario}`;
  const opportunityId = `e2e-opportunity-${scenario}`;
  const terminal = scenario !== 'intermediate';
  const noCandidates = scenario === 'no-candidates';
  const winnerId =
    scenario === 'npc-winner' ? npcId : scenario === 'player-appointed' ? 'player' : null;
  const candidates = noCandidates ? [] : [player, npcCandidate];
  const selectionResults = noCandidates
    ? []
    : scenario === 'intermediate'
      ? [firstStage]
      : allStageResults;
  const processStageResults = noCandidates
    ? []
    : scenario === 'intermediate'
      ? [
          processResults[0] ??
            processStage('eligibility_review', rankedCandidates, survivors, scenarioDay),
        ]
      : processResults;

  Object.assign(vacancy, {
    status: scenario === 'intermediate' ? 'selecting' : 'open',
    selectionId: scenario === 'intermediate' ? selectionId : null,
  });
  const selection: JsonRecord = {
    selectionId,
    vacancyId,
    status: noCandidates ? 'failed' : terminal ? 'completed' : 'active',
    currentStage: scenario === 'intermediate' ? 'democratic_recommendation' : 'appointment',
    startedAtDay: scenarioDay,
    completedAtDay: noCandidates || terminal ? scenarioDay : null,
    candidates,
    stageAudits: [],
    winner:
      winnerId === null
        ? null
        : winnerId === 'player'
          ? { type: 'player', id: 'player' }
          : { type: 'npc', id: winnerId },
    playerCareerProcessId: processId,
    randomDraws: Array(12).fill(0.5),
    rulesVersion: 'relative-selection-v1',
    stageResults: selectionResults,
    winnerId,
    failure: noCandidates
      ? { code: 'no_qualified_candidates', stage: null, detail: '没有符合资格的候选人' }
      : null,
  };
  const target = {
    positionId: requiredValue(vacancy, 'positionId'),
    positionName: requiredValue(vacancy, 'positionNameSnapshot'),
    institutionId: requiredValue(vacancy, 'institutionId'),
    institutionName: requiredValue(vacancy, 'institutionNameSnapshot'),
    regionId: requiredValue(vacancy, 'regionId'),
    institutionLevel: requiredValue(vacancy, 'institutionLevel'),
    positionDomain: requiredValue(vacancy, 'positionDomain'),
    leadershipRank: requiredValue(vacancy, 'leadershipRank'),
  };
  const opportunity: JsonRecord = {
    id: opportunityId,
    definitionId: 'e2e-relative-selection',
    type: 'leadership_vacancy',
    status: noCandidates || terminal ? 'resolved' : 'in_process',
    source: { sourceType: 'vacancy', sourceId: vacancyId, signalId: null, description: 'E2E' },
    vacancyId,
    sourceSignal: null,
    appearedAtDay: scenarioDay,
    expiresAtDay: null,
    acceptedAtDay: scenarioDay,
    rejectedAtDay: null,
    resolvedAtDay: noCandidates || terminal ? scenarioDay : null,
    cancelledAtDay: null,
    requiresSelection: true,
    eligibilityConditions: [],
    finalOutcome: noCandidates
      ? 'not_selected'
      : scenario === 'player-appointed'
        ? 'appointed'
        : scenario === 'npc-winner'
          ? 'not_selected'
          : null,
    reason: 'E2E 相对选拔',
    target,
    appointmentType: 'substantive',
    appointmentReason: 'promotion',
  };
  const process: JsonRecord = {
    id: processId,
    type: 'leadership_selection',
    status: noCandidates ? 'failed' : scenario === 'intermediate' ? 'active' : 'completed',
    opportunityId,
    selectionId,
    vacancyId,
    currentStage: scenario === 'intermediate' ? 'democratic_recommendation' : 'appointment',
    startedAtDay: scenarioDay,
    completedAtDay: noCandidates || terminal ? scenarioDay : null,
    stageResults: processStageResults,
    winnerId,
    failure: noCandidates
      ? { code: 'no_qualified_candidates', stage: null, detail: '没有符合资格的候选人' }
      : null,
  };
  if (scenario === 'player-appointed') {
    const seats = asRecords(organization.seats, 'seats');
    const targetSeat = seats.find((seat) => seat.seatId === vacancy.seatId);
    if (!targetSeat) throw new Error('Expected Vacancy target Seat');
    const oldPlayerSeat = seats.find((seat) => {
      const occupant = seat.occupant;
      return (
        occupant !== null &&
        typeof occupant === 'object' &&
        !Array.isArray(occupant) &&
        occupant.type === 'player'
      );
    });
    if (!oldPlayerSeat) throw new Error('Expected initialized player Seat');
    const appointmentId = `e2e-appointment-${scenario}`;
    const oldAppointment = asRecord(career.appointment, 'appointment');
    const newAppointment = {
      ...oldAppointment,
      appointmentId,
      positionId: target.positionId,
      institutionId: target.institutionId,
      regionId: target.regionId,
      institutionLevel: target.institutionLevel,
      positionDomain: target.positionDomain,
      leadershipRank: target.leadershipRank,
      startedAtDay: 10,
      appointmentType: 'substantive',
      appointmentReason: 'promotion',
      sourceOpportunityId: opportunityId,
      status: 'active',
      endedAtDay: null,
      endReason: null,
      probation: null,
    };
    const experiences = asRecords(career.experiences, 'experiences');
    const oldExperience = experiences.find((experience) => experience.endedAtDay === null);
    if (!oldExperience) throw new Error('Expected an open player experience');
    Object.assign(oldExperience, {
      endedAtDay: 10,
      endReason: 'promotion',
    });
    experiences.push({
      id: `e2e-experience-${scenario}`,
      appointmentId,
      positionId: target.positionId,
      positionNameSnapshot: target.positionName,
      institutionId: target.institutionId,
      institutionNameSnapshot: target.institutionName,
      institutionLevel: target.institutionLevel,
      regionId: target.regionId,
      positionDomain: target.positionDomain,
      leadershipRank: target.leadershipRank,
      startedAtDay: 10,
      endedAtDay: null,
      appointmentReason: 'promotion',
      appointmentType: 'substantive',
      sourceOpportunityId: opportunityId,
      endReason: null,
      assessmentResults: [],
    });
    Object.assign(career, { appointment: newAppointment, experiences });
    const transitionId = appointmentId;
    Object.assign(oldPlayerSeat, {
      occupant: null,
      currentAppointmentId: null,
      occupiedAtDay: null,
      sourceTransitionId: transitionId,
    });
    Object.assign(targetSeat, {
      occupant: { type: 'player', id: 'player' },
      currentAppointmentId: appointmentId,
      occupiedAtDay: 10,
      sourceTransitionId: transitionId,
    });
    Object.assign(vacancy, {
      status: 'filled',
      selectionId,
      closedAtDay: 10,
      filledBy: { type: 'player', id: 'player' },
      filledAppointmentId: appointmentId,
      cancellationReason: null,
    });
  }
  organization.selections = [selection];
  career.opportunities = [opportunity];
  career.activeProcess = scenario === 'intermediate' ? process : null;
  career.completedProcesses = scenario === 'intermediate' ? [] : [process];
  envelope.schemaVersion = 14;
  const serializedEnvelope = JSON.stringify(envelope);
  await page.evaluate((next) => localStorage.setItem('zhengtu_autosave', next), serializedEnvelope);
  await page.reload();
  await page.goto('/#/career');
  await expect(page).toHaveURL(/#\/career$/);
  await expect(page.getByTestId('career-selection-card')).toBeVisible();
  const decodedEnvelope = await saveEnvelope(page);
  const decodedOrganization = asRecord(decodedEnvelope.state, 'decoded state').organization;
  const decodedSelections = asRecords(
    asRecord(decodedOrganization, 'decoded organization').selections,
    'decoded selections',
  );
  expect(decodedSelections.some((item) => item.selectionId === selectionId)).toBe(true);
}

async function visibleSelection(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const text = (testId: string) =>
      document.querySelector(`[data-testid="${testId}"]`)?.textContent ?? '';
    return {
      selectionId:
        text('career-selection-card')
          .match(/Selection\s+([^·]+)/)?.[1]
          ?.trim() ?? '',
      resolved: text('career-selection-card').match(/已完成\s+(\d+)\/6/)?.[1] ?? '0',
      stages: text('selection-stage-progress'),
      performance: text('selection-player-performance'),
      winner: text('selection-winner'),
      outcome: text('selection-outcome'),
    };
  });
}

test('玩家获选', async ({ page }) => {
  await seedSelection(page, 'player-appointed');
  const before = await visibleSelection(page);
  await page.reload();
  const after = await visibleSelection(page);
  expect(after.selectionId).toBe(before.selectionId);
  await expect(page.getByTestId('selection-outcome')).toContainText('获选');
  await expect(page.getByTestId('selection-winner')).toContainText('玩家');
});

test('玩家落选且 NPC 获胜', async ({ page }) => {
  await seedSelection(page, 'npc-winner');
  const saved = await saveEnvelope(page);
  const savedOrganization = asRecord(asRecord(saved.state, 'state').organization, 'organization');
  const firstCadre = asRecords(savedOrganization.cadres, 'cadres')[0];
  if (!firstCadre || typeof firstCadre.name !== 'string') throw new Error('Expected NPC name');
  await expect(page.getByTestId('selection-outcome')).toContainText('落选');
  await expect(page.getByTestId('selection-winner')).toContainText(firstCadre.name);
});

test('无合格候选', async ({ page }) => {
  await seedSelection(page, 'no-candidates');
  await expect(page.getByTestId('selection-outcome')).toContainText('无合格候选人');
  await expect(page.getByTestId('selection-survivor-count')).toContainText('0 人');
});

test('中间阶段刷新恢复', async ({ page }) => {
  await seedSelection(page, 'intermediate');
  const before = await visibleSelection(page);
  await page.reload();
  const after = await visibleSelection(page);
  expect(after.selectionId).toBe(before.selectionId);
  expect(after.stages).toBe(before.stages);
  expect(after.performance).toBe(before.performance);
  await page.getByTestId('advance-career-process-e2e-opportunity-intermediate').click();
  await expect
    .poll(async () => Number((await visibleSelection(page)).resolved))
    .toBeGreaterThan(Number(before.resolved));
  const afterAdvance = await visibleSelection(page);
  await page.reload();
  const afterRefresh = await visibleSelection(page);
  expect(afterRefresh.selectionId).toBe(afterAdvance.selectionId);
  expect(afterRefresh.resolved).toBe(afterAdvance.resolved);
});

test('最终结果刷新恢复', async ({ page }) => {
  await seedSelection(page, 'npc-winner');
  const before = await visibleSelection(page);
  await page.reload();
  const after = await visibleSelection(page);
  expect(after).toEqual(before);
  await expect(page.getByTestId('selection-winner')).not.toContainText('玩家');
});
