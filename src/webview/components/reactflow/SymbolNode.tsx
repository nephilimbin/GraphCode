import React from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { CATEGORY_ICONS, getSymbolStyle } from '../../utils/symbolUtils';
import { NODE_BORDER, NODE_SHADOW, getNodeStatePriority } from '../../utils/nodeStyles';

export interface SymbolNodeData {
    label: string;
    fullPath: string; // 符号 ID（格式：path:name）
    kind: string; // 符号类型：'Function', 'Class' 等
    category: string; // 符号分类：'function', 'class' 等
    line: number;
    isExported: boolean;
    isRoot: boolean;
    isExternal?: boolean; // 是否为外部符号（从其他文件导入的）
    onNodeClick: () => void;
    onDrillDown: () => void;
    onHighlight?: (symbolId: string) => void; // 双击高亮处理函数
    // 展开/收起相关属性
    hasChildren?: boolean;
    isExpanded?: boolean;
    onToggle?: () => void;
    onExpandRequest?: () => void;
    selectedNodeId?: string | null;
    nodeId?: string;
    // 高亮状态
    isHighlighted?: boolean;
    isHighlightActive?: boolean; // 高亮模式是否激活
}

const actionButtonSize = 20;

export const SymbolNode = React.memo<NodeProps<SymbolNodeData>>(function SymbolNode({ data, id }) {
    const style = getSymbolStyle(data.category);
    const icon = CATEGORY_ICONS[data.category] || '?';

    // T090: 为外部引用应用淡化样式（FR-022）
    const isExternal = data.isExternal ?? false;

    // 根据高亮状态确定透明度
    let opacity = 1;
    if (isExternal) {
        opacity = 0.5;
    } else if (data.isHighlightActive && !data.isHighlighted) {
        opacity = 0.3; // 高亮模式激活时，淡化非高亮节点
    }

    const borderStyle = isExternal ? 'dashed' : 'solid';
    const isSelected = data.selectedNodeId === (data.nodeId || id);

    // 处理单击事件：导航到代码中的符号位置
    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        data.onNodeClick();
    };

    // 处理双击事件：深入查看符号详情
    // 注意：高亮功能仅在 File 模式可用，Symbol 模式不支持
    const handleDoubleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        // Symbol 模式下，双击总是执行深入操作
        // File 模式下，高亮由单击处理（直接连接）
        data.onDrillDown();
    };

    // 根据状态优先级确定阴影效果
    const getBoxShadow = (): string => {
        const statePriority = getNodeStatePriority(isSelected, data.isHighlighted ?? false);

        switch (statePriority) {
            case 'selected':
                // 同时选中和高亮：使用紫色光晕避免视觉混乱
                return NODE_SHADOW.SELECTED_AND_HIGHLIGHT;
            case 'selected-only':
                return NODE_SHADOW.SELECT;
            case 'highlighted-only':
                return NODE_SHADOW.HIGHLIGHT;
            default:
                if (data.isRoot) return '0 0 10px rgba(0,0,0,0.2)';
                return 'none';
        }
    };

    // 根据状态优先级确定边框样式
    const getBorder = (): string => {
        const statePriority = getNodeStatePriority(isSelected, data.isHighlighted ?? false);

        switch (statePriority) {
            case 'selected':
            case 'selected-only':
                return `${NODE_BORDER.SELECTED_WIDTH} solid ${NODE_BORDER.SELECTED_COLOR}`;
            case 'highlighted-only':
                return `${NODE_BORDER.HIGHLIGHT_WIDTH} solid ${NODE_BORDER.HIGHLIGHT_COLOR}`;
            default:
                return `${NODE_BORDER.NORMAL_WIDTH} ${borderStyle} ${style.border}`;
        }
    };

    return (
        <button
            type="button"
            style={{
                position: 'relative',
                width: 40,
                height: 40,
                borderRadius: '50%',
                background: data.isRoot ? style.bg : 'var(--vscode-editor-background)',
                border: getBorder(),
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: getBoxShadow(),
                cursor: 'pointer',
                opacity,
                padding: 0,
            }}
            title={`${data.kind}: ${data.label} (Line ${data.line})${isExternal ? ' [External]' : ''}${isSelected ? ' [Selected]' : ''}${data.isHighlighted ? ' [Highlighted]' : ''}`}
            onClick={handleClick}
            onDoubleClick={handleDoubleClick}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleClick(e as unknown as React.MouseEvent);
                }
            }}
        >
            <Handle type="target" position={Position.Left} style={{ visibility: 'hidden' }} />

            <div style={{
                fontSize: 14,
                fontWeight: 'bold',
                color: data.isRoot ? style.text : 'var(--vscode-editor-foreground)',
            }}>
                {icon}
            </div>

            {/* Label below the node */}
            <div style={{
                position: 'absolute',
                top: 42,
                left: '50%',
                transform: 'translateX(-50%)',
                whiteSpace: 'nowrap',
                fontSize: 10,
                color: 'var(--vscode-editor-foreground)',
                background: 'var(--vscode-editor-background)',
                padding: '2px 4px',
                borderRadius: 4,
                border: '1px solid var(--vscode-widget-border)',
                zIndex: 10,
                pointerEvents: 'none',
                fontStyle: isExternal ? 'italic' : 'normal',
                opacity,
            }}>
                {data.label}
            </div>

            {
                data.isExported && (
                    <div style={{
                        position: 'absolute',
                        top: -4,
                        right: -4,
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: 'var(--vscode-badge-background)',
                        border: '1px solid var(--vscode-editor-background)',
                    }} title="Exported" />
                )
            }

            {/* Expansion Button */}
            {data.hasChildren && (
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        if (data.isExpanded) data.onToggle?.();
                        else data.onExpandRequest?.();
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
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M5 12h14" />
                        </svg>
                    ) : (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 5v14M5 12h14" />
                        </svg>
                    )}
                </button>
            )}

            <Handle type="source" position={Position.Right} style={{ visibility: 'hidden' }} />
        </button >
    );
},
// Custom comparator: compare visual/state fields only.
// Callback props are intentionally ignored because references can change
// frequently without changing rendered output.
(prev, next) => {
    const pd = prev.data;
    const nd = next.data;

    return (
        prev.id === next.id
        && pd.label === nd.label
        && pd.fullPath === nd.fullPath
        && pd.kind === nd.kind
        && pd.category === nd.category
        && pd.line === nd.line
        && pd.isExported === nd.isExported
        && pd.isRoot === nd.isRoot
        && pd.isExternal === nd.isExternal
        && pd.hasChildren === nd.hasChildren
        && pd.isExpanded === nd.isExpanded
        && pd.selectedNodeId === nd.selectedNodeId
        && pd.nodeId === nd.nodeId
        && pd.isHighlighted === nd.isHighlighted
        && pd.isHighlightActive === nd.isHighlightActive
    );
});
