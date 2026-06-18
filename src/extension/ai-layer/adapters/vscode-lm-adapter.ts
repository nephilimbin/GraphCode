/**
 * VS Code LM Adapter Module
 *
 * Adapter for VS Code Language Model API.
 */

/**
 * LM message type
 */
export interface LMMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * LM request options
 */
export interface LMRequestOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

/**
 * LM response
 */
export interface LMResponse {
  content: string;
  finishReason?: 'stop' | 'length' | 'error';
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * VS Code LM adapter configuration
 */
export interface VsCodeLMAdapterConfig {
  defaultModel?: string;
  defaultTemperature?: number;
  defaultMaxTokens?: number;
  enableCaching?: boolean;
}

/**
 * VS Code LM adapter interface
 */
export interface IVsCodeLMAdapter {
  /**
   * Send a message to the language model
   */
  sendMessage(
    messages: LMMessage[],
    options?: LMRequestOptions
  ): Promise<LMResponse>;

  /**
   * Stream a message response
   */
  streamMessage(
    messages: LMMessage[],
    options?: LMRequestOptions,
    callback?: (chunk: string) => void
  ): AsyncGenerator<string>;

  /**
   * Estimate token count for text
   */
  estimateTokens(text: string): number;

  /**
   * Get available models
   */
  getAvailableModels(): string[];

  /**
   * Check if adapter is available
   */
  isAvailable(): boolean;

  /**
   * Clear cache
   */
  clearCache(): void;
}

/**
 * VS Code LM Adapter implementation
 */
export class VsCodeLMAdapter implements IVsCodeLMAdapter {
  private config: Required<VsCodeLMAdapterConfig>;
  private cache: Map<string, LMResponse> = new Map();

  // Simulated available models (in production, would query VS Code API)
  private readonly availableModels = [
    'gpt-4',
    'gpt-3.5-turbo',
    'claude-3-opus',
    'claude-3-sonnet',
  ];

  constructor(config: VsCodeLMAdapterConfig = {}) {
    this.config = {
      defaultModel: config.defaultModel ?? 'gpt-4',
      defaultTemperature: config.defaultTemperature ?? 0.7,
      defaultMaxTokens: config.defaultMaxTokens ?? 2048,
      enableCaching: config.enableCaching ?? true,
    };
  }

  async sendMessage(
    messages: LMMessage[],
    options?: LMRequestOptions
  ): Promise<LMResponse> {
    const opts = {
      model: options?.model ?? this.config.defaultModel,
      temperature: options?.temperature ?? this.config.defaultTemperature,
      maxTokens: options?.maxTokens ?? this.config.defaultMaxTokens,
    };

    // Create cache key
    const cacheKey = this.createCacheKey(messages, opts);

    if (this.config.enableCaching && this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    // Simulate LM API call (in production, would call VS Code LM API)
    const response = await this.simulateLMResponse(messages, opts);

    // Cache response
    if (this.config.enableCaching) {
      this.cache.set(cacheKey, response);
    }

    return response;
  }

  async *streamMessage(
    messages: LMMessage[],
    options?: LMRequestOptions,
    callback?: (chunk: string) => void
  ): AsyncGenerator<string> {
    const opts = {
      model: options?.model ?? this.config.defaultModel,
      temperature: options?.temperature ?? this.config.defaultTemperature,
      maxTokens: options?.maxTokens ?? this.config.defaultMaxTokens,
    };

    // Simulate streaming response (in production, would stream from VS Code LM API)
    const response = await this.sendMessage(messages, opts);
    const chunks = this.splitIntoChunks(response.content, 10);

    for (const chunk of chunks) {
      if (callback) {
        callback(chunk);
      }
      yield chunk;
      await this.delay(50); // Simulate network delay
    }
  }

  estimateTokens(text: string): number {
    // Rough estimation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  getAvailableModels(): string[] {
    return [...this.availableModels];
  }

  isAvailable(): boolean {
    // In production, would check if VS Code LM API is available
    return true;
  }

  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Simulate LM response (placeholder implementation)
   */
  private async simulateLMResponse(
    messages: LMMessage[],
    options: LMRequestOptions
  ): Promise<LMResponse> {
    // Simulate API delay
    await this.delay(500);

    const lastMessage = messages[messages.length - 1];

    return {
      content: `Simulated response to: "${lastMessage.content.substring(0, 50)}..."`,
      finishReason: 'stop',
      usage: {
        promptTokens: this.estimateTokens(
          messages.map(m => m.content).join('\n')
        ),
        completionTokens: 50,
        totalTokens: 0,
      },
    };
  }

  /**
   * Create cache key from messages and options
   */
  private createCacheKey(
    messages: LMMessage[],
    options: LMRequestOptions
  ): string {
    const messagesStr = JSON.stringify(messages);
    const optionsStr = JSON.stringify(options);
    return `${messagesStr}-${optionsStr}`;
  }

  /**
   * Split text into chunks for streaming
   */
  private splitIntoChunks(text: string, chunkSize: number): string[] {
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += chunkSize) {
      chunks.push(text.substring(i, i + chunkSize));
    }
    return chunks;
  }

  /**
   * Delay utility
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Create a VS Code LM adapter
 */
export function createVsCodeLMAdapter(
  config?: VsCodeLMAdapterConfig
): IVsCodeLMAdapter {
  return new VsCodeLMAdapter(config);
}
