# Logger Module

## 职责

提供统一的日志接口和可配置的日志级别，支持多种日志实现。

## 导出

### 从 `@/foundation/logger` 导入：

```typescript
import {
  getLogger,           // 获取 logger 实例
  setLoggerBackend,    // 设置日志后端
  ConsoleLogger,       // Console 实现
  StderrLogger,       // Stderr 实现（用于 MCP 服务器）
  NullLogger,          // 空实现（用于测试）
  loggerFactory,       // Logger 工厂
  type LogLevel,       // 日志级别类型
  type ILogger,        // Logger 接口
  type LoggerBackend,  // Logger 后端接口
  LOG_LEVEL_PRIORITY,  // 日志级别优先级
} from '@/foundation/logger';
```

## 核心功能

### 日志级别

支持的日志级别（按优先级从低到高）：
- `debug` - 调试信息（0）
- `info` - 一般信息（1）
- `warn` - 警告信息（2）
- `error` - 错误信息（3）
- `none` - 不输出日志（4）

### 使用示例

#### 基本使用

```typescript
import { getLogger } from '@/foundation/logger';

const logger = getLogger('MyModule');

logger.debug('Debugging information');
logger.info('Process started');
logger.warn('Configuration file not found, using defaults');
logger.error('Failed to connect to database', error);

// 设置日志级别
logger.setLevel('warn'); // 只输出 warn 和 error
```

#### 设置全局日志后端

```typescript
import { setLoggerBackend } from '@/foundation/logger';
import { VSCodeOutputChannelBackend } from '@/extension/logging';

// 在扩展激活时
setLoggerBackend(new VSCodeOutputChannelBackend());

// 所有现有的 logger 实例会自动使用新的后端
```

#### MCP 服务器使用 StderrLogger

```typescript
import { StderrLogger } from '@/foundation/logger';

// MCP 服务器必须将所有日志写入 stderr，保持 stdout 用于 JSON-RPC
const logger = new StderrLogger('MCPServer', 'info');
logger.info('Server started');
```

#### 测试使用 NullLogger

```typescript
import { NullLogger } from '@/foundation/logger';

// 禁用日志输出
const logger = new NullLogger();
logger.info('This will not be output');
```

## Logger 实现

### ConsoleLogger

默认实现，使用 Node.js stdout/stderr：
- `debug` 和 `info` → stdout
- `warn` 和 `error` → stderr

**消息格式：**
```
2025-01-15T10:30:45.123Z [ModuleName] [INFO] Test message
```

### StderrLogger

所有日志写入 stderr，适用于 MCP 服务器等场景：
- 所有日志级别 → stderr

**用途：** 保持 stdout 干净，用于 JSON-RPC 通信

### NullLogger

丢弃所有日志，适用于测试场景：
- 所有日志级别 → (丢弃)

**用途：** 禁用日志输出，避免污染测试输出

## Logger 后端

可以自定义 Logger 后端来重定向日志输出：

```typescript
import type { LoggerBackend, ILogger } from '@/foundation/logger';

class VSCodeOutputChannelBackend implements LoggerBackend {
  createLogger(prefix: string, level?: LogLevel): ILogger {
    return new VSCodeLogger(prefix, level);
  }
}

// 设置后端
setLoggerBackend(new VSCodeOutputChannelBackend());
```

## Logger 工厂

`loggerFactory` 提供全局的 logger 管理功能：

```typescript
import { loggerFactory } from '@/foundation/logger';

// 设置默认日志级别
loggerFactory.setDefaultLevel('warn');

// 获取 logger（自动缓存）
const logger1 = loggerFactory.getLogger('Module1');
const logger2 = loggerFactory.getLogger('Module1');
// logger1 === logger2 (同一实例)

// 清除缓存的 loggers
loggerFactory.clear();

// 获取 null logger
const nullLogger = loggerFactory.getNullLogger();
```

## 文件结构

```
logger/
├── logger.ts          # Logger 接口和实现
├── backend.ts         # Logger 后端接口和配置
├── index.ts           # 统一导出
├── README.md          # 模块文档
└── __tests__/
    └── logger.test.ts # 单元测试
```

## 测试

运行测试：

```bash
npm test -- logger
```

测试覆盖率：> 80%

## 设计原则

1. **VS Code agnostic** - 核心模块不依赖 VS Code API
2. **可扩展性** - 通过后端接口支持自定义实现
3. **性能优先** - 日志级别过滤在调用点完成
4. **类型安全** - 完整的 TypeScript 类型定义
5. **测试友好** - 提供 NullLogger 禁用测试中的日志

## 扩展层的集成

在 Extension Layer 中，可以提供 VS Code 特定的实现：

```typescript
// extension/logging/vscode-logger.ts
import type { ILogger } from '@/foundation/logger';
import { window } from 'vscode';

class VSCodeLogger implements ILogger {
  private outputChannel = window.createOutputChannel('GraphCode');

  constructor(
    private prefix: string,
    private _level: LogLevel = 'info'
  ) {}

  get level(): LogLevel {
    return this._level;
  }

  setLevel(level: LogLevel): void {
    this._level = level;
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog('debug')) {
      this.outputChannel.appendLine(this.formatMessage('DEBUG', message, args));
    }
  }

  // ... 其他方法
}
```
