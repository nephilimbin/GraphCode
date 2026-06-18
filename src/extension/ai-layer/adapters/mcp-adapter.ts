/**
 * MCP Adapter Module
 *
 * Adapter for Model Context Protocol (MCP) servers.
 */

/**
 * MCP resource type
 */
export type McpResourceType = 'tool' | 'prompt' | 'resource';

/**
 * MCP resource
 */
export interface McpResource {
  id: string;
  name: string;
  description?: string;
  type: McpResourceType;
  metadata?: Record<string, unknown>;
}

/**
 * MCP request
 */
export interface McpRequest {
  resourceId: string;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * MCP response
 */
export interface McpResponse {
  success: boolean;
  data?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
}

/**
 * MCP server configuration
 */
export interface McpServerConfig {
  name: string;
  endpoint?: string;
  enabled?: boolean;
  timeout?: number;
}

/**
 * MCP adapter configuration
 */
export interface McpAdapterConfig {
  servers?: McpServerConfig[];
  enableDiscovery?: boolean;
  defaultTimeout?: number;
}

/**
 * MCP adapter interface
 */
export interface IMcpAdapter {
  /**
   * Connect to an MCP server
   */
  connect(serverConfig: McpServerConfig): Promise<void>;

  /**
   * Disconnect from an MCP server
   */
  disconnect(serverName: string): Promise<void>;

  /**
   * List all available resources
   */
  listResources(serverName?: string): Promise<McpResource[]>;

  /**
   * Call an MCP resource
   */
  callResource(request: McpRequest): Promise<McpResponse>;

  /**
   * Discover MCP servers (if discovery is enabled)
   */
  discoverServers(): Promise<McpServerConfig[]>;

  /**
   * Get connected servers
   */
  getConnectedServers(): string[];

  /**
   * Check if a server is connected
   */
  isConnected(serverName: string): boolean;

  /**
   * Clear all connections and caches
   */
  clear(): void;

  /**
   * Get adapter statistics
   */
  getStats(): {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
  };
}

/**
 * MCP Adapter implementation
 */
export class McpAdapter implements IMcpAdapter {
  private servers: Map<string, McpServerConfig> = new Map();
  private serverResources: Map<string, McpResource[]> = new Map();
  private config: Required<McpAdapterConfig>;
  private stats = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
  };

  constructor(config: McpAdapterConfig = {}) {
    this.config = {
      servers: config.servers ?? [],
      enableDiscovery: config.enableDiscovery ?? false,
      defaultTimeout: config.defaultTimeout ?? 10000,
    };

    // Initialize configured servers
    for (const server of this.config.servers) {
      if (server.enabled !== false) {
        this.servers.set(server.name, server);
      }
    }
  }

  async connect(serverConfig: McpServerConfig): Promise<void> {
    if (this.servers.has(serverConfig.name)) {
      throw new Error(`Server "${serverConfig.name}" is already connected`);
    }

    // Simulate connection (in production, would establish actual connection)
    await this.delay(100);

    this.servers.set(serverConfig.name, {
      ...serverConfig,
      enabled: true,
    });

    // Fetch resources for this server
    const resources = await this.fetchServerResources(serverConfig.name);
    this.serverResources.set(serverConfig.name, resources);
  }

  async disconnect(serverName: string): Promise<void> {
    if (!this.servers.has(serverName)) {
      throw new Error(`Server "${serverName}" is not connected`);
    }

    // Simulate disconnection
    await this.delay(50);

    this.servers.delete(serverName);
    this.serverResources.delete(serverName);
  }

  async listResources(serverName?: string): Promise<McpResource[]> {
    if (serverName) {
      return this.serverResources.get(serverName) ?? [];
    }

    // Return resources from all servers
    const allResources: McpResource[] = [];
    for (const resources of this.serverResources.values()) {
      allResources.push(...resources);
    }

    return allResources;
  }

  async callResource(request: McpRequest): Promise<McpResponse> {
    this.stats.totalRequests++;

    try {
      // Find the server that has this resource
      let targetServer: string | null = null;

      for (const [serverName, resources] of this.serverResources) {
        if (resources.some(r => r.id === request.resourceId)) {
          targetServer = serverName;
          break;
        }
      }

      if (!targetServer) {
        throw new Error(`Resource "${request.resourceId}" not found`);
      }

      const serverConfig = this.servers.get(targetServer);
      if (!serverConfig) {
        throw new Error(`Server "${targetServer}" is not connected`);
      }

      // Simulate MCP call (in production, would make actual request)
      const response = await this.simulateMcpCall(request, serverConfig);

      this.stats.successfulRequests++;
      return response;
    } catch (error) {
      this.stats.failedRequests++;
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async discoverServers(): Promise<McpServerConfig[]> {
    if (!this.config.enableDiscovery) {
      return [];
    }

    // Simulate server discovery (in production, would use mDNS or other discovery)
    await this.delay(500);

    return [
      {
        name: 'discovered-server-1',
        endpoint: 'http://localhost:3001',
        enabled: true,
      },
    ];
  }

  getConnectedServers(): string[] {
    return Array.from(this.servers.keys());
  }

  isConnected(serverName: string): boolean {
    return this.servers.has(serverName);
  }

  clear(): void {
    this.servers.clear();
    this.serverResources.clear();
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
    };
  }

  getStats() {
    return { ...this.stats };
  }

  /**
   * Fetch resources from a server (simulated)
   */
  private async fetchServerResources(serverName: string): Promise<McpResource[]> {
    // Simulate fetching resources (in production, would query server)
    await this.delay(100);

    return [
      {
        id: `${serverName}-tool-1`,
        name: 'Tool 1',
        description: `Tool 1 from ${serverName}`,
        type: 'tool',
      },
      {
        id: `${serverName}-resource-1`,
        name: 'Resource 1',
        description: `Resource 1 from ${serverName}`,
        type: 'resource',
      },
    ];
  }

  /**
   * Simulate MCP call (placeholder implementation)
   */
  private async simulateMcpCall(
    request: McpRequest,
    serverConfig: McpServerConfig
  ): Promise<McpResponse> {
    const timeout = serverConfig.timeout ?? this.config.defaultTimeout;

    // Simulate network delay
    await this.delay(Math.random() * 200);

    return {
      success: true,
      data: {
        result: `Simulated response from ${serverConfig.name} for ${request.resourceId}`,
        params: request.params,
      },
      metadata: {
        server: serverConfig.name,
        timestamp: Date.now(),
      },
    };
  }

  /**
   * Delay utility
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Create an MCP adapter
 */
export function createMcpAdapter(config?: McpAdapterConfig): IMcpAdapter {
  return new McpAdapter(config);
}
