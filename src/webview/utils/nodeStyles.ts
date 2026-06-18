/**
 * 节点样式常量和工具函数
 * 用于 ReactFlow 图形中的 FileNode 和 SymbolNode 组件
 */

/**
 * 边框样式常量
 */
export const NODE_BORDER = {
  /** 选中状态的边框宽度 */
  SELECTED_WIDTH: '4px',
  /** 高亮状态的边框宽度 */
  HIGHLIGHT_WIDTH: '3px',
  /** 普通状态的边框宽度 */
  NORMAL_WIDTH: '2px',
  /** 选中状态的边框颜色（蓝色） */
  SELECTED_COLOR: '#0078d4',
  /** 高亮状态的边框颜色（绿色） */
  HIGHLIGHT_COLOR: '#10b981',
} as const;

/**
 * 阴影效果常量
 */
export const NODE_SHADOW = {
  /** 选中状态的阴影（蓝色光晕） */
  SELECT: '0 0 8px rgba(0, 120, 212, 0.5)',
  /** 高亮状态的阴影（绿色光晕） */
  HIGHLIGHT: '0 0 12px rgba(16, 185, 129, 0.6)',
  /** 同时选中和高亮的阴影（紫色光晕，避免叠加混乱） */
  SELECTED_AND_HIGHLIGHT: '0 0 12px rgba(138, 43, 226, 0.7)',
} as const;

/**
 * 节点状态优先级类型
 */
export type NodeStatePriority =
  | 'selected'           // 同时选中和高亮（优先级最高）
  | 'selected-only'      // 仅选中
  | 'highlighted-only'   // 仅高亮
  | 'normal';            // 普通状态（优先级最低）

/**
 * 根据选中状态和高亮状态计算优先级
 *
 * 优先级规则：
 * 1. 同时选中和高亮 → 'selected'
 * 2. 仅选中 → 'selected-only'
 * 3. 仅高亮 → 'highlighted-only'
 * 4. 都不是 → 'normal'
 *
 * @param isSelected - 节点是否被选中
 * @param isHighlighted - 节点是否被高亮
 * @returns 节点状态优先级
 */
export function getNodeStatePriority(
  isSelected: boolean,
  isHighlighted: boolean
): NodeStatePriority {
  if (isSelected && isHighlighted) {
    return 'selected';
  }
  if (isSelected) {
    return 'selected-only';
  }
  if (isHighlighted) {
    return 'highlighted-only';
  }
  return 'normal';
}
