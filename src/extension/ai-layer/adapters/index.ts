/**
 * AI Adapters Module
 *
 * 所有 AI 适配器的统一导出。
 */

export {
  VsCodeLMAdapter,
  createVsCodeLMAdapter,
  type IVsCodeLMAdapter,
  type LMMessage,
  type LMRequestOptions,
  type LMResponse,
  type VsCodeLMAdapterConfig,
} from './vscode-lm-adapter';

export {
  McpAdapter,
  createMcpAdapter,
  type IMcpAdapter,
} from './mcp-adapter';
