# dependon — 架构设计(施工蓝图)

> **状态**:设计阶段,待评审
> **分支**:`refactor/dependon-rebuild`
> **定位**:独立纯库,1:1 复刻 `src/analyzer` 的代码分析能力(剔除 signature dead code),清晰分层,不融合现有插件。

---

## 0. 一句话定位

`src/analyzer` 已是 vscode-agnostic,但内部架构混乱(facade 越界持有、职责混杂、命名失真、能力冗余)。`dependon` 把它的**能力**用全新设计的干净架构重新实现一遍,作为可独立 import 的库。**不替换**现有插件对 analyzer 的调用,两者并存。

---

## 1. 目标与非目标

**目标**
- 功能复刻:依赖分析 / 符号图 / 反向索引 / 调用图 / LSP call hierarchy / 多语言解析 / 死代码扫描
- 清晰分层 + 单一职责 + 去隐喻命名
- 可被任意工具 `import` 使用

**非目标(本期)**
- ❌ 不替换 extension 对 analyzer 的调用(extension 继续用老 analyzer)
- ❌ 不与现有插件融合 / 不做消费方切换
- ❌ 不做 CLI(纯库)
- ❌ 不做能力增强,只做架构重整

---

## 2. 关键决策(已与 owner 确认)

| 决策点 | 选择 | 理由 |
|---|---|---|
| 功能范围 | 1:1 全量复刻 | 零功能风险 |
| 产品形态 | 纯库(被 import) | 无 CLI |
| 与现有项目关系 | **独立,不融合** | dependon 自洽,不替换 extension 调用 |
| facade 命名 | **Analyzer** | 去 Spider 隐喻,直白 |
| signature dead code | **不搬**(剔除) | ~867 行零业务消费,搬过去违背干净架构目标 |
| 三套图系统 | **保持独立** | 语义/数据源/粒度不同,只统一类型到 domain |
| 对外 API | 接受破坏性变更 | 既然重设计,API 一起设计干净 |

---

## 3. 分层模型与依赖规则

```
┌─────────────────────────────────────────────┐
│  api/           公共导出(index.ts)            │  对外门面出口
├─────────────────────────────────────────────┤
│  facade/        Analyzer + AnalyzerBuilder    │  组合 services,不越界持有 infra
├─────────────────────────────────────────────┤
│  services/      业务服务(单一职责)            │  DependencyAnalyzer / SymbolGraphReader
│                                              │  DeadCodeScanner / UsageVerifier ...
├─────────────────────────────────────────────┤
│  callgraph/  lsp/    独立子系统(平移)         │  调用图引擎 / LSP 边界适配器
├─────────────────────────────────────────────┤
│  indexing/  resolution/  languages/          │  索引 / 路径解析 / 多语言解析
├─────────────────────────────────────────────┤
│  infra/         有状态基础(cache/worker/persist)│
├─────────────────────────────────────────────┤
│  core/          无状态基础(logger/error/path)   │
├─────────────────────────────────────────────┤
│  domain/        纯类型模型(零依赖)             │  最底层叶子
└─────────────────────────────────────────────┘
```

**铁律:依赖只能自上而下。任何下层 import 上层 = 编译失败 / CI 拒绝。**
- `domain/` 零依赖(纯 type,不 import 任何其他层)
- `core/` 只依赖 `domain/`
- `infra/` 依赖 `core/` + `domain/`
- `services/` 依赖 `infra/` + `resolution/` + `indexing/` + `languages/`
- `facade/` 只持有 `services/`,**绝不直接持有 infra**(根治 AstWorkerHost 双持有)
- `callgraph/` / `lsp/` 可独立使用,不强制经 facade

---

## 4. 目录结构

> **命名约定**:文件名统一 **PascalCase**;目录名 lowercase 单词;唯一例外 `api/index.ts`(Node/TS 入口惯例)。

```
dependon/
├── package.json
├── tsconfig.json
├── ARCHITECTURE.md            本文件
├── src/
│   ├── domain/                纯域模型(零依赖)
│   │   ├── Dependency.ts        Dependency
│   │   ├── Symbol.ts            SymbolInfo / SymbolDependency
│   │   ├── SymbolGraph.ts       SymbolNode / CallEdge / IntraFileGraph
│   │   ├── CallGraph.ts         CallGraphNode/Edge + Serialized*(原 callgraphTypes.ts)
│   │   ├── ReverseIndex.ts      SerializedReverseIndex
│   │   └── Config.ts            AnalyzerConfig(原 SpiderConfig)
│   ├── core/                  无状态基础
│   │   ├── Logger.ts
│   │   ├── Errors.ts            DependonError(原 SpiderError)
│   │   ├── Path.ts
│   │   ├── Constants.ts
│   │   ├── WasmResolver.ts      资源定位(原 wasmResolver)
│   │   └── WasmParserFactory.ts  tree-sitter 单例工厂 + legacy dylink hack
│   ├── infra/                 有状态基础
│   │   ├── LRUCache.ts          原 Cache
│   │   ├── AstWorkerHost.ts     砍到 4 方法(原 9)
│   │   └── AstWorker.ts         worker 线程入口
│   ├── languages/             多语言解析(统一双轨)
│   │   ├── WasmBaseImportParser.ts    抽出,消除 6 份重复 boilerplate
│   │   ├── WasmBaseSymbolAnalyzer.ts  原有
│   │   ├── TypeScriptSymbolAnalyzer.ts  原 SymbolAnalyzer(ts-morph)
│   │   ├── PythonParser.ts / PythonSymbolAnalyzer.ts
│   │   ├── RustParser.ts / RustSymbolAnalyzer.ts
│   │   ├── SwiftParser.ts / SwiftSymbolAnalyzer.ts
│   │   ├── JavaParser.ts / GoParser.ts / CSharpParser.ts   (仅 import)
│   │   └── LanguageService.ts   唯一对 languages 的入口
│   ├── resolution/            路径/模块解析
│   │   ├── PathResolver.ts      编排器
│   │   ├── TsConfigResolver.ts / PackageJsonResolver.ts / WorkspaceResolver.ts
│   │   ├── PythonModuleResolver.ts / RustModuleResolver.ts
│   │   ├── SourceFileCollector.ts
│   │   ├── FileReader.ts
│   │   └── FileResolve.ts       原 fileResolve(共享 fs 辅助)
│   ├── indexing/              索引与反向索引
│   │   ├── FileReverseIndex.ts      原 ReverseIndex(改名区分符号级)
│   │   ├── SymbolReverseIndex.ts    从 symbol/ 迁入(修目录错配)
│   │   ├── ReverseIndexStore.ts     原 ReverseIndexManager
│   │   ├── IndexerStatus.ts
│   │   ├── IndexerWorker.ts         修正大小写命名坑(原 IndexerWorker.ts↔indexerWorker.js)
│   │   └── IndexerWorkerHost.ts
│   ├── services/              业务服务(单一职责,核心重构区)
│   │   ├── DependencyAnalyzer.ts   单文件 import 解析(原 SpiderDependencyAnalyzer)
│   │   ├── SymbolGraphReader.ts    getSymbolGraph(原 SpiderSymbolService 的 AST 部分)
│   │   ├── DeadCodeScanner.ts      scanDeadCode + findUnusedSymbols(从 SymbolService 拆出)
│   │   ├── UsageVerifier.ts        verifyDependencyUsage*(从 SymbolService 拆出)
│   │   ├── ReferenceLookup.ts      反向查找(原 SpiderReferenceLookup)
│   │   ├── DependencyCrawler.ts    依赖图遍历(原 SpiderGraphCrawler)
│   │   ├── IndexingService.ts      全量/增量索引(原 SpiderIndexingService)
│   │   └── CacheCoordinator.ts     缓存一致性(原 SpiderCacheCoordinator)
│   ├── callgraph/             独立调用图子系统(基本平移,含 sql.js)
│   │   ├── CallGraphIndexer.ts
│   │   ├── GraphExtractor.ts
│   │   ├── CallGraphQuery.ts
│   │   ├── FileIndexer.ts
│   │   ├── DatabaseManager.ts      sql.js WASM 加载/建表
│   │   ├── EdgeResolver.ts
│   │   ├── PersistenceManager.ts
│   │   └── CycleUtils.ts           原 cycleUtils
│   ├── lsp/                   边界适配器(几乎零改造)
│   │   └── LspCallHierarchyAnalyzer.ts
│   ├── facade/
│   │   ├── Analyzer.ts           新 facade(原 Spider,但只持有 services)
│   │   └── AnalyzerBuilder.ts    流式构造(原 SpiderBuilder)
│   └── api/
│       └── index.ts              公共导出(入口惯例,保留小写)
└── tests/                    行为对比测试(对齐 analyzer 输出)
```

---

## 5. 命名规范

### 5.1 原则
- **文件名统一 PascalCase**:dependon 新约定,优于 analyzer 的"类 PascalCase / 工具 lowercase"混合习惯(现 57:16 混用)。多词直接拼接(`SymbolGraph.ts`,非 `symbol-graph.ts`)。**目录名 lowercase 单词**;唯一例外 `api/index.ts`(Node/TS 入口惯例)
- **去 Spider 隐喻**:所有 `Spider*` 前缀删除,按领域语义命名
- **facade 只有一个主名**:`Analyzer`,子服务不带 facade 名前缀
- **后缀约定**:`*Reader`(读)、`*Scanner`(扫描)、`*Verifier`(验证)、`*Crawler`(遍历)、`*Resolver`(解析)、`*Store`(存储)、`*Coordinator`(协调)

### 5.2 旧 → 新 映射表

| 旧(analyzer) | 新(dependon) | 说明 |
|---|---|---|
| `Spider` | `Analyzer` | facade |
| `SpiderBuilder` | `AnalyzerBuilder` | 构造 |
| `SpiderConfig` | `AnalyzerConfig` | 配置 |
| `SpiderError` | `DependonError` | 错误 |
| `SpiderServices` | `AnalyzerContext`(内部) | 服务包,不对外暴露细节 |
| `SpiderDependencyAnalyzer` | `DependencyAnalyzer` | |
| `SpiderGraphCrawler` | `DependencyCrawler` | |
| `SpiderReferenceLookup` | `ReferenceLookup` | |
| `SpiderIndexingService` | `IndexingService` | |
| `SpiderCacheCoordinator` | `CacheCoordinator` | |
| `SpiderWorkerManager` | `WorkerManager` | |
| `SpiderIndexingCancellation` | `AbortController` | 用标准 API 替代 19 行布尔 |
| `SpiderSymbolService` | **拆 3 个** | → SymbolGraphReader + DeadCodeScanner + UsageVerifier |
| `ReverseIndex` | `FileReverseIndex` | 区分文件级/符号级 |
| `SymbolReverseIndex` | `SymbolReverseIndex` | 迁到 indexing/(修正目录错配) |
| `SymbolDependencyHelper` | `SymbolDependencyHelper` | 迁到 core/util(修正目录错配) |
| `AstWorkerHost` | `AstWorkerHost` | 保留名,但**砍到 4 方法** |

---

## 6. 功能复刻清单(验收基线)

复刻完成 = 对同一批真实代码,dependon 与 analyzer 产出一致。

| 能力域 | 原 API | 新 API | 状态 |
|---|---|---|---|
| 单文件依赖分析 | `Spider.analyze` | `Analyzer.analyze` | 待复刻 |
| 模块说明符解析 | `Spider.resolveModuleSpecifier` | `Analyzer.resolveModuleSpecifier` | 待复刻(去重) |
| 依赖图遍历 | `Spider.crawl / crawlFrom` | `Analyzer.crawl / crawlFrom` | 待复刻 |
| 符号图 | `Spider.getSymbolGraph` | `Analyzer.getSymbolGraph` | 待复刻 |
| 死代码扫描 | `Spider.scanDeadCode / findUnusedSymbols` | 同 | 待复刻 |
| 依赖使用验证 | `Spider.verifyDependencyUsage*` | 同 | 待复刻 |
| 调用链追踪 | `Spider.traceFunctionExecution` | 同 | 待复刻 |
| 反向索引 | `Spider.enable/disable/getSerialized/validate/...` | 同 | 待复刻 |
| 反向查找 | `Spider.findReferencingFiles` | 同 | 待复刻 |
| 全量/增量索引 | `Spider.buildFullIndex / reindexStaleFiles` | 同 | 待复刻 |
| 缓存管理 | `Spider.clearCache / invalidate*` | 同 | 待复刻 |
| 索引状态 | `Spider.getIndexStatus / subscribe` | 同 | 待复刻 |
| 调用图(callgraph) | `CallGraphIndexer.*` | 同(平移) | 待复刻 |
| LSP call hierarchy | `LspCallHierarchyAnalyzer` | 同(平移) | 待复刻 |
| 多语言解析 | (内部) | (内部,统一双轨) | 待复刻 |

---

## 7. 砍掉的内容

| 内容 | 行数 | 理由 |
|---|---|---|
| `SignatureAnalyzer` + `Extractor` + `Comparator` + `analyzeBreakingChanges` | ~867 + 测试 198 | 业务层/extension/mcp **零消费**,双路径全闲置 |
| `AstWorkerHost` 的 5 个 signature 方法 + reset | — | 死接口(无消费者) |
| `SpiderSymbolService.resolveModuleSpecifier` | ~8 | 与 DependencyAnalyzer 重复 |
| `getCacheStats` 同步版的写死 0 字段 | — | 误导性 API |
| `SpiderServices` 被 Spider 丢弃的 6 字段持久化 | — | 临时变量不该进契约 |

---

## 8. 搭建阶段(strangler,叶子优先)

每个阶段**可独立验证**,失败不影响已完成的下层。

| 阶段 | 内容 | 验证 |
|---|---|---|
| **P0** | 脚手架:`package.json` / `tsconfig.json` / 目录骨架 | `tsc` 通过 |
| **P1** | `domain/` + `core/`(零依赖叶子) | 类型可 import |
| **P2** | `infra/`(cache / worker 砍到4方法 / persistence) | 单元测试 |
| **P3** | `languages/`(统一双轨,抽 WasmBaseImportParser) | 各语言 parseImports 对比 |
| **P4** | `resolution/`(PathResolver + 各 ModuleResolver + Collector) | 路径解析对比 |
| **P5** | `indexing/`(reverse-index 合并 SymbolReverseIndex / status / worker) | 反向索引序列化对比 |
| **P6** | `services/`(拆 SpiderSymbolService 为 3 个,核心重构) | 逐服务行为对比 |
| **P7** | `callgraph/` + `lsp/`(平移) | 调用图提取对比 |
| **P8** | `facade/` + `api/`(Analyzer 只持有 services) | 端到端对比 |
| **P9** | 行为对比测试套件(对真实代码,新旧产出一致) | 全绿 = 复刻成功 |

---

## 9. 工程配置(待 P0 敲定)

- **语言**:TypeScript,严格模式
- **模块**:ESM(`"type": "module"`),`NodeNext`
- **包名**:`dependon`
- **依赖**(已核对主项目 `package.json`):`ts-morph ^27.0.2` / `sql.js ^1.14.1` / `web-tree-sitter ^0.26.9` / `tree-sitter-wasms ^0.1.13` / `zod ^4.4.3`
- **打包**:纯库用 `tsc` 出 `dist/`;但 `AstWorker` / `IndexerWorker` 是 worker_threads 脚本,需 esbuild 单独 bundle 成独立 `.js`(对齐主项目 esbuild 方案)
- **测试**:vitest(对齐主项目)

---

## 10. 风险与红线

| 风险 | 应对 |
|---|---|
| 1:1 复刻可能照搬隐藏 bug | 行为对比测试既验"功能在"也暴露"旧行为是否本就是 bug" |
| languages 双轨统一改动大 | P3 单独验证,保留旧能力分级(TS全符号/Py-Rust-Swift符号/Java-Go-C#仅import) |
| domain 类型合并影响面广 | P1 先定 domain,后续所有层基于它 |
| WASM 资源定位 | core/wasm 保留 wasmResolver 的 `__dirname` 自动定位逻辑 |
