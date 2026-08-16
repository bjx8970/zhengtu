/**
 * 建档页面（6 步向导）— 「干部履历表」公文版面
 *
 * 创建游戏角色的向导流程：
 * 1. 基本信息 — 姓名 + 性别
 * 2. 出生地 — 省份 → 城市级联选择
 * 3. 高考成绩 — 随机生成 + 可重掷
 * 4. 院校选择 — 档次 → 院校级联（向下兼容）
 * 5. 家庭背景 + 晋升通道 — 双列选择 + 加成预览
 * 6. 职业线选择 — 行政/党群/纪检/群团四选一
 *
 * 完成后 dispatch(NEW_GAME) 并跳转工作台。
 */
import { createSignal, createMemo, Show, For } from 'solid-js';
import { useGameStore } from '../../store/game-store';
import { getConfigLoader } from '../../config/loader';
import { navigate } from '../../router';
import { consumeForceNewGame } from '../../services/startup-save-state';
import { CareerLine } from '../../types/enums';
import type { CharacterData } from '../../types/character';
import { generateGaokaoScore } from '../../utils/gaokao';
import type { ProvinceConfig } from '../../types/config';
import { StepBasicInfo } from './StepBasicInfo';
import { StepBirthplace } from './StepBirthplace';
import { StepGaokao } from './StepGaokao';
import { StepSchool } from './StepSchool';
import { StepBackground } from './StepBackground';
import { StepCareerLine } from './StepCareerLine';

const INITIAL_DATA: CharacterData = {
  characterName: '',
  gender: '男',
  province: '',
  city: '',
  gaokaoScore: 0,
  gaokaoTier: '本科',
  university: '',
  universityTier: '本科',
  familyBackground: 'worker',
  promotionPath: 'gongwuyuan',
  isPreparatory: false,
  careerLine: CareerLine.Administrative,
};

/** 各步骤眉题 */
const STEP_NAMES = ['基本信息', '出生地', '高考成绩', '院校选择', '家庭背景', '职业线'] as const;

/**
 * 建档向导组件。
 *
 * @returns 干部履历表式 6 步建档向导
 */
export function CharacterCreation() {
  const { state, dispatch } = useGameStore();

  if (state.character.characterName && !consumeForceNewGame()) {
    navigate('/main');
    return null;
  }

  const [step, setStep] = createSignal(0);
  const [data, setData] = createSignal<CharacterData>({ ...INITIAL_DATA });
  const TOTAL = 6;

  const loader = getConfigLoader();
  const provinces = createMemo(() => loader.getRegions().provinces);
  const universities = createMemo(() => loader.getUniversities());
  const backgrounds = createMemo(() => loader.getFamilyBackgrounds());
  const paths = createMemo(() => loader.getPromotionPaths());
  const gaokaoYear = createMemo(() => loader.getGameConfig().startYear - 4);

  function updateField<K extends keyof CharacterData>(field: K, value: CharacterData[K]) {
    setData((prev) => ({ ...prev, [field]: value }));
  }

  function rollGaokao(province: ProvinceConfig) {
    const result = generateGaokaoScore(province);
    setData((prev) => ({
      ...prev,
      gaokaoScore: result.rawScore,
      gaokaoTier: result.tier,
      isPreparatory: false,
    }));
  }

  function handleNext() {
    if (step() < TOTAL - 1) setStep((s) => s + 1);
  }
  function handlePrev() {
    setStep((s) => Math.max(0, s - 1));
  }

  function handleComplete() {
    const cfg = loader.getGameConfig();
    const startPos = loader.getPositionById(cfg.initialPositionId);
    const startYear = cfg.startYear + (data().isPreparatory ? 1 : 0);

    dispatch({
      type: 'NEW_GAME',
      data: {
        characterName: data().characterName,
        gender: data().gender,
        birthPlace: { province: data().province, city: data().city },
        birthYear: startYear - cfg.defaultStartingAge,
        gaokaoScore: data().gaokaoScore,
        gaokaoTier: data().gaokaoTier,
        university: data().university,
        universityTier: data().universityTier,
        familyBackground: data().familyBackground,
        promotionPath: data().promotionPath,
        isPreparatory: data().isPreparatory,
        currentCareerLine: data().careerLine,
        currentPositionId: startPos?.id ?? 'admin_l1_0',
        remainingBudget: startPos?.annualBudget ?? cfg.budgetByLevel[1] ?? 0,
      },
    });
    navigate('/main');
  }

  const canNext = createMemo(() => {
    const d = data();
    switch (step()) {
      case 0:
        return d.characterName.trim().length >= 2;
      case 1:
        return !!d.province && !!d.city;
      case 2:
        return d.gaokaoScore > 0;
      case 3:
        return !!d.university && !!d.universityTier;
      case 4:
        return !!d.familyBackground && !!d.promotionPath;
      case 5:
        return !!d.careerLine;
      default:
        return false;
    }
  });

  const selectedProvince = createMemo(() => provinces().find((p) => p.name === data().province));

  return (
    <div class="doc-scroll">
      <header class="masthead">
        <div class="masthead-inner">
          <a class="btn btn-ghost btn-sm" href="#/">
            {'\u2190'} 返回
          </a>
          <div class="masthead-seal" aria-hidden="true">
            政
          </div>
          <div>
            <div class="masthead-title">干部履历表</div>
            <div class="masthead-sub">新录用公务员建档 · 六步</div>
          </div>
          <div class="masthead-spacer" />
          <div class="masthead-date">
            {STEP_NAMES[step()]} · 第 {step() + 1}/{TOTAL} 步
          </div>
        </div>
      </header>

      <div class="doc-page">
        <div class="doc-shell" style={{ 'max-width': '720px' }}>
          <section class="card">
            <div class="card-pad">
              <div class="wizard-steps" aria-label="建档进度">
                <For each={Array.from({ length: TOTAL }, (_, i) => i)}>
                  {(i) => <div class={i <= step() ? 'wizard-step done' : 'wizard-step'} />}
                </For>
              </div>
              <div class="wizard-caption">
                <span>
                  第 {step() + 1} 步 · {STEP_NAMES[step()]}
                </span>
                <span>共 {TOTAL} 步</span>
              </div>
            </div>

            <div class="card-pad" style={{ 'min-height': '340px' }}>
              <Show when={step() === 0}>
                <StepBasicInfo data={data()} updateField={updateField} />
              </Show>
              <Show when={step() === 1}>
                <StepBirthplace
                  data={data()}
                  provinces={provinces}
                  selectedProvince={selectedProvince}
                  updateField={updateField}
                />
              </Show>
              <Show when={step() === 2 && selectedProvince()}>
                {(prov) => (
                  <StepGaokao
                    data={data()}
                    province={prov()}
                    gaokaoYear={gaokaoYear()}
                    rollGaokao={rollGaokao}
                  />
                )}
              </Show>
              <Show when={step() === 3}>
                <StepSchool data={data()} universities={universities()} updateField={updateField} />
              </Show>
              <Show when={step() === 4}>
                <StepBackground
                  data={data()}
                  backgrounds={backgrounds()}
                  paths={paths()}
                  updateField={updateField}
                />
              </Show>
              <Show when={step() === 5}>
                <StepCareerLine data={data()} updateField={updateField} />
              </Show>
            </div>

            <div
              class="card-pad flex gap-md"
              style={{ 'border-top': '1px solid var(--border-color)' }}
            >
              <Show when={step() > 0}>
                <button data-testid="character-previous" class="btn" onClick={handlePrev}>
                  {'\u2190'} 上一步
                </button>
              </Show>
              <div class="flex-1" />
              <Show when={step() < TOTAL - 1}>
                <button
                  data-testid="character-next"
                  class="btn btn-primary btn-lg"
                  onClick={handleNext}
                  disabled={!canNext()}
                >
                  下一步 {'\u2192'}
                </button>
              </Show>
              <Show when={step() === TOTAL - 1}>
                <button
                  data-testid="character-complete"
                  class="btn btn-primary btn-lg serif"
                  onClick={handleComplete}
                  disabled={!canNext()}
                >
                  开始仕途
                </button>
              </Show>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
