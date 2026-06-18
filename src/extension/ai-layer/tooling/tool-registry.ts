/**
 * Tool Registry Module
 *
 * Manages registration and invocation of AI tools.
 */

/**
 * Tool execution context
 */
export interface ToolContext {
  sessionId?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Tool definition
 */
export interface Tool {
  id: string;
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: (params: unknown, context: ToolContext) => Promise<unknown>;
  category?: string;
  enabled?: boolean;
}

/**
 * Tool execution result
 */
export interface ToolExecutionResult {
  toolId: string;
  success: boolean;
  result?: unknown;
  error?: string;
  duration: number;
}

/**
 * Tool registry configuration
 */
export interface ToolRegistryConfig {
  enableLogging?: boolean;
  maxExecutionTime?: number;
}

/**
 * Tool registry interface
 */
export interface IToolRegistry {
  /**
   * Register a tool
   */
  registerTool(tool: Tool): void;

  /**
   * Unregister a tool
   */
  unregisterTool(toolId: string): void;

  /**
   * Get a tool by ID
   */
  getTool(toolId: string): Tool | null;

  /**
   * Get all tools
   */
  getAllTools(): Tool[];

  /**
   * Get tools by category
   */
  getToolsByCategory(category: string): Tool[];

  /**
   * Execute a tool
   */
  executeTool(
    toolId: string,
    params: unknown,
    context?: ToolContext
  ): Promise<ToolExecutionResult>;

  /**
   * Enable/disable a tool
   */
  setToolEnabled(toolId: string, enabled: boolean): void;

  /**
   * Check if a tool is enabled
   */
  isToolEnabled(toolId: string): boolean;

  /**
   * Get tool categories
   */
  getCategories(): string[];

  /**
   * Clear all tools
   */
  clear(): void;

  /**
   * Get execution statistics
   */
  getStats(): {
    totalExecutions: number;
    successfulExecutions: number;
    failedExecutions: number;
    averageExecutionTime: number;
  };
}

/**
 * Tool Registry implementation
 */
export class ToolRegistry implements IToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private config: Required<ToolRegistryConfig>;
  private stats = {
    totalExecutions: 0,
    successfulExecutions: 0,
    failedExecutions: 0,
    totalExecutionTime: 0,
  };

  constructor(config: ToolRegistryConfig = {}) {
    this.config = {
      enableLogging: config.enableLogging ?? false,
      maxExecutionTime: config.maxExecutionTime ?? 30000,
    };
  }

  registerTool(tool: Tool): void {
    if (this.tools.has(tool.id)) {
      throw new Error(`Tool with ID "${tool.id}" is already registered`);
    }

    this.tools.set(tool.id, {
      ...tool,
      enabled: tool.enabled ?? true,
    });

    if (this.config.enableLogging) {
      console.log(`[ToolRegistry] Tool registered: ${tool.id}`);
    }
  }

  unregisterTool(toolId: string): void {
    if (!this.tools.has(toolId)) {
      throw new Error(`Tool with ID "${toolId}" is not registered`);
    }

    this.tools.delete(toolId);

    if (this.config.enableLogging) {
      console.log(`[ToolRegistry] Tool unregistered: ${toolId}`);
    }
  }

  getTool(toolId: string): Tool | null {
    return this.tools.get(toolId) ?? null;
  }

  getAllTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  getToolsByCategory(category: string): Tool[] {
    return this.getAllTools().filter(tool => tool.category === category);
  }

  async executeTool(
    toolId: string,
    params: unknown,
    context: ToolContext = {}
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    const tool = this.getTool(toolId);

    if (!tool) {
      return {
        toolId,
        success: false,
        error: `Tool not found: ${toolId}`,
        duration: Date.now() - startTime,
      };
    }

    if (!tool.enabled) {
      return {
        toolId,
        success: false,
        error: `Tool is disabled: ${toolId}`,
        duration: Date.now() - startTime,
      };
    }

    this.stats.totalExecutions++;

    try {
      if (this.config.enableLogging) {
        console.log(`[ToolRegistry] Executing tool: ${toolId}`, params);
      }

      // Execute with timeout
      const result = await this.withTimeout(
        tool.handler(params, context),
        this.config.maxExecutionTime
      );

      const duration = Date.now() - startTime;

      this.stats.successfulExecutions++;
      this.stats.totalExecutionTime += duration;

      if (this.config.enableLogging) {
        console.log(`[ToolRegistry] Tool executed successfully: ${toolId}`);
      }

      return {
        toolId,
        success: true,
        result,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.stats.failedExecutions++;

      if (this.config.enableLogging) {
        console.error(`[ToolRegistry] Tool execution failed: ${toolId}`, error);
      }

      return {
        toolId,
        success: false,
        error: errorMessage,
        duration,
      };
    }
  }

  setToolEnabled(toolId: string, enabled: boolean): void {
    const tool = this.getTool(toolId);
    if (!tool) {
      throw new Error(`Tool not found: ${toolId}`);
    }

    tool.enabled = enabled;
  }

  isToolEnabled(toolId: string): boolean {
    const tool = this.getTool(toolId);
    return tool?.enabled ?? false;
  }

  getCategories(): string[] {
    const categories = new Set<string>();
    for (const tool of this.tools.values()) {
      if (tool.category) {
        categories.add(tool.category);
      }
    }
    return Array.from(categories);
  }

  clear(): void {
    this.tools.clear();
    this.stats = {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      totalExecutionTime: 0,
    };
  }

  getStats() {
    return {
      totalExecutions: this.stats.totalExecutions,
      successfulExecutions: this.stats.successfulExecutions,
      failedExecutions: this.stats.failedExecutions,
      averageExecutionTime:
        this.stats.totalExecutions > 0
          ? this.stats.totalExecutionTime / this.stats.totalExecutions
          : 0,
    };
  }

  /**
   * Add timeout to promise
   */
  private async withTimeout<T>(promise: Promise<T>, timeout: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('Tool execution timeout')), timeout)
      ),
    ]);
  }
}

/**
 * Create a tool registry
 */
export function createToolRegistry(
  config?: ToolRegistryConfig
): IToolRegistry {
  return new ToolRegistry(config);
}
