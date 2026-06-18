# Constants Module

## 职责

提供 GraphCode 应用程序的集中常量定义，包括：
- 文件扩展名（按语言分类）
- 支持的文件扩展名集合
- 文件匹配模式和 glob 模式
- 忽略的目录列表
- 语言可视化颜色（用于 UI）

## 导出

### 从 `@/foundation/constants` 导入：

```typescript
import {
  // 文件扩展名
  TYPESCRIPT_EXTENSIONS,
  JAVASCRIPT_EXTENSIONS,
  PYTHON_EXTENSIONS,
  RUST_EXTENSIONS,
  GO_EXTENSIONS,
  JAVA_EXTENSIONS,

  // 派生集合
  SUPPORTED_FILE_EXTENSIONS,
  SUPPORTED_SYMBOL_ANALYSIS_EXTENSIONS,

  // 文件模式
  SUPPORTED_SOURCE_FILE_REGEX,
  WATCH_GLOB,

  // 忽略的目录
  IGNORED_DIRECTORIES,

  // UI 颜色
  LANGUAGE_COLORS,
  EXTENSION_COLORS,
} from '@/foundation/constants';
```

## 文件扩展名

### 按语言分类

每个语言都有对应的文件扩展名常量：

```typescript
TYPESCRIPT_EXTENSIONS  // ['.ts', '.tsx']
JAVASCRIPT_EXTENSIONS  // ['.js', '.jsx', '.mjs', '.cjs']
PYTHON_EXTENSIONS      // ['.py', '.pyi']
RUST_EXTENSIONS        // ['.rs']
GO_EXTENSIONS          // ['.go']
JAVA_EXTENSIONS        // ['.java']
```

### 派生集合

#### SUPPORTED_FILE_EXTENSIONS

所有支持的文件扩展名的并集：

```typescript
// 包含所有语言的扩展名
const extensions = SUPPORTED_FILE_EXTENSIONS;
// ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.pyi', '.rs', ...]
```

#### SUPPORTED_SYMBOL_ANALYSIS_EXTENSIONS

支持 LSP 符号分析的扩展名（TypeScript、JavaScript、Python、Rust）：

```typescript
const symbolAnalysisExts = SUPPORTED_SYMBOL_ANALYSIS_EXTENSIONS;
// ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.pyi', '.rs']
```

## 文件模式

### SUPPORTED_SOURCE_FILE_REGEX

匹配所有支持源文件的统一正则表达式：

```typescript
const regex = SUPPORTED_SOURCE_FILE_REGEX;

regex.test('.ts');      // true
regex.test('.py');      // true
regex.test('.md');      // false
regex.test('.json');    // false
```

### WATCH_GLOB

用于文件监听的 glob 模式：

```typescript
const watcher = require('glob').globStream(WATCH_GLOB, options);
```

## 忽略的目录

定义了在文件分析时应忽略的目录：

```typescript
const ignored = IGNORED_DIRECTORIES;
// ['node_modules', '.git', 'dist', 'build', 'out', '__pycache__', 'venv', 'target', ...]
```

**使用示例：**

```typescript
import { IGNORED_DIRECTORIES } from '@/foundation/constants';

function shouldAnalyze(filePath: string): boolean {
  const segments = filePath.split('/');
  return !IGNORED_DIRECTORIES.some(dir => segments.includes(dir));
}
```

## 语言可视化颜色

### LANGUAGE_COLORS

定义每种语言的官方品牌颜色，用于 UI 中的语法高亮、边框和图标：

```typescript
const colors = LANGUAGE_COLORS;
{
  typescript: '#3178c6',
  javascript: '#f7df1e',
  python: '#3776ab',
  rust: '#ce422b',
  go: '#00acd7',
  java: '#f8981d',
  unknown: '#6b6b6b',
}
```

### EXTENSION_COLORS

将文件扩展名映射到语言颜色的记录：

```typescript
import { EXTENSION_COLORS } from '@/foundation/constants';

function getFileColor(filePath: string): string {
  const ext = path.extname(filePath);
  return EXTENSION_COLORS[ext] || EXTENSION_COLORS['.unknown'];
}
```

**使用示例：**

```typescript
// 在图中渲染节点边框颜色
const borderColor = EXTENSION_COLORS['.ts']; // '#3178c6'

// 在 webview 中显示语言标签
const languageColor = LANGUAGE_COLORS['typescript'];
```

## 使用示例

### 检查文件是否支持

```typescript
import { SUPPORTED_SOURCE_FILE_REGEX } from '@/foundation/constants';

function isSupportedFile(filePath: string): boolean {
  return SUPPORTED_SOURCE_FILE_REGEX.test(filePath);
}
```

### 获取文件对应的语言颜色

```typescript
import { EXTENSION_COLORS } from '@/foundation/constants';

function getNodeColor(filePath: string): string {
  const ext = path.extname(filePath);
  return EXTENSION_COLORS[ext] || LANGUAGE_COLORS.unknown;
}
```

### 过滤忽略的目录

```typescript
import { IGNORED_DIRECTORIES } from '@/foundation/constants';

function filterIgnoredPaths(paths: string[]): string[] {
  return paths.filter(path => {
    const segments = path.split('/');
    return !IGNORED_DIRECTORIES.some(dir => segments.includes(dir));
  });
}
```

## 设计原则

1. **集中管理** - 所有常量在一个地方定义，避免重复
2. **类型安全** - 使用 `as const` 确保类型推断为只读数组
3. **派生数据** - 从基本常量派生出集合（如 SUPPORTED_FILE_EXTENSIONS）
4. **可扩展** - 新增语言支持时只需添加对应的扩展名和颜色
5. **命名清晰** - 使用明确的命名约定（语言_扩展名）

## 文件结构

```
constants/
├── constants.ts          # 所有常量定义
├── index.ts             # 统一导出
├── README.md            # 模块文档
└── __tests__/
    └── constants.test.ts # 单元测试
```

## 测试

运行测试：

```bash
npm test -- constants
```

测试覆盖率：> 80%

## 未来扩展

新增语言支持时，需要添加：

1. 文件扩展名常量（如 `XYZ_EXTENSIONS`）
2. 在 `LANGUAGE_COLORS` 中添加品牌颜色
3. 在 `EXTENSION_COLORS` 中添加扩展名映射
4. 更新 `SUPPORTED_FILE_EXTENSIONS`（如果需要符号分析）
