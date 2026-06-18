import React from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { EXTENSION_COLORS, LANGUAGE_COLORS } from '../../../shared/constants';
import { actionButtonSize, cycleIndicatorSize } from '../../utils/nodeUtils';
import { LanguageIcon } from './LanguageIcon';
import { NODE_BORDER, NODE_SHADOW, getNodeStatePriority } from '../../utils/nodeStyles';

export interface FileNodeData {
  label: string;
  fullPath: string;
  isRoot: boolean;
  isParent: boolean;
  isInCycle: boolean;
  hasChildren: boolean;
  isExpanded: boolean;
  hasReferencingFiles: boolean;
  parentCount?: number;
  isParentsVisible: boolean;
  onNodeClick: () => void;
  onDrillDown: () => void;
  onShowGraphView?: () => void; // 双击节点进入该文件的 graph view
  onFindReferences: () => void;
  onToggleParents?: () => void;
  onToggle: () => void;
  onExpandRequest: () => void;
  selectedNodeId?: string | null;
  nodeId?: string;
  // 显示模块路径的配置
  showModulePath?: boolean;
  modulePath?: string; // 完整模块路径,用于 hover title
  // Highlight state for direct connections (File mode only)
  isHighlighted?: boolean;
  isHighlightActive?: boolean;
  // 文件总行数显示（独立通道，与依赖图解耦）
  lineCount?: number;
  showFileLineCounts?: boolean;
}

// Use shared extension colors from constants
const EXTERNAL_PACKAGE_COLOR = LANGUAGE_COLORS.unknown;

function isExternalPackage(path: string): boolean {
  if (!path) return false;

  for (const ext of Object.keys(EXTENSION_COLORS)) {
    if (path.endsWith(ext)) return false;
  }

  if (path.startsWith('.') || path.startsWith('/') || /^[a-zA-Z]:/.test(path)) {
    return false;
  }

  if ((path.includes('/') || path.includes('\\')) && !path.includes('node_modules')) {
    return false;
  }

  return true;
}

function getFileBorderColor(label: string, fullPath: string): string {
  if (isExternalPackage(fullPath || label)) {
    return EXTERNAL_PACKAGE_COLOR;
  }
  for (const [ext, color] of Object.entries(EXTENSION_COLORS)) {
    if (label.endsWith(ext)) return color;
  }
  return EXTERNAL_PACKAGE_COLOR;
}

export const FileNode = React.memo<NodeProps<FileNodeData>>(function FileNode({ data, id }) {
  const borderColor = getFileBorderColor(data.label, data.fullPath);
  const isExternal = isExternalPackage(data.fullPath || data.label);
  const isSelected = data.selectedNodeId === (data.nodeId || id);
  const isHighlighted = data.isHighlighted ?? false;

  // 根据状态优先级确定边框样式
  const getBorderStyle = (): string => {
    const statePriority = getNodeStatePriority(isSelected, isHighlighted);

    switch (statePriority) {
      case 'selected':
      case 'selected-only':
        return `${NODE_BORDER.SELECTED_WIDTH} solid ${NODE_BORDER.SELECTED_COLOR}`;
      case 'highlighted-only':
        return `${NODE_BORDER.HIGHLIGHT_WIDTH} solid ${NODE_BORDER.HIGHLIGHT_COLOR}`;
      default:
        if (isExternal) {
          return `${NODE_BORDER.NORMAL_WIDTH} dashed ${borderColor}`;
        }
        return `${NODE_BORDER.NORMAL_WIDTH} solid ${borderColor}`;
    }
  };

  // 根据状态优先级确定阴影效果
  const getBoxShadow = (): string => {
    const statePriority = getNodeStatePriority(isSelected, isHighlighted);

    switch (statePriority) {
      case 'selected':
        // 同时选中和高亮：使用紫色光晕避免视觉混乱
        return NODE_SHADOW.SELECTED_AND_HIGHLIGHT;
      case 'selected-only':
        return NODE_SHADOW.SELECT;
      case 'highlighted-only':
        return NODE_SHADOW.HIGHLIGHT;
      default:
        return 'none';
    }
  };

  // Handle single-click to open file in VS Code
  // NOTE: We don't call e.stopPropagation() to allow ReactFlow's selection to work
  const handleClick = (e: React.MouseEvent) => {
    data.onNodeClick();
  };

  // Handle double-click to show the file's graph view (not symbol view)
  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    // 双击：打开文件（不跳过 graph update）+ 更新到该文件的 graph view
    // 优先使用 onShowGraphView，如果不存在则回退到 onDrillDown
    if (data.onShowGraphView) {
      data.onShowGraphView();
    } else {
      data.onDrillDown();
    }
  };

  // Handle keyboard interactions for accessibility
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.stopPropagation();
      handleClick(e as unknown as React.MouseEvent);
    }
  };

  return (
    <button
      type="button"
      style={{ 
        position: 'relative', 
        width: '100%', 
        height: '100%',
        border: 'none',
        padding: 0,
        background: 'transparent',
        cursor: 'pointer'
      }}
      title={data.fullPath}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
    >
      <Handle type="target" position={Position.Left} style={{ visibility: 'hidden' }} />

      {/* Language icon in top-left corner */}
      <LanguageIcon filePath={data.fullPath} label={data.label} />

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          background: data.isRoot ? borderColor : 'var(--vscode-editor-background)',
          color: data.isRoot ? '#000' : 'var(--vscode-editor-foreground)',
          border: getBorderStyle(),
          borderRadius: 4,
          padding: data.showReferencingPaths && data.referencingPaths && data.referencingPaths.length > 0 ? '6px 8px' : '0 12px',
          fontSize: 12,
          fontWeight: data.isRoot ? 'bold' : 'normal',
          fontStyle: isExternal ? 'italic' : 'normal',
          fontFamily: 'var(--vscode-font-family)',
          pointerEvents: 'none',
          boxShadow: getBoxShadow(),
          gap: '3px',
        }}
      >
        {/* 文件名（可选追加文件总行数，如 app.py:800） */}
        <div>
          {data.label}
          {data.showFileLineCounts && typeof data.lineCount === 'number'
            ? `:${data.lineCount}`
            : ''}
        </div>
      </div>

      {/* 模块路径:绝对定位挂在节点外部底部,脱离内容流,不挤压文件名。
          完整显示(溢出不受节点宽度限制),底色块+描边保证与边/画布重叠时可读;
          被相邻实心节点遮挡时,点选本节点(z-index 提升)可浮顶。 */}
      {data.showModulePath && data.modulePath && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            marginTop: 3,
            fontSize: '9px',
            color: 'var(--vscode-descriptionForeground)',
            whiteSpace: 'nowrap',
            opacity: 0.9,
            zIndex: 1,
            padding: '0 4px',
            borderRadius: 3,
            background: 'var(--vscode-editor-background)',
            boxShadow: '0 0 0 1px var(--vscode-widget-border)',
          }}
          title={`Module path: ${data.modulePath}`}
        >
          {data.modulePath}
        </div>
      )}

      {data.isInCycle && (
        <div
          style={{
            position: 'absolute',
            top: -(cycleIndicatorSize / 2),
            right: -(cycleIndicatorSize / 2),
            width: cycleIndicatorSize,
            height: cycleIndicatorSize,
            borderRadius: '50%',
            background: '#dc3545',
            border: '2px solid var(--vscode-editor-background)',
            zIndex: 15,
            pointerEvents: 'none',
          }}
          title="Part of circular dependency"
        />
      )}

      {data.hasChildren && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (data.isExpanded) data.onToggle();
            else data.onExpandRequest();
          }}
          aria-label={data.isExpanded ? 'Collapse node' : 'Expand node'}
          style={{
            position: 'absolute',
            right: -(actionButtonSize / 2),
            top: '50%',
            transform: 'translateY(-50%)',
            width: actionButtonSize,
            height: actionButtonSize,
            borderRadius: '50%',
            background: 'var(--vscode-button-background)',
            color: 'var(--vscode-button-foreground)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            fontSize: 14,
            zIndex: 10,
            pointerEvents: 'auto',
            border: '2px solid var(--vscode-editor-background)',
            padding: 0,
          }}
        >
          {data.isExpanded ? (
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12h14" />
            </svg>
          ) : (
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
          )}
        </button>
      )}

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          data.onDrillDown();
        }}
        aria-label="View symbols"
        title="View symbols"
        style={{
          position: 'absolute',
          right: -(actionButtonSize / 2),
          bottom: -(actionButtonSize / 2),
          width: actionButtonSize,
          height: actionButtonSize,
          borderRadius: '50%',
          background: 'var(--vscode-button-secondaryBackground)',
          color: 'var(--vscode-button-secondaryForeground)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          fontSize: 10,
          fontWeight: 'bold',
          zIndex: 10,
          pointerEvents: 'auto',
          border: '2px solid var(--vscode-editor-background)',
          padding: 0,
        }}
      >
        ✨
      </button>

      {data.isRoot && data.hasReferencingFiles && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            data.onToggleParents?.();
          }}
          aria-label={data.isParentsVisible ? 'Hide referencing files' : 'Show referencing files'}
          title={data.isParentsVisible ? 'Hide referencing files' : 'Show referencing files'}
          style={{
            position: 'absolute',
            left: -(actionButtonSize + 4),
            top: '50%',
            transform: 'translateY(-50%)',
            width: actionButtonSize,
            height: actionButtonSize,
            borderRadius: '50%',
            background: 'var(--vscode-button-secondaryBackground)',
            color: 'var(--vscode-button-secondaryForeground)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            fontSize: 10,
            fontWeight: 'bold',
            zIndex: 10,
            pointerEvents: 'auto',
            border: '2px solid var(--vscode-editor-background)',
            padding: 0,
          }}
        >
          {data.isParentsVisible ? '◀' : '▶'}
        </button>
      )}

      <Handle type="source" position={Position.Right} style={{ visibility: 'hidden' }} />
    </button>
  );
},
// Custom comparator: compare only data props, never callback props.
// Callbacks change reference on every parent render and would cause constant re-renders.
(prev, next) => {
  const pd = prev.data;
  const nd = next.data;
  return (
    prev.id === next.id &&
    pd.label === nd.label &&
    pd.fullPath === nd.fullPath &&
    pd.isRoot === nd.isRoot &&
    pd.isParent === nd.isParent &&
    pd.isInCycle === nd.isInCycle &&
    pd.hasChildren === nd.hasChildren &&
    pd.isExpanded === nd.isExpanded &&
    pd.hasReferencingFiles === nd.hasReferencingFiles &&
    pd.parentCount === nd.parentCount &&
    pd.isParentsVisible === nd.isParentsVisible &&
    pd.selectedNodeId === nd.selectedNodeId &&
    pd.nodeId === nd.nodeId &&
    pd.showModulePath === nd.showModulePath && // Add showModulePath comparison
    pd.modulePath === nd.modulePath && // Add modulePath comparison
    pd.isHighlighted === nd.isHighlighted && // Add isHighlighted comparison
    pd.isHighlightActive === nd.isHighlightActive && // Add isHighlightActive comparison
    pd.lineCount === nd.lineCount &&
    pd.showFileLineCounts === nd.showFileLineCounts
  );
});
