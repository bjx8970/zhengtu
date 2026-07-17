/**
 * 建档页面（6 步向导）
 *
 * 创建游戏角色的向导流程：
 * 1. 姓名 — 文本输入
 * 2. 性别 — 男/女
 * 3. 出生地 — 6 选 1
 * 4. 学历 — 5 选 1
 * 5. 动机 — 3 选 1
 * 6. 性格 — 4 选 1
 *
 * 完成后 dispatch(NEW_GAME) 并跳转仪表盘。
 */
import { createSignal, For, Show } from 'solid-js';
import { useGameStore } from '../../store/game-store';
import { getConfigLoader } from '../../config/loader';
import { navigate } from '../../router';
import { CareerLine } from '../../types/enums';
import type { CharacterData, StepDef } from '../../types/character';
import { colors, radius, pageBase, cardStyle } from '../../utils/theme';

const STEPS: (StepDef & { quote?: string })[] = [
  { title: '姓名', field: 'characterName', type: 'input', quote: '名者，命也' },
  { title: '性别', field: 'gender', type: 'options', options: ['男', '女'], quote: '巾帼不让须眉' },
  {
    title: '出生地',
    field: 'birthPlace',
    type: 'options',
    options: ['北京', '上海', '省城', '地级市', '县城', '乡镇'],
    quote: '一方水土养一方人',
  },
  {
    title: '最高学历',
    field: 'education',
    type: 'options',
    options: ['高中', '大专', '本科', '硕士', '博士'],
    quote: '学而优则仕',
  },
  {
    title: '从政动机',
    field: 'motivation',
    type: 'options',
    options: ['为民服务', '个人抱负', '家族期望'],
    quote: '为天地立心，为生民立命',
  },
  {
    title: '性格特质',
    field: 'personality',
    type: 'options',
    options: ['廉洁型', '务实型', '改革型', '稳健型'],
    quote: '江山易改，秉性难移',
  },
];

const INITIAL_DATA: CharacterData = {
  characterName: '',
  gender: '男',
  birthPlace: '',
  education: '本科',
  motivation: '为民服务',
  personality: '稳健型',
};

export function CharacterCreation() {
  const { state, dispatch } = useGameStore();

  // 已有存档时跳过建档，直接进入仪表盘
  if (state.characterName) {
    navigate('/dashboard');
    return null;
  }
  const [step, setStep] = createSignal(0);
  const [data, setData] = createSignal<CharacterData>({ ...INITIAL_DATA });

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- step() 始终在 STEPS 索引范围内
  const currentStep = () => STEPS[step()]!;
  const isFirst = () => step() === 0;
  const isLast = () => step() === STEPS.length - 1;

  /** 当前步骤是否有有效输入 */
  const canProceed = () => {
    const s = currentStep();
    const value = data()[s.field];
    if (s.type === 'input') return (value as string).trim().length > 0;
    return value !== '';
  };

  function updateField(value: string) {
    setData((prev) => ({ ...prev, [currentStep().field]: value }));
  }

  function handleNext() {
    if (isLast()) {
      handleComplete();
      return;
    }
    setStep((s) => s + 1);
  }

  function handlePrev() {
    setStep((s) => Math.max(0, s - 1));
  }

  function handleComplete() {
    const cfg = getConfigLoader().getGameConfig();
    const startLine = CareerLine.Administrative;
    const startLevel = 1;
    const startIndex = 0;
    const DEFAULT_START_POS_ID = `${startLine}_l${startLevel}_${startIndex}`;
    const startPos = getConfigLoader().getPosition(startLine, startLevel, startIndex);
    dispatch({
      type: 'NEW_GAME',
      data: {
        ...data(),
        birthYear: cfg.startYear - cfg.defaultStartingAge,
        familyBackground: '普通家庭',
        currentPositionId: startPos?.id ?? DEFAULT_START_POS_ID,
        remainingBudget: startPos?.annualBudget ?? cfg.budgetByLevel[startLevel] ?? 0,
      },
    });
    navigate('/dashboard');
  }

  return (
    <div style={pageBase}>
      {/* 进度条 */}
      <div style={{ padding: '1.5rem 1.5rem 0' }}>
        <div style={{ display: 'flex', gap: '0.3rem', 'margin-bottom': '0.5rem' }}>
          <For each={STEPS}>
            {(_, idx) => (
              <div
                style={{
                  flex: 1,
                  height: '3px',
                  'background-color': idx() <= step() ? colors.primary : colors.border,
                  'border-radius': radius.sm,
                  transition: 'background 0.3s',
                }}
              />
            )}
          </For>
        </div>
        <div style={{ 'font-size': '0.8rem', color: colors.textSecondary }}>
          第 {step() + 1}/{STEPS.length} 步 · {currentStep().title}
        </div>
      </div>

      {/* 表单区域 — 白色卡片居中 */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          'flex-direction': 'column',
          'align-items': 'center',
          'justify-content': 'center',
          padding: '1.5rem',
        }}
      >
        <div
          style={{
            ...cardStyle('2rem'),
            width: '100%',
            'max-width': '320px',
            'text-align': 'center',
          }}
        >
          <h2
            style={{
              'margin-bottom': '0.5rem',
              'font-size': '1.4rem',
              'font-weight': 'normal',
            }}
          >
            {currentStep().title}
          </h2>

          <Show when={currentStep().quote}>
            <div
              style={{
                'font-size': '0.85rem',
                color: colors.primary,
                opacity: 0.7,
                'margin-bottom': '1.5rem',
                'font-family': '"STKaiti", "KaiTi", "楷体", serif',
              }}
            >
              —— {currentStep().quote} ——
            </div>
          </Show>

          <Show when={currentStep().type === 'input'}>
            <input
              type="text"
              placeholder="输入姓名"
              value={data().characterName}
              onInput={(e) => updateField(e.currentTarget.value)}
              style={{
                padding: '0.8rem 1rem',
                'font-size': '1.1rem',
                'border-radius': radius.md,
                border: `1px solid ${colors.borderLight}`,
                'background-color': '#f8f7f5',
                color: colors.textDark,
                width: '100%',
                'text-align': 'center',
                outline: 'none',
              }}
              autofocus
            />
          </Show>

          <Show when={currentStep().type === 'options' && currentStep().options}>
            <div
              style={{
                display: 'flex',
                'flex-direction': 'column',
                gap: '0.6rem',
                width: '100%',
              }}
            >
              {/* eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- 仅 options 类型步骤渲染此 For */}
              <For each={currentStep().options!}>
                {(opt) => {
                  const selected = data()[currentStep().field] === opt;
                  return (
                    <div
                      onClick={() => updateField(opt)}
                      style={{
                        padding: '0.8rem 1rem',
                        'font-size': '1rem',
                        'background-color': selected ? colors.primary : '#f8f7f5',
                        color: selected ? colors.primaryText : colors.textDark,
                        border: selected
                          ? `1px solid ${colors.primary}`
                          : `1px solid ${colors.borderLight}`,
                        'border-radius': radius.md,
                        cursor: 'pointer',
                        'text-align': 'center',
                        transition: 'all 0.15s',
                      }}
                    >
                      {opt}
                    </div>
                  );
                }}
              </For>
            </div>
          </Show>
        </div>
      </div>

      {/* 底部导航 */}
      <div
        style={{
          display: 'flex',
          gap: '0.8rem',
          padding: '1rem 1.5rem 1.5rem',
        }}
      >
        <Show when={!isFirst()}>
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
        <button
          onClick={handleNext}
          disabled={!canProceed()}
          style={{
            flex: 1,
            padding: '0.8rem',
            'font-size': '1rem',
            'background-color': canProceed() ? colors.primary : colors.border,
            color: canProceed() ? colors.primaryText : colors.textMuted,
            border: 'none',
            'border-radius': radius.md,
            cursor: canProceed() ? 'pointer' : 'not-allowed',
            transition: 'background 0.2s',
          }}
        >
          {isLast() ? '开始仕途' : '下一步'}
        </button>
      </div>
    </div>
  );
}
