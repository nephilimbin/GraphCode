import { Node, Parser } from "web-tree-sitter";
import { normalizePath } from '../foundation/path';
import { FileReader } from '../source/FileReader';
import { ISymbolAnalyzer, SpiderError, SymbolDependency, SymbolInfo } from '../foundation/types';
import { WasmParserFactory } from './WasmParserFactory';
import { resolveWasmFile } from '../foundation/wasmResolver';

/**
 * tree-sitter (WASM) 符号分析器公共基类。
 *
 * Rust / Swift / Python 三个分析器共享同一套流程:WASM 懒初始化 → 解析源码 →
 * 抽取符号 → 构建 import 映射 → 抽取符号级依赖。本基类以模板方法固化这套公共
 * 骨架(含 ISymbolAnalyzer 契约与 AstWorker 依赖的 analyzeFileContent),语言
 * 特有差异由子类注入:
 * - {@link languageConfig}:WASM 初始化与错误消息所需的语言标识。
 * - {@link tryExtractSymbolFromNode}:识别并处理语言特定的符号声明节点。
 * - {@link buildImportMap} / {@link extractDependencies}:import 映射构建与依赖
 *   提取(实现留在子类,scope/调用检测等可后续进一步上提)。
 *
 * TS 的 SymbolAnalyzer 使用 ts-morph(另一套 AST 栈),不继承本类。
 */
export abstract class WasmBaseSymbolAnalyzer implements ISymbolAnalyzer {
  private parser: Parser | null = null;
  private readonly fileReader: FileReader;
  private initPromise: Promise<void> | null = null;
  private readonly extensionPath?: string;

  /** 子类提供语言标识,用于 WASM 初始化与错误消息。 */
  protected abstract readonly languageConfig: {
    /** 传给 WasmParserFactory.getParser 的语言名,如 "rust"。 */
    readonly parserLanguage: string;
    /** tree-sitter 语言 wasm 文件名,如 "tree-sitter-rust.wasm"。 */
    readonly wasmFileName: string;
    /** 错误消息中显示的语言名,如 "Rust"。 */
    readonly label: string;
  };

  constructor(rootDirOrExtensionPath?: string, extensionPath?: string) {
    // Backward compatibility: 历史上部分调用点仅以 extensionPath 作为首参传入。
    this.extensionPath = extensionPath ?? rootDirOrExtensionPath;
    this.fileReader = new FileReader();
  }

  /** Lazily initializes the WASM parser and reuses a single init promise. */
  async ensureInitialized(): Promise<void> {
    // If parser is already initialized, return immediately
    if (this.parser) {
      return;
    }

    // Start initialization if not already in progress
    this.initPromise ??= (async () => {
      try {
        const factory = WasmParserFactory.getInstance();

        // Core + language WASM auto-located via wasmResolver (extensionPath optional)
        const treeSitterWasmPath = resolveWasmFile("tree-sitter.wasm", this.extensionPath);
        await factory.init(treeSitterWasmPath);

        const langWasmPath = resolveWasmFile(this.languageConfig.wasmFileName, this.extensionPath);
        this.parser = await factory.getParser(this.languageConfig.parserLanguage, langWasmPath);
      } catch (error) {
        // Clear the promise so retry is possible
        this.initPromise = null;

        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Failed to initialize ${this.languageConfig.label} WASM parser for symbol analysis: ${errorMessage}`,
          { cause: error }
        );
      }
    })();

    await this.initPromise;
  }

  async analyzeFile(filePath: string): Promise<Map<string, SymbolInfo>> {
    try {
      // Ensure WASM parser is initialized
      await this.ensureInitialized();

      const content = await this.fileReader.readFile(filePath);
      return this.analyzeFileFromContent(filePath, content);
    } catch (error) {
      throw SpiderError.fromError(error, filePath);
    }
  }

  /**
   * Synchronously analyze content and extract symbols.
   * Used by AstWorker when content is already loaded.
   * NOTE: Parser must be initialized before calling this method (call ensureInitialized() first).
   */
  analyzeFileFromContent(filePath: string, content: string): Map<string, SymbolInfo> {
    if (!this.parser) {
      throw new Error(
        "Parser not initialized. Call ensureInitialized() before using analyzeFileFromContent()."
      );
    }

    const tree = this.parser.parse(content);
    if (!tree) {
      throw new Error(`Failed to parse ${this.languageConfig.label} file: ${filePath}`);
    }
    const symbols = new Map<string, SymbolInfo>();
    const normalizedPath = normalizePath(filePath);

    this.extractSymbols(tree.rootNode, normalizedPath, content, symbols);

    return symbols;
  }

  /**
   * Synchronously analyze content and extract both symbols and dependencies.
   * Used by AstWorker when content is already loaded.
   * NOTE: Parser must be initialized before calling this method (call ensureInitialized() first).
   * @returns Object with symbols and dependencies arrays
   */
  analyzeFileContent(filePath: string, content: string): {
    symbols: SymbolInfo[];
    dependencies: SymbolDependency[];
  } {
    if (!this.parser) {
      throw new Error(
        "Parser not initialized. Call ensureInitialized() before using analyzeFileContent()."
      );
    }

    const tree = this.parser.parse(content);
    if (!tree) {
      throw new Error(`Failed to parse ${this.languageConfig.label} file: ${filePath}`);
    }
    const symbolMap = new Map<string, SymbolInfo>();
    const dependencies: SymbolDependency[] = [];
    const normalizedPath = normalizePath(filePath);

    // First pass: collect all symbols
    this.extractSymbols(tree.rootNode, normalizedPath, content, symbolMap);

    // Build import map: localName -> moduleSpecifier (for tracking external dependencies)
    const importMap = this.buildImportMap(tree.rootNode, content);

    // Second pass: extract dependencies (both internal and external)
    this.extractDependencies(tree.rootNode, normalizedPath, content, dependencies, symbolMap, undefined, importMap);

    return {
      symbols: Array.from(symbolMap.values()),
      dependencies,
    };
  }

  async getSymbolDependencies(filePath: string): Promise<SymbolDependency[]> {
    try {
      // Ensure WASM parser is initialized
      await this.ensureInitialized();

      const content = await this.fileReader.readFile(filePath);
      const result = this.analyzeFileContent(filePath, content);
      return result.dependencies;
    } catch (error) {
      throw SpiderError.fromError(error, filePath);
    }
  }

  protected extractSymbols(
    node: Node,
    filePath: string,
    content: string,
    symbols: Map<string, SymbolInfo>,
    parentSymbolId?: string
  ): void {
    if (this.tryExtractSymbolFromNode(node, filePath, content, symbols, parentSymbolId)) {
      return;
    }

    this.extractSymbolsFromChildren(node, filePath, content, symbols, parentSymbolId);
  }

  /** 识别并处理语言特定的符号声明节点;返回 true 表示该节点已被处理。 */
  protected abstract tryExtractSymbolFromNode(
    node: Node,
    filePath: string,
    content: string,
    symbols: Map<string, SymbolInfo>,
    parentSymbolId?: string
  ): boolean;

  protected extractSymbolsFromChildren(
    node: Node,
    filePath: string,
    content: string,
    symbols: Map<string, SymbolInfo>,
    parentSymbolId?: string
  ): void {
    for (const child of node.children) {
      this.extractSymbols(child, filePath, content, symbols, parentSymbolId);
    }
  }

  /** 构建 localName → moduleSpecifier 映射;由子类按语言 import 语法实现。 */
  protected abstract buildImportMap(node: Node, content: string): Map<string, string>;

  /** 提取符号级依赖(内部 + 外部);由子类按语言调用/作用域规则实现。 */
  protected abstract extractDependencies(
    node: Node,
    filePath: string,
    content: string,
    dependencies: SymbolDependency[],
    symbols: Map<string, SymbolInfo>,
    currentScope?: string,
    importMap?: Map<string, string>
  ): void;

  protected getNodeText(node: Node, content: string): string {
    return content.slice(node.startIndex, node.endIndex);
  }
}
