/**
 * 建档页面（5 步向导）
 *
 * 创建游戏角色的向导流程：
 * 1. 基本信息 — 姓名 + 性别
 * 2. 出生地 — 省份 → 城市级联选择
 * 3. 高考成绩 — 随机生成 + 可重掷
 * 4. 院校选择 — 档次 → 院校级联（向下兼容）
 * 5. 家庭背景 + 晋升通道 — 双列选择 + 加成预览
 *
 * 完成后 dispatch(NEW_GAME) 并跳转仪表盘。
 */
import { createSignal, createMemo, Show } from 'solid-js';
import { useGameStore } from '../../store/game-store';
import { getConfigLoader } from '../../config/loader';
import { navigate } from '../../router';
import { CareerLine } from '../../types/enums';
import type { CharacterData } from '../../types/character';
import { generateGaokaoScore } from '../../utils/gaokao';
import { pageBase } from '../../utils/theme';
import type { ProvinceConfig } from '../../types/config';
import { StepBasicInfo } from './StepBasicInfo';
import { StepBirthplace } from './StepBirthplace';
import { StepGaokao } from './StepGaokao';
import { StepSchool } from './StepSchool';
import { StepBackground } from './StepBackground';
import { StepLayout } from './StepLayout';

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
};

export function CharacterCreation() {
  const { state, dispatch } = useGameStore();

  if (state.characterName) {
    navigate('/dashboard');
    return null;
  }

  const [step, setStep] = createSignal(0);
  const [data, setData] = createSignal<CharacterData>({ ...INITIAL_DATA });
  const TOTAL = 5;

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
    const startLine = CareerLine.Administrative;
    const startPos = loader.getPosition(startLine, 1, 0);
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
        currentPositionId: startPos?.id ?? 'admin_l1_0',
        remainingBudget: startPos?.annualBudget ?? cfg.budgetByLevel[1] ?? 0,
      },
    });
    navigate('/dashboard');
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
      default:
        return false;
    }
  });

  const selectedProvince = createMemo(() => provinces().find((p) => p.name === data().province));

  const stepContent = createMemo(() => {
    switch (step()) {
      case 0:
        return <StepBasicInfo data={data()} updateField={updateField} />;
      case 1:
        return (
          <StepBirthplace
            data={data()}
            provinces={provinces}
            selectedProvince={selectedProvince}
            updateField={updateField}
          />
        );
      case 2:
        return selectedProvince() ? (
          <StepGaokao
            data={data()}
            province={selectedProvince()!}
            gaokaoYear={gaokaoYear()}
            rollGaokao={rollGaokao}
          />
        ) : null;
      case 3:
        return <StepSchool data={data()} universities={universities()} updateField={updateField} />;
      case 4:
        return (
          <StepBackground
            data={data()}
            backgrounds={backgrounds()}
            paths={paths()}
            updateField={updateField}
          />
        );
      default:
        return null;
    }
  });

  return (
    <div style={pageBase}>
      <StepLayout
        step={step}
        total={TOTAL}
        canNext={canNext}
        onPrev={handlePrev}
        onNext={handleNext}
        onComplete={handleComplete}
      >
        <Show when={stepContent()}>{(c) => c()}</Show>
      </StepLayout>
    </div>
  );
}
