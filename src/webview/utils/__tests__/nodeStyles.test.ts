/**
 * nodeStyles 单元测试
 * 测试样式常量和状态优先级逻辑
 */

import {
  NODE_BORDER,
  NODE_SHADOW,
  getNodeStatePriority,
  NodeStatePriority,
} from '../nodeStyles';

describe('nodeStyles - 样式常量', () => {
  describe('NODE_BORDER', () => {
    it('应该包含正确的边框宽度常量', () => {
      expect(NODE_BORDER.SELECTED_WIDTH).toBe('4px');
      expect(NODE_BORDER.HIGHLIGHT_WIDTH).toBe('3px');
      expect(NODE_BORDER.NORMAL_WIDTH).toBe('2px');
    });

    it('应该包含正确的边框颜色常量', () => {
      expect(NODE_BORDER.SELECTED_COLOR).toBe('#0078d4');
      expect(NODE_BORDER.HIGHLIGHT_COLOR).toBe('#10b981');
    });

    it('边框宽度应该是数字+px格式', () => {
      const pxPattern = /^\d+px$/;
      expect(NODE_BORDER.SELECTED_WIDTH).toMatch(pxPattern);
      expect(NODE_BORDER.HIGHLIGHT_WIDTH).toMatch(pxPattern);
      expect(NODE_BORDER.NORMAL_WIDTH).toMatch(pxPattern);
    });

    it('边框颜色应该是十六进制格式', () => {
      const hexPattern = /^#[0-9a-fA-F]{6}$/;
      expect(NODE_BORDER.SELECTED_COLOR).toMatch(hexPattern);
      expect(NODE_BORDER.HIGHLIGHT_COLOR).toMatch(hexPattern);
    });
  });

  describe('NODE_SHADOW', () => {
    it('应该包含正确的阴影常量', () => {
      expect(NODE_SHADOW.SELECT).toBe('0 0 8px rgba(0, 120, 212, 0.5)');
      expect(NODE_SHADOW.HIGHLIGHT).toBe('0 0 12px rgba(16, 185, 129, 0.6)');
      expect(NODE_SHADOW.SELECTED_AND_HIGHLIGHT).toBe('0 0 12px rgba(138, 43, 226, 0.7)');
    });

    it('阴影应该是有效的 CSS box-shadow 格式', () => {
      // CSS box-shadow 格式: offset-x | offset-y | blur-radius | color
      const boxShadowPattern = /^\d+ \d+ \d+px rgba\(\d+, \d+, \d+, [\d.]+\)$/;
      expect(NODE_SHADOW.SELECT).toMatch(boxShadowPattern);
      expect(NODE_SHADOW.HIGHLIGHT).toMatch(boxShadowPattern);
      expect(NODE_SHADOW.SELECTED_AND_HIGHLIGHT).toMatch(boxShadowPattern);
    });
  });
});

describe('getNodeStatePriority', () => {
  const testCases: Array<{
    isSelected: boolean;
    isHighlighted: boolean;
    expected: NodeStatePriority;
    description: string;
  }> = [
    {
      isSelected: true,
      isHighlighted: true,
      expected: 'selected',
      description: '同时选中和高亮时返回 selected',
    },
    {
      isSelected: true,
      isHighlighted: false,
      expected: 'selected-only',
      description: '仅选中时返回 selected-only',
    },
    {
      isSelected: false,
      isHighlighted: true,
      expected: 'highlighted-only',
      description: '仅高亮时返回 highlighted-only',
    },
    {
      isSelected: false,
      isHighlighted: false,
      expected: 'normal',
      description: '既未选中也未高亮时返回 normal',
    },
  ];

  testCases.forEach(({ isSelected, isHighlighted, expected, description }) => {
    it(description, () => {
      expect(getNodeStatePriority(isSelected, isHighlighted)).toBe(expected);
    });
  });

  it('应该处理所有布尔组合', () => {
    const results = new Set<NodeStatePriority>();

    results.add(getNodeStatePriority(true, true));
    results.add(getNodeStatePriority(true, false));
    results.add(getNodeStatePriority(false, true));
    results.add(getNodeStatePriority(false, false));

    // 应该返回全部 4 种不同的状态
    expect(results.size).toBe(4);
    expect(results).toContain('selected');
    expect(results).toContain('selected-only');
    expect(results).toContain('highlighted-only');
    expect(results).toContain('normal');
  });
});
