# Utils Module

## 职责

提供 GraphCode 应用程序的通用工具函数，包括：
- **Path utilities** - 路径标准化、相对路径计算
- **TOON encoding** - Token 优化的序列化格式
- **Language detection** - 基于文件扩展名的语言检测

## 导出

### 从 `@/foundation/utils` 导入：

```typescript
import {
  // Path utilities
  normalizePath,
  normalizePathForComparison,
  getRelativePath,

  // TOON encoding
  jsonToToon,
  toonToJson,
  estimateTokenSavings,

  // Language detection
  detectLanguageFromExtension,
  isLanguage,
  getExtensionsForLanguage,
  LANGUAGE_BY_EXTENSION,
} from '@/foundation/utils';
```

## Path Utilities

### normalizePath

标准化文件路径为统一的正斜杠格式：

```typescript
import { normalizePath } from '@/foundation/utils';

// Windows 路径
normalizePath('C:\\Users\\file')     // 'c:/Users/file'
normalizePath('path\\to\\file')      // 'path/to/file'

// Unix 路径
normalizePath('/home/user/file')     // '/home/user/file'
normalizePath('path/to/file')        // 'path/to/file'

// 混合路径
normalizePath('path\\to/file')       // 'path/to/file'

// 规范化
normalizePath('path///to///file')    // 'path/to/file'
```

**特性：**
- 转换反斜杠为正斜杠
- 折叠多个斜杠
- 小写 Windows 驱动器字母
- 移除尾部斜杠（根路径除外）

### normalizePathForComparison

用于路径比较的标准化（大小写敏感）：

```typescript
import { normalizePathForComparison } from '@/foundation/utils';

normalizePathForComparison('C:\\Users\\file')  // 'c:/Users/file'
normalizePathForComparison('path/to/')          // 'path/to'
```

### getRelativePath

计算相对于工作区根目录的路径：

```typescript
import { getRelativePath } from '@/foundation/utils';

getRelativePath('/workspace/src/file.ts', '/workspace')
// 'src/file.ts'

getRelativePath('/other/file.ts', '/workspace')
// '/other/file.ts' (outside workspace, returns absolute)
```

## TOON Encoding

TOON (Token-Oriented Object Notation) 是一种针对 LLM 优化的序列化格式，旨在减少 token 消耗。

### jsonToToon

将 JSON 对象数组转换为 TOON 格式：

```typescript
import { jsonToToon } from '@/foundation/utils';

const data = [
  { file: 'main.ts', deps: ['fs', 'path'] },
  { file: 'utils.ts', deps: ['os'] }
];

const toon = jsonToToon(data, { objectName: 'files' });
// files(file,deps)
// [main.ts,[fs|path]]
// [utils.ts,[os]]
```

**格式说明：**
- Header: `objectName(key1,key2,...)`
- Data: 每行一个对象，格式为 `[value1,value2,...]`
- Arrays: 使用 `|` 分隔符连接嵌套数组

### toonToJson

将 TOON 格式解析回 JSON 对象数组：

```typescript
import { toonToJson } from '@/foundation/utils';

const toon = `files(file,deps)
[main.ts,[fs|path]]
[utils.ts,[os]]`;

const data = toonToJson(toon);
// [
//   { file: 'main.ts', deps: ['fs', 'path'] },
//   { file: 'utils.ts', deps: ['os'] }
// ]
```

### estimateTokenSavings

估算 TOON 相对于 JSON 的 token 节省：

```typescript
import { estimateTokenSavings, jsonToToon } from '@/foundation/utils';

const jsonStr = JSON.stringify(data);
const toonStr = jsonToToon(data);

const savings = estimateTokenSavings(jsonStr, toonStr);
console.log(`节省 ${savings.savingsPercent.toFixed(1)}% tokens`);
```

**使用场景：**
- 向 LLM 发送大量结构化数据
- 减少上下文窗口占用
- 降低 API 调用成本

## Language Detection

### LANGUAGE_BY_EXTENSION

文件扩展名到语言的映射表：

```typescript
import { LANGUAGE_BY_EXTENSION } from '@/foundation/utils';

LANGUAGE_BY_EXTENSION['.ts']  // 'typescript'
LANGUAGE_BY_EXTENSION['.py']  // 'python'
LANGUAGE_BY_EXTENSION['.rs']  // 'rust'
```

### detectLanguageFromExtension

从文件路径或扩展名检测语言：

```typescript
import { detectLanguageFromExtension } from '@/foundation/utils';

// 从完整路径检测
detectLanguageFromExtension('/path/to/file.ts')  // 'typescript'
detectLanguageFromExtension('/path/to/file.py')  // 'python'

// 从扩展名检测（带点）
detectLanguageFromExtension('.ts')               // 'typescript'
detectLanguageFromExtension('py')                // 'python'

// 未知扩展名
detectLanguageFromExtension('.md')                // 'unknown'
```

### isLanguage

检查文件是否属于特定语言：

```typescript
import { isLanguage } from '@/foundation/utils';

isLanguage('/path/to/file.ts', 'typescript')  // true
isLanguage('/path/to/file.py', 'python')      // true
isLanguage('/path/to/file.rs', 'typescript')  // false
```

### getExtensionsForLanguage

获取特定语言的所有扩展名：

```typescript
import { getExtensionsForLanguage } from '@/foundation/utils';

getExtensionsForLanguage('typescript')
// ['.ts', '.tsx', '.mts', '.cts']

getExtensionsForLanguage('python')
// ['.py', '.pyi']

getExtensionsForLanguage('rust')
// ['.rs']
```

## 设计原则

1. **Platform agnostic** - 路径工具跨平台工作
2. **Token efficiency** - TOON 格式优化 LLM token 使用
3. **Type safety** - 完整的 TypeScript 类型定义
4. **Consistency** - 统一的语言检测逻辑
5. **Zero dependencies** - 不依赖外部包（除了 Node.js 内置模块）

## 文件结构

```
utils/
├── path.ts                  # 路径工具函数
├── toon.ts                  # TOON 编码/解码
├── language-detection.ts    # 语言检测工具
├── index.ts                 # 统一导出
├── README.md                # 模块文档
└── __tests__/
    ├── path.test.ts         # 路径工具测试
    ├── toon.test.ts         # TOON 测试
    └── language-detection.test.ts # 语言检测测试
```

## 测试

运行测试：

```bash
npm test -- utils
```

测试覆盖率：> 80%

## 使用示例

### 路径处理

```typescript
import { normalizePath, getRelativePath } from '@/foundation/utils';

// 标准化用户提供的路径
const cleanPath = normalizePath(userInputPath);

// 计算项目相对路径用于显示
const displayPath = getRelativePath(absPath, workspaceRoot);
```

### 向 LLM 发送数据

```typescript
import { jsonToToon } from '@/foundation/utils';

// 转换依赖图为 TOON 格式以节省 tokens
const depGraph = buildDependencyGraph();
const toonData = jsonToToon(depGraph, { objectName: 'deps' });
sendToLLM(toonData);
```

### 语言特定处理

```typescript
import { detectLanguageFromExtension, isLanguage } from '@/foundation/utils';

// 根据语言选择解析器
const filePath = '/path/to/file.py';
const language = detectLanguageFromExtension(filePath);

if (isLanguage(filePath, 'python')) {
  // 使用 Python 解析器
} else if (isLanguage(filePath, 'typescript')) {
  // 使用 TypeScript 解析器
}
```
