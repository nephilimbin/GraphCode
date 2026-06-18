# Types Module

## 职责

提供 GraphCode 应用程序的核心类型定义和工具类型，包括：
- 核心工具类型（Result、Option）
- 领域特定类型（图、符号、调用图）
- Extension ↔ Webview 消息协议类型

## 导出

### 从 `@/foundation/types` 导入：

```typescript
// 核心工具类型
import { ok, err, some, none, isSome, unwrapOr } from '@/foundation/types';

// 领域类型
import type { GraphData, SymbolNode, CallEdge, IntraFileGraph } from '@/foundation/types';

// 调用图类型
import type { SerializedCallNode, SerializedCallEdge, ShowCallGraphMessage } from '@/foundation/types';
```

### 从 `@/foundation/protocol` 导入：

```typescript
// 消息协议
import type {
  ExtensionToWebviewMessage,
  WebviewToExtensionMessage,
  ShowGraphMessage,
  OpenFileMessage
} from '@/foundation/protocol';
```

## 核心类型说明

### Result<T, E>

表示可能失败的操作结果：

```typescript
type Result<T, E = Error> =
  | { success: true; data: T }
  | { success: false; error: E };
```

**使用示例：**

```typescript
async function parseFile(filePath: string): Promise<Result<AST, ParseError>> {
  try {
    const ast = await parser.parse(filePath);
    return ok(ast); // { success: true, data: ast }
  } catch (error) {
    return err(new ParseError(error.message)); // { success: false, error }
  }
}

// 使用 Result
const result = await parseFile('/path/to/file.ts');
if (result.success) {
  console.log('Parsed:', result.data);
} else {
  console.error('Parse failed:', result.error.message);
}
```

### Option<T>

表示可能不存在的值，比 `null`/`undefined` 更明确：

```typescript
type Option<T> = { isSome: true; value: T } | { isSome: false };
```

**使用示例：**

```typescript
function findSymbol(id: string): Option<Symbol> {
  const symbol = symbols.get(id);
  return symbol !== undefined ? some(symbol) : none;
}

// 使用 Option
const symbol = findSymbol('mySymbol');
if (isSome(symbol)) {
  console.log('Found:', symbol.value);
} else {
  console.log('Not found');
}

// 使用 unwrapOr 提供默认值
const count = unwrapOr(symbol, { count: 0 });
```

## 领域类型说明

### GraphData

文件级依赖图数据结构：

```typescript
interface GraphData {
  nodes: string[];           // 节点列表（文件路径）
  edges: GraphEdge[];        // 边列表（依赖关系）
  nodeLabels?: Record<string, string>;  // 自定义节点标签
  parentCounts?: Record<string, number>; // 父节点计数
  unusedEdges?: string[];    // 未使用的依赖边
}
```

### SymbolNode

符号节点表示：

```typescript
interface SymbolNode {
  id: string;
  name: string;
  kind: number;              // LSP SymbolKind
  type: "class" | "function" | "variable";
  range: { start: number; end: number };
  isExported: boolean;
  isExternal: boolean;
  parentSymbolId?: string;
}
```

### IntraFileGraph

文件内符号调用图：

```typescript
interface IntraFileGraph {
  filePath: string;
  nodes: SymbolNode[];
  edges: CallEdge[];
  incomingEdges?: CallEdge[];
  hasCycle: boolean;
  cycleNodes?: string[];
  cycleType?: CycleType;
}
```

## 消息协议

### Extension → Webview 消息

```typescript
type ExtensionToWebviewMessage =
  | ShowGraphMessage          // 显示依赖图
  | SymbolGraphMessage        // 显示符号图
  | ShowCallGraphMessage      // 显示调用图
  | IndexingProgressMessage   // 索引进度
  | EmptyStateMessage;        // 空状态
```

### Webview → Extension 命令

```typescript
type WebviewToExtensionMessage =
  | OpenFileMessage           // 打开文件
  | ExpandNodeMessage         // 展开节点
  | DrillDownMessage         // 钻取符号
  | CallGraphSymbolFocusCommand; // 聚焦调用图节点
```

## 文件结构

```
types/
├── core-types.ts         # 核心工具类型（Result、Option）
├── graph-types.ts        # 依赖图相关类型
├── symbol-types.ts      # 符号分析相关类型
├── callgraph-types.ts   # 调用图相关类型
├── index.ts             # 统一导出
└── __tests__/
    └── core-types.test.ts # 单元测试

protocol/
├── messages.ts           # Extension ↔ Webview 消息协议
└── index.ts
```

## 测试

运行测试：

```bash
npm test -- types
```

测试覆盖率：> 80%

## 设计原则

1. **类型安全优先**：所有公共 API 必须有明确类型
2. **显式优于隐式**：使用 Result/Option 而非异常/null
3. **领域驱动**：类型反映业务领域概念
4. **向后兼容**：通过 barrel export 保持兼容性
