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
import { createSignal, createMemo, For, Show } from 'solid-js';
import { useGameStore } from '../../store/game-store';
import { getConfigLoader } from '../../config/loader';
import { navigate } from '../../router';
import { CareerLine } from '../../types/enums';
import type { CharacterData } from '../../types/character';
import { generateGaokaoScore, getAvailableTiers } from '../../utils/gaokao';
import { colors, radius, font, pageBase, cardStyle } from '../../utils/theme';
import type { ProvinceConfig } from '../../types/config';

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

  const selectedProvince = createMemo(() => provinces().find((p) => p.name === data().province));
  const selectedCity = createMemo(() => data().city);
  const gaokaoYear = createMemo(() => loader.getGameConfig().startYear - 4);

  const selectedBgId = createMemo(() => data().familyBackground);
  const selectedPathId = createMemo(() => data().promotionPath);
  const selectedBg = createMemo(() => backgrounds().find((b) => b.id === selectedBgId()));
  const selectedPath = createMemo(() => paths().find((p) => p.id === selectedPathId()));

  const totalBonuses = createMemo(() => {
    const b: Record<string, number> = {};
    if (selectedBg()) Object.assign(b, selectedBg()!.bonuses);
    if (selectedPath()) Object.assign(b, selectedPath()!.bonuses);
    return b;
  });

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
    if (step() < TOTAL - 1) {
      setStep((s) => s + 1);
    }
  }

  function handlePrev() {
    setStep((s) => Math.max(0, s - 1));
  }

  function handleComplete() {
    const cfg = loader.getGameConfig();
    const startLine = CareerLine.Administrative;
    const startLevel = 1;
    const startIndex = 0;
    const DEFAULT_START_POS_ID = `${startLine}_l${startLevel}_${startIndex}`;
    const startPos = loader.getPosition(startLine, startLevel, startIndex);
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
        familyBackground: selectedBg()?.name ?? '工人家庭',
        promotionPath: selectedPath()?.name ?? '公务员考试',
        isPreparatory: data().isPreparatory,
        currentPositionId: startPos?.id ?? DEFAULT_START_POS_ID,
        remainingBudget: startPos?.annualBudget ?? cfg.budgetByLevel[startLevel] ?? 0,
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

  return (
    <div style={pageBase}>
      {/* 进度条 */}
      <div style={{ padding: '1.5rem 1.5rem 0' }}>
        <div style={{ display: 'flex', gap: '0.3rem', 'margin-bottom': '0.5rem' }}>
          {Array.from({ length: TOTAL }, (_, i) => (
            <div
              style={{
                flex: 1,
                height: '3px',
                'background-color': i <= step() ? colors.primary : colors.border,
                'border-radius': radius.sm,
                transition: 'background 0.3s',
              }}
            />
          ))}
        </div>
        <div style={{ 'font-size': '0.8rem', color: colors.textSecondary }}>
          第 {step() + 1}/{TOTAL} 步
        </div>
      </div>

      {/* 内容区 */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          'flex-direction': 'column',
          'align-items': 'center',
          'justify-content': 'center',
          padding: '1rem 1.5rem',
          overflow: 'hidden',
        }}
      >
        {/* ===== Step 0: 姓名 + 性别 ===== */}
        <Show when={step() === 0}>
          <div
            style={{
              ...cardStyle('2rem'),
              width: '100%',
              'max-width': '340px',
              'text-align': 'center',
            }}
          >
            <h2
              style={{ 'font-size': '1.3rem', 'font-weight': 'normal', 'margin-bottom': '0.5rem' }}
            >
              基本信息
            </h2>
            <div
              style={{
                'font-family': font.title,
                color: colors.primary,
                opacity: 0.7,
                'margin-bottom': '1.5rem',
                'font-size': '0.85rem',
              }}
            >
              —— 名不正则言不顺 ——
            </div>
            <input
              type="text"
              placeholder="请输入姓名"
              value={data().characterName}
              onInput={(e) => updateField('characterName', e.currentTarget.value)}
              style={{
                padding: '0.8rem 1rem',
                'font-size': '1.1rem',
                'border-radius': radius.md,
                border: `1px solid ${colors.borderLight}`,
                'background-color': colors.bgInput,
                color: colors.textDark,
                width: '100%',
                'text-align': 'center',
                outline: 'none',
                'margin-bottom': '1.2rem',
              }}
              autofocus
            />
            <div style={{ display: 'flex', gap: '0.8rem' }}>
              {(['男', '女'] as const).map((g) => (
                <button
                  onClick={() => updateField('gender', g)}
                  style={{
                    flex: 1,
                    padding: '0.7rem',
                    'font-size': '1rem',
                    'background-color': data().gender === g ? colors.primary : colors.bgInput,
                    color: data().gender === g ? colors.primaryText : colors.textDark,
                    border:
                      data().gender === g
                        ? `1px solid ${colors.primary}`
                        : `1px solid ${colors.borderLight}`,
                    'border-radius': radius.md,
                    cursor: 'pointer',
                  }}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
        </Show>

        {/* ===== Step 1: 省份 → 城市 ===== */}
        <Show when={step() === 1}>
          <div
            style={{
              ...cardStyle('1.5rem'),
              width: '100%',
              'max-width': '600px',
              display: 'flex',
              gap: '1rem',
              'max-height': '60vh',
            }}
          >
            {/* 省份列表 */}
            <div style={{ flex: 1, display: 'flex', 'flex-direction': 'column' }}>
              <div
                style={{
                  'font-size': '0.85rem',
                  color: colors.textSecondary,
                  'margin-bottom': '0.5rem',
                  'text-align': 'center',
                }}
              >
                选择省份
              </div>
              <div
                style={{
                  flex: 1,
                  'overflow-y': 'auto',
                  'border-radius': radius.md,
                  border: `1px solid ${colors.borderLight}`,
                }}
              >
                <For each={provinces()}>
                  {(p) => (
                    <div
                      onClick={() => {
                        updateField('province', p.name);
                        updateField('city', '');
                      }}
                      style={{
                        padding: '0.6rem 1rem',
                        'font-size': '0.9rem',
                        cursor: 'pointer',
                        'background-color':
                          data().province === p.name ? colors.primaryLight : 'transparent',
                        color: data().province === p.name ? colors.primary : colors.textDark,
                        'border-left':
                          data().province === p.name
                            ? `3px solid ${colors.primary}`
                            : '3px solid transparent',
                      }}
                    >
                      {p.name}
                      {p.ethnicBonus > 0 && (
                        <span style={{ 'font-size': '0.8rem', color: colors.primary }}> 🏔</span>
                      )}
                    </div>
                  )}
                </For>
              </div>
            </div>
            {/* 城市列表 */}
            <div style={{ flex: 1, display: 'flex', 'flex-direction': 'column' }}>
              <div
                style={{
                  'font-size': '0.85rem',
                  color: colors.textSecondary,
                  'margin-bottom': '0.5rem',
                  'text-align': 'center',
                }}
              >
                选择城市
              </div>
              <Show
                when={selectedProvince()}
                fallback={
                  <div
                    style={{
                      flex: 1,
                      display: 'flex',
                      'align-items': 'center',
                      'justify-content': 'center',
                      color: colors.textMuted,
                      'font-size': '0.85rem',
                      border: `1px solid ${colors.borderLight}`,
                      'border-radius': radius.md,
                    }}
                  >
                    请先选择省份
                  </div>
                }
              >
                {(prov) => (
                  <div
                    style={{
                      flex: 1,
                      'overflow-y': 'auto',
                      'border-radius': radius.md,
                      border: `1px solid ${colors.borderLight}`,
                    }}
                  >
                    <For each={prov().cities}>
                      {(c) => (
                        <div
                          onClick={() => updateField('city', c)}
                          style={{
                            padding: '0.6rem 1rem',
                            'font-size': '0.9rem',
                            cursor: 'pointer',
                            'background-color':
                              selectedCity() === c ? colors.primaryLight : 'transparent',
                            color: selectedCity() === c ? colors.primary : colors.textDark,
                            'border-left':
                              selectedCity() === c
                                ? `3px solid ${colors.primary}`
                                : '3px solid transparent',
                          }}
                        >
                          {c}
                        </div>
                      )}
                    </For>
                  </div>
                )}
              </Show>
            </div>
          </div>
        </Show>

        {/* ===== Step 2: 高考成绩 ===== */}
        <Show when={step() === 2}>
          <Show
            when={selectedProvince()}
            fallback={<div style={{ color: colors.textSecondary }}>请先返回选择出生地</div>}
          >
            {(prov) => (
              <div
                style={{
                  ...cardStyle('2rem'),
                  width: '100%',
                  'max-width': '340px',
                  'text-align': 'center',
                }}
              >
                <div
                  style={{
                    'font-size': '0.85rem',
                    color: colors.textSecondary,
                    'margin-bottom': '0.5rem',
                  }}
                >
                  {data().province} · {gaokaoYear()}年
                </div>
                <Show
                  when={data().gaokaoScore > 0}
                  fallback={
                    <button
                      onClick={() => rollGaokao(prov())}
                      style={{
                        padding: '1rem 2rem',
                        'font-size': '1.1rem',
                        'background-color': colors.primary,
                        color: colors.primaryText,
                        border: 'none',
                        'border-radius': radius.md,
                        cursor: 'pointer',
                        'font-family': font.title,
                      }}
                    >
                      🎲 生成高考成绩
                    </button>
                  }
                >
                  <div
                    style={{
                      'font-size': '3rem',
                      'font-weight': 'bold',
                      color: colors.primary,
                      'font-family': font.title,
                      'margin-bottom': '0.5rem',
                    }}
                  >
                    {data().gaokaoScore}
                  </div>
                  <div
                    style={{
                      display: 'inline-block',
                      padding: '0.3rem 1.2rem',
                      'border-radius': radius.md,
                      'background-color': colors.primaryLight,
                      color: colors.primary,
                      'font-weight': 'bold',
                      'font-size': '1.1rem',
                      'margin-bottom': '0.8rem',
                    }}
                  >
                    {data().gaokaoTier} 档
                  </div>
                  {prov().ethnicBonus > 0 && (
                    <div
                      style={{
                        'font-size': '0.8rem',
                        color: colors.primary,
                        'margin-bottom': '0.5rem',
                      }}
                    >
                      含民族加分 +{prov().ethnicBonus} 分
                    </div>
                  )}
                  <div
                    style={{
                      'font-size': '0.78rem',
                      color: colors.textSecondary,
                      'margin-bottom': '0.5rem',
                    }}
                  >
                    分数线：985={prov().gaokaoThresholds['985']} 211=
                    {prov().gaokaoThresholds['211']} 本科={prov().gaokaoThresholds['本科']}
                  </div>
                  <button
                    onClick={() => rollGaokao(prov())}
                    style={{
                      padding: '0.5rem 1.5rem',
                      'font-size': '0.9rem',
                      'background-color': 'transparent',
                      color: colors.textSecondary,
                      border: `1px solid ${colors.border}`,
                      'border-radius': radius.md,
                      cursor: 'pointer',
                    }}
                  >
                    ♻ 重掷骰子
                  </button>
                </Show>
              </div>
            )}
          </Show>
        </Show>

        {/* ===== Step 3: 院校选择 ===== */}
        <Show when={step() === 3}>
          <div
            style={{
              ...cardStyle('1.5rem'),
              width: '100%',
              'max-width': '600px',
              display: 'flex',
              gap: '1rem',
              'max-height': '60vh',
            }}
          >
            {/* 档次选择 */}
            <div style={{ flex: 1, display: 'flex', 'flex-direction': 'column' }}>
              <div
                style={{
                  'font-size': '0.85rem',
                  color: colors.textSecondary,
                  'margin-bottom': '0.5rem',
                  'text-align': 'center',
                }}
              >
                院校档次
              </div>
              <div
                style={{
                  flex: 1,
                  'overflow-y': 'auto',
                  'border-radius': radius.md,
                  border: `1px solid ${colors.borderLight}`,
                }}
              >
                <For each={getAvailableTiers(data().gaokaoTier)}>
                  {(tier) => (
                    <div
                      onClick={() => {
                        updateField('universityTier', tier);
                        updateField('university', '');
                        updateField('isPreparatory', tier === '预科');
                      }}
                      style={{
                        padding: '0.6rem 1rem',
                        'font-size': '0.9rem',
                        cursor: 'pointer',
                        'background-color':
                          data().universityTier === tier ? colors.primaryLight : 'transparent',
                        color: data().universityTier === tier ? colors.primary : colors.textDark,
                        'border-left':
                          data().universityTier === tier
                            ? `3px solid ${colors.primary}`
                            : '3px solid transparent',
                      }}
                    >
                      {tier === '预科' ? `预科班 🏔 (入职+1年)` : `${tier} 院校`}
                    </div>
                  )}
                </For>
              </div>
            </div>
            {/* 院校列表 */}
            <div style={{ flex: 1, display: 'flex', 'flex-direction': 'column' }}>
              <div
                style={{
                  'font-size': '0.85rem',
                  color: colors.textSecondary,
                  'margin-bottom': '0.5rem',
                  'text-align': 'center',
                }}
              >
                选择院校
              </div>
              <Show
                when={
                  data().universityTier &&
                  universities().tiers[data().universityTier.replace('预科', '本科')]
                }
                fallback={
                  <div
                    style={{
                      flex: 1,
                      display: 'flex',
                      'align-items': 'center',
                      'justify-content': 'center',
                      color: colors.textMuted,
                      'font-size': '0.85rem',
                      border: `1px solid ${colors.borderLight}`,
                      'border-radius': radius.md,
                    }}
                  >
                    请先选择档次
                  </div>
                }
              >
                {/* eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Show guarantees existence */}
                <div
                  style={{
                    flex: 1,
                    'overflow-y': 'auto',
                    'border-radius': radius.md,
                    border: `1px solid ${colors.borderLight}`,
                  }}
                >
                  <For each={universities().tiers[data().universityTier.replace('预科', '本科')]!}>
                    {(school) => (
                      <div
                        onClick={() => updateField('university', school)}
                        style={{
                          padding: '0.6rem 1rem',
                          'font-size': '0.9rem',
                          cursor: 'pointer',
                          'background-color':
                            data().university === school ? colors.primaryLight : 'transparent',
                          color: data().university === school ? colors.primary : colors.textDark,
                          'border-left':
                            data().university === school
                              ? `3px solid ${colors.primary}`
                              : '3px solid transparent',
                        }}
                      >
                        {school}
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </div>
        </Show>

        {/* ===== Step 4: 家庭背景 + 晋升通道 ===== */}
        <Show when={step() === 4}>
          <div
            style={{
              ...cardStyle('1.5rem'),
              width: '100%',
              'max-width': '500px',
              'text-align': 'center',
            }}
          >
            <h2 style={{ 'font-size': '1.2rem', 'font-weight': 'normal', 'margin-bottom': '1rem' }}>
              家庭背景 × 晋升通道
            </h2>
            <div style={{ display: 'flex', gap: '1rem', 'margin-bottom': '1rem' }}>
              {/* 家庭背景 */}
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    'font-size': '0.85rem',
                    color: colors.textSecondary,
                    'margin-bottom': '0.5rem',
                  }}
                >
                  家庭背景
                </div>
                <For each={backgrounds()}>
                  {(bg) => (
                    <div
                      onClick={() => updateField('familyBackground', bg.id)}
                      style={{
                        padding: '0.6rem',
                        'font-size': '0.9rem',
                        'margin-bottom': '0.3rem',
                        cursor: 'pointer',
                        'background-color':
                          selectedBgId() === bg.id ? colors.primaryLight : colors.bgInput,
                        color: selectedBgId() === bg.id ? colors.primary : colors.textDark,
                        border:
                          selectedBgId() === bg.id
                            ? `1px solid ${colors.primary}`
                            : `1px solid ${colors.borderLight}`,
                        'border-radius': radius.md,
                      }}
                    >
                      {bg.name}
                    </div>
                  )}
                </For>
              </div>
              {/* 晋升通道 */}
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    'font-size': '0.85rem',
                    color: colors.textSecondary,
                    'margin-bottom': '0.5rem',
                  }}
                >
                  晋升通道
                </div>
                <For each={paths()}>
                  {(p) => (
                    <div
                      onClick={() => updateField('promotionPath', p.id)}
                      style={{
                        padding: '0.6rem',
                        'font-size': '0.9rem',
                        'margin-bottom': '0.3rem',
                        cursor: 'pointer',
                        'background-color':
                          selectedPathId() === p.id ? colors.primaryLight : colors.bgInput,
                        color: selectedPathId() === p.id ? colors.primary : colors.textDark,
                        border:
                          selectedPathId() === p.id
                            ? `1px solid ${colors.primary}`
                            : `1px solid ${colors.borderLight}`,
                        'border-radius': radius.md,
                      }}
                    >
                      {p.name}
                    </div>
                  )}
                </For>
              </div>
            </div>
            {/* 加成预览 */}
            <div
              style={{
                'font-size': '0.85rem',
                'border-top': `1px solid ${colors.borderLight}`,
                'padding-top': '0.8rem',
              }}
            >
              <div style={{ color: colors.textSecondary, 'margin-bottom': '0.5rem' }}>加成预览</div>
              <div
                style={{
                  display: 'flex',
                  'flex-wrap': 'wrap',
                  gap: '0.5rem',
                  'justify-content': 'center',
                }}
              >
                <For each={Object.entries(totalBonuses())}>
                  {([key, val]) => (
                    <span
                      style={{
                        padding: '0.2rem 0.6rem',
                        'background-color': colors.primaryLight,
                        color: colors.primary,
                        'border-radius': radius.md,
                        'font-size': '0.8rem',
                      }}
                    >
                      {key} +{val}
                    </span>
                  )}
                </For>
              </div>
            </div>
            <div
              style={{
                'font-family': font.title,
                color: colors.primary,
                opacity: 0.7,
                'margin-top': '0.8rem',
                'font-size': '0.85rem',
              }}
            >
              —— 朝中有人好做官 ——
            </div>
          </div>
        </Show>
      </div>

      {/* 底部导航 */}
      <div style={{ display: 'flex', gap: '0.8rem', padding: '1rem 1.5rem 1.5rem' }}>
        <Show when={step() > 0}>
          <button
            onClick={handlePrev}
            style={{
              flex: 1,
              padding: '0.8rem',
              'font-size': '1rem',
              'background-color': colors.bgCard,
              color: colors.textSecondary,
              border: `1px solid ${colors.border}`,
              'border-radius': radius.md,
              cursor: 'pointer',
            }}
          >
            上一步
          </button>
        </Show>
        <Show when={step() < TOTAL - 1}>
          <button
            onClick={handleNext}
            disabled={!canNext()}
            style={{
              flex: 1,
              padding: '0.8rem',
              'font-size': '1rem',
              'background-color': canNext() ? colors.primary : colors.border,
              color: canNext() ? colors.primaryText : colors.textMuted,
              border: 'none',
              'border-radius': radius.md,
              cursor: canNext() ? 'pointer' : 'not-allowed',
            }}
          >
            下一步
          </button>
        </Show>
        <Show when={step() === TOTAL - 1}>
          <button
            onClick={handleComplete}
            disabled={!canNext()}
            style={{
              flex: 1,
              padding: '0.8rem',
              'font-size': '1rem',
              'background-color': canNext() ? colors.primary : colors.border,
              color: canNext() ? colors.primaryText : colors.textMuted,
              border: 'none',
              'border-radius': radius.md,
              cursor: canNext() ? 'pointer' : 'not-allowed',
              'font-family': font.title,
            }}
          >
            开始仕途
          </button>
        </Show>
      </div>
    </div>
  );
}
