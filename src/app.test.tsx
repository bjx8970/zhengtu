/**
 * 应用路由可达性测试。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@solidjs/testing-library';
import { App } from './app';
import { getConfigLoader } from './config/loader';

describe('App routes', () => {
  afterEach(() => {
    window.location.hash = '';
    vi.restoreAllMocks();
  });

  it('暂时停用登录路由', () => {
    window.location.hash = '#/login';

    render(() => <App />);

    expect(screen.getByRole('heading', { name: '404' })).toBeInTheDocument();
  });

  it('注册职务与职级页面路由', () => {
    window.location.hash = '#/career';

    render(() => <App />);

    expect(screen.getByText('职务与职级')).toBeInTheDocument();
    expect(screen.getByText('公务员职级')).toBeInTheDocument();
    expect(screen.getByTestId('township-deputy-readiness')).toHaveTextContent('乡科级副职准备度');
    expect(screen.getByTestId('township-deputy-readiness')).toHaveTextContent(
      '累计服务年限不少于 2 年',
    );
  });

  it('职业页随正式机会配置阈值变化', () => {
    const loader = getConfigLoader();
    const definitions = loader.getAllCareerOpportunityDefinitions();
    const deputy = definitions.find((item) => item.id === 'township_deputy_leadership_vacancy');
    const assessmentCondition = deputy?.conditions.find(
      (condition) =>
        'careerCheck' in condition &&
        condition.careerCheck === 'assessment_history' &&
        condition.check === 'qualified_count',
    );
    if (!assessmentCondition || !('careerCheck' in assessmentCondition))
      throw new Error('Expected deputy assessment-history condition');
    assessmentCondition.value = 3;
    vi.spyOn(loader, 'getAllCareerOpportunityDefinitions').mockReturnValue(definitions);
    window.location.hash = '#/career';

    render(() => <App />);

    expect(screen.getByTestId('township-deputy-readiness')).toHaveTextContent('不少于 3');
  });

  it('exposes the policy and event interaction routes', () => {
    window.location.hash = '#/policies';
    const policies = render(() => <App />);
    expect(screen.getByText('政策治理')).toBeInTheDocument();
    policies.unmount();

    window.location.hash = '#/events';
    render(() => <App />);
    expect(screen.getByText('事件中心')).toBeInTheDocument();
  });
});
