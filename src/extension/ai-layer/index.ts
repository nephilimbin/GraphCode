/**
 * AILayer Module
 *
 * 所有 AI 相关功能的统一模块。
 *
 * ⚠️ **实验性功能** - 此模块包含 AI 功能，当前未在生产代码中使用。
 *
 * 如果 AI 功能不需要，可以安全删除整个 ai-layer 目录：
 * ```bash
 * rm -rf src/extension/ai-layer/
 * ```
 *
 * ## 包含的功能
 *
 * ### 工具注册 (ToolRegistry)
 * 管理 AI 工具的注册、执行和统计
 *
 * ### VS Code LM 适配器 (VsCodeLMAdapter)
 * 连接到 VS Code Language Model API
 *
 * ### MCP 适配器 (McpAdapter)
 * 连接到 Model Context Protocol 服务
 *
 * ## 使用状态
 *
 * - 📅 **当前状态**: 未集成到生产代码
 * - 🔧 **开发状态**: 实验性功能
 * - 📋 **计划**: 未来可能的 AI 功能集成
 *
 * ## 集成示例 (未来)
 *
 * ```typescript
 * import { ToolRegistry, VsCodeLMAdapter } from './ai-layer';
 *
 * // 注册 AI 工具
 * const toolRegistry = new ToolRegistry();
 * toolRegistry.registerTool({
 *   id: 'code-analysis',
 *   name: 'Code Analysis Tool',
 *   description: 'Code analysis functionality',
 *   handler: async (params) => {
 *     // ... implementation
 *     return params;
 *   }
 * });
 *
 * // 连接到 LM API
 * const lmAdapter = new VsCodeLMAdapter();
 * const response = await lmAdapter.sendMessage([
 *   { role: 'user', content: 'Analyze this code' }
 * ]);
 * ```
 */

// Tool exports
export { ToolRegistry } from './tooling/tool-registry';
export { createToolRegistry } from './tooling/tool-registry';
export type { IToolRegistry } from './tooling/tool-registry';
export type { Tool } from './tooling/tool-registry';
export type { ToolContext } from './tooling/tool-registry';
export type { ToolExecutionResult } from './tooling/tool-registry';
export type { ToolRegistryConfig } from './tooling/tool-registry';

// Adapter exports
export { VsCodeLMAdapter } from './adapters/vscode-lm-adapter';
export { createVsCodeLMAdapter } from './adapters/vscode-lm-adapter';
export type { IVsCodeLMAdapter } from './adapters/vscode-lm-adapter';
export type { LMMessage } from './adapters/vscode-lm-adapter';
export type { LMRequestOptions } from './adapters/vscode-lm-adapter';
export type { LMResponse } from './adapters/vscode-lm-adapter';
export type { VsCodeLMAdapterConfig } from './adapters/vscode-lm-adapter';

export { McpAdapter } from './adapters/mcp-adapter';
export { createMcpAdapter } from './adapters/mcp-adapter';
export type { IMcpAdapter } from './adapters/mcp-adapter';

/**
 * 检查 AI 层是否可用
 */
export function isAILayerAvailable(): boolean {
  // AI 层存在但当前未在生产中使用
  return true;
}

/**
 * 获取 AI 层信息
 */
export function getAILayerInfo() {
  return {
    version: '1.0.0',
    status: 'experimental' as const,
    features: [
      'tool-registry',
      'vscode-lm-adapter',
      'mcp-adapter',
    ] as const,
    usage: 'Currently not integrated into production code',
    canBeSafelyDeleted: true,
  };
}

/**
 * AILayer 统一接口
 */
export interface IAILayer {
  toolRegistry: import('./tooling/tool-registry').IToolRegistry;
  vscodeLMAdapter: import('./adapters/vscode-lm-adapter').IVsCodeLMAdapter;
  mcpAdapter: import('./adapters/mcp-adapter').IMcpAdapter;
}

/**
 * 创建 AILayer 实例
 *
 * @example
 * ```typescript
 * const aiLayer = createAILayer();
 *
 * // 注册工具
 * aiLayer.toolRegistry.registerTool({
 *   id: 'my-tool',
 *   name: 'My Tool',
 *   // ...
 * });
 *
 * // 使用 LM 适配器
 * const response = await aiLayer.vscodeLMAdapter.sendMessage([...]);
 * ```
 */
export function createAILayer(): IAILayer {
  const { ToolRegistry } = require('./tooling/tool-registry');
  const { VsCodeLMAdapter } = require('./adapters/vscode-lm-adapter');
  const { McpAdapter } = require('./adapters/mcp-adapter');

  return {
    toolRegistry: new ToolRegistry(),
    vscodeLMAdapter: new VsCodeLMAdapter(),
    mcpAdapter: new McpAdapter(),
  };
}
