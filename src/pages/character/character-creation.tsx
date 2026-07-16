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

const STEPS: StepDef[] = [
  { title: '姓名', field: 'characterName', type: 'input' },
  { title: '性别', field: 'gender', type: 'options', options: ['男', '女'] },
  {
    title: '出生地',
    field: 'birthPlace',
    type: 'options',
    options: ['北京', '上海', '省城', '地级市', '县城', '乡镇'],
  },
  {
    title: '最高学历',
    field: 'education',
    type: 'options',
    options: ['高中', '大专', '本科', '硕士', '博士'],
  },
  {
    title: '从政动机',
    field: 'motivation',
    type: 'options',
    options: ['为民服务', '个人抱负', '家族期望'],
  },
  {
    title: '性格特质',
    field: 'personality',
    type: 'options',
    options: ['廉洁型', '务实型', '改革型', '稳健型'],
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
    const startPos = getConfigLoader().getPosition(CareerLine.Administrative, 1, 0);
    dispatch({
      type: 'NEW_GAME',
      data: {
        ...data(),
        birthYear: cfg.startYear - 30,
        familyBackground: '普通家庭',
        currentPositionId: startPos?.id ?? 'admin_l1_0',
        remainingBudget: startPos?.annualBudget ?? 800,
      },
    });
    navigate('/dashboard');
  }

  return (
    <div
      style={{
        display: 'flex',
        'flex-direction': 'column',
        height: '100%',
        'background-color': '#1a1a2e',
        color: '#e0e0e0',
      }}
    >
      {/* 进度条 */}
      <div style={{ padding: '1rem 1rem 0' }}>
        <div
          style={{
            display: 'flex',
            gap: '0.3rem',
            'margin-bottom': '0.5rem',
          }}
        >
          <For each={STEPS}>
            {(_, idx) => (
              <div
                style={{
                  flex: 1,
                  height: '4px',
                  'background-color': idx() <= step() ? '#4A6FA5' : '#333',
                  'border-radius': '2px',
                }}
              />
            )}
          </For>
        </div>
        <div style={{ 'font-size': '0.8rem', color: '#888' }}>
          第 {step() + 1}/{STEPS.length} 步 · {currentStep().title}
        </div>
      </div>

      {/* 表单区域 */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          'flex-direction': 'column',
          'align-items': 'center',
          'justify-content': 'center',
          padding: '1rem',
        }}
      >
        <h2 style={{ 'margin-bottom': '1.5rem', 'font-size': '1.3rem', 'font-weight': 'normal' }}>
          {currentStep().title}
        </h2>

        <Show when={currentStep().type === 'input'}>
          <input
            type="text"
            placeholder="输入姓名"
            value={data().characterName}
            onInput={(e) => updateField(e.currentTarget.value)}
            style={{
              padding: '0.8rem 1rem',
              'font-size': '1.1rem',
              'border-radius': '8px',
              border: '1px solid #555',
              'background-color': '#16213e',
              color: '#e0e0e0',
              width: '260px',
              'text-align': 'center',
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
              width: '260px',
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
                      'background-color': selected ? '#4A6FA5' : '#16213e',
                      color: selected ? '#fff' : '#ccc',
                      border: selected ? '2px solid #6B8FC5' : '1px solid #333',
                      'border-radius': '8px',
                      cursor: 'pointer',
                      'text-align': 'center',
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

      {/* 底部导航 */}
      <div
        style={{
          display: 'flex',
          gap: '0.8rem',
          padding: '1rem',
          'border-top': '1px solid #333',
        }}
      >
        <Show when={!isFirst()}>
          <button
            onClick={handlePrev}
            style={{
              flex: 1,
              padding: '0.8rem',
              'font-size': '1rem',
              'background-color': '#2a2a4a',
              color: '#ccc',
              border: 'none',
              'border-radius': '8px',
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
            'background-color': canProceed() ? '#4A6FA5' : '#333',
            color: canProceed() ? '#fff' : '#666',
            border: 'none',
            'border-radius': '8px',
            cursor: canProceed() ? 'pointer' : 'not-allowed',
          }}
        >
          {isLast() ? '开始仕途' : '下一步'}
        </button>
      </div>
    </div>
  );
}
