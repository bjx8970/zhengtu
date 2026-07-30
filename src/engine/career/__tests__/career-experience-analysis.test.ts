/** 统一职业履历分析器测试。 */

import { describe, expect, it } from 'vitest';
import { getConfigLoader } from '../../../config/loader';
import type { CareerExperience, CurrentAppointment } from '../../../domain/career/state';
import { analyzeCareerExperiences } from '../career-experience-analysis';

function makeAppointment(overrides: Partial<CurrentAppointment> = {}): CurrentAppointment {
  return {
    appointmentId: 'appointment-current',
    positionId: 'position-current',
    institutionId: 'institution-current',
    regionId: 'region-current',
    institutionLevel: 'county',
    positionDomain: 'local_governance',
    leadershipRank: 'none',
    startedAtDay: 720,
    appointmentType: 'substantive',
    appointmentReason: 'rotation',
    sourceOpportunityId: null,
    probationEndsAtDay: null,
    ...overrides,
  };
}

function makeExperience(
  appointment: CurrentAppointment,
  overrides: Partial<CareerExperience> = {},
): CareerExperience {
  return {
    id: `experience-${appointment.appointmentId}`,
    appointmentId: appointment.appointmentId,
    positionId: appointment.positionId,
    positionNameSnapshot: appointment.positionId,
    institutionId: appointment.institutionId,
    institutionNameSnapshot: appointment.institutionId,
    institutionLevel: appointment.institutionLevel,
    regionId: appointment.regionId,
    positionDomain: appointment.positionDomain,
    leadershipRank: appointment.leadershipRank,
    startedAtDay: appointment.startedAtDay,
    endedAtDay: null,
    appointmentReason: appointment.appointmentReason,
    appointmentType: appointment.appointmentType,
    sourceOpportunityId: appointment.sourceOpportunityId,
    endReason: null,
    assessmentResults: [],
    ...overrides,
  };
}

function analyze(experiences: CareerExperience[], current = makeAppointment()) {
  return analyzeCareerExperiences({
    experiences,
    currentAppointment: current,
    currentDay: 1080,
    rules: getConfigLoader().getCareerExperienceQualificationRules(),
  });
}

describe('career experience analysis', () => {
  it('counts qualified regions and institutions independently', () => {
    const current = makeAppointment();
    const first = makeAppointment({
      appointmentId: 'appointment-first',
      positionId: 'position-first',
      institutionId: 'institution-first',
      regionId: 'region-a',
      startedAtDay: 0,
    });
    const second = makeAppointment({
      appointmentId: 'appointment-second',
      positionId: 'position-second',
      institutionId: 'institution-second',
      regionId: 'region-a',
      startedAtDay: 360,
    });
    const result = analyze(
      [
        makeExperience(first, { endedAtDay: 360, endReason: 'rotation' }),
        makeExperience(second, { endedAtDay: 720, endReason: 'rotation' }),
        makeExperience(current),
      ],
      current,
    );
    expect(result.valid).toBe(true);
    expect(result.qualifiedRegionIds).toEqual(['region-a', 'region-current']);
    expect(result.qualifiedInstitutionIds).toEqual([
      'institution-current',
      'institution-first',
      'institution-second',
    ]);
    expect(result.regionCount).toBe(2);
    expect(result.institutionCount).toBe(3);
  });

  it('applies each appointment type rule without combining short records', () => {
    const current = makeAppointment();
    const shortOne = makeAppointment({
      appointmentId: 'short-one',
      regionId: 'region-short',
      startedAtDay: 0,
    });
    const shortTwo = makeAppointment({
      appointmentId: 'short-two',
      regionId: 'region-short',
      startedAtDay: 200,
    });
    const temporary = makeAppointment({
      appointmentId: 'temporary',
      institutionId: 'institution-temporary',
      regionId: 'region-temporary',
      startedAtDay: 400,
      appointmentType: 'temporary',
    });
    const secondment = makeAppointment({
      appointmentId: 'secondment',
      institutionId: 'institution-secondment',
      regionId: 'region-secondment',
      startedAtDay: 500,
      appointmentType: 'secondment',
    });
    const acting = makeAppointment({
      appointmentId: 'acting',
      institutionId: 'institution-acting',
      regionId: 'region-acting',
      startedAtDay: 700,
      appointmentType: 'acting',
    });
    const result = analyze(
      [
        makeExperience(shortOne, { endedAtDay: 200, endReason: 'rotation' }),
        makeExperience(shortTwo, { endedAtDay: 400, endReason: 'rotation' }),
        makeExperience(temporary, { endedAtDay: 500, endReason: 'temporary_assignment' }),
        makeExperience(secondment, { endedAtDay: 700, endReason: 'secondment' }),
        makeExperience(acting, { endedAtDay: 880, endReason: 'rotation' }),
        makeExperience(current),
      ],
      current,
    );
    expect(result.qualifiedRegionIds).not.toContain('region-short');
    expect(result.qualifiedRegionIds).not.toContain('region-temporary');
    expect(result.qualifiedRegionIds).toContain('region-secondment');
    expect(result.qualifiedInstitutionIds).toEqual(
      expect.arrayContaining([
        'institution-temporary',
        'institution-secondment',
        'institution-acting',
      ]),
    );
    expect(
      result.records.find((record) => record.appointmentId === 'temporary')
        ?.qualifiesForLevelExperience,
    ).toBe(false);
    expect(
      result.records.find((record) => record.appointmentId === 'acting')
        ?.qualifiesForLevelExperience,
    ).toBe(false);
  });

  it('uses the current day for an open experience and reports corrupted histories', () => {
    const current = makeAppointment({ startedAtDay: 720 });
    const open = makeExperience(current);
    expect(analyze([open], current).records[0]?.durationDays).toBe(360);
    const invalid = analyze(
      [
        makeExperience(current, { id: 'open-a' }),
        makeExperience(current, { id: 'open-b', appointmentId: 'duplicate' }),
        makeExperience(makeAppointment({ appointmentId: 'closed', startedAtDay: 900 }), {
          endedAtDay: 800,
          endReason: null,
        }),
      ],
      current,
    );
    expect(invalid.valid).toBe(false);
    expect(invalid.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        'multiple_open_experiences',
        'negative_duration',
        'closed_experience_missing_end_reason',
      ]),
    );
  });

  it('rejects future-dated records from qualification', () => {
    const current = makeAppointment({ startedAtDay: 1080 });
    const future = makeAppointment({
      appointmentId: 'future',
      regionId: 'region-future',
      startedAtDay: 1200,
    });
    const result = analyze(
      [
        makeExperience(future, { endedAtDay: 1560, endReason: 'rotation' }),
        makeExperience(current),
      ],
      current,
    );
    expect(result.qualifiedRegionIds).not.toContain('region-future');
    expect(result.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining(['future_started_at_day', 'future_ended_at_day']),
    );
  });

  it('reports overlap between two closed intervals', () => {
    const current = makeAppointment({ startedAtDay: 1080 });
    const first = makeAppointment({ appointmentId: 'first', startedAtDay: 0 });
    const second = makeAppointment({ appointmentId: 'second', startedAtDay: 180 });
    const result = analyze(
      [
        makeExperience(first, { endedAtDay: 360, endReason: 'rotation' }),
        makeExperience(second, { endedAtDay: 540, endReason: 'rotation' }),
        makeExperience(current),
      ],
      current,
    );
    expect(result.diagnostics.map((item) => item.code)).toContain('overlapping_experiences');
  });
});
