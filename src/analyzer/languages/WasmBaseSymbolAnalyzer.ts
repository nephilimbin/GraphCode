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
 * 骨架(含 ISymbolAnalyzer 契约、AstWorker 依赖的 analyzeFileContent,以及依赖
 * 提取的递归遍历 + 调用依赖两路检测),语言特有差异由子类注入:
 * - {@link languageConfig}:WASM 初始化与错误消息所需的语言标识。
 * - {@link tryExtractSymbolFromNode}:识别并处理语言特定的符号声明节点。
 * - {@link buildImportMap}:import 映射构建(语法各异,留子类)。
 * - {@link getScopeForNode}:作用域定义节点的识别(语法各异,留子类)。
 * - {@link isCallExpression} / {@link extractCallCallee} / {@link extractCallTarget}:
 *   调用表达式识别与被调用方解析(calledName + 可选 moduleQualifier,Rust 用后者)。
 * - {@link collectExtraDependencies}:可选钩子,默认空;Swift override 追加类型依赖。
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

  /**
   * 提取符号级依赖:递归遍历 AST,跟踪作用域,检测调用依赖(本地符号 / 外部
   * importMap 命中)及子类追加的额外依赖(如 Swift 类型引用)。
   */
  protected extractDependencies(
    node: Node,
    filePath: string,
    content: string,
    dependencies: SymbolDependency[],
    symbols: Map<string, SymbolInfo>,
    currentScope?: string,
    importMap?: Map<string, string>
  ): void {
    const newScope = this.getScopeForNode(node, filePath, content, currentScope);
    this.addCallDependencyIfAny(node, filePath, content, dependencies, symbols, newScope, importMap);
    this.collectExtraDependencies(node, filePath, content, dependencies, symbols, newScope, importMap);

    for (const child of node.children) {
      this.extractDependencies(child, filePath, content, dependencies, symbols, newScope, importMap);
    }
  }

  /** 计算节点所处作用域的符号 id;由子类按语言的"作用域定义节点"规则实现。 */
  protected abstract getScopeForNode(
    node: Node,
    filePath: string,
    content: string,
    currentScope?: string
  ): string | undefined;

  /**
   * 检测调用依赖:先查本地符号(同文件),再查 importMap(外部)。Rust 的限定
   * 调用(`module::fn`)经 moduleQualifier 先查模块,再按符号名兜底。
   */
  protected addCallDependencyIfAny(
    node: Node,
    filePath: string,
    content: string,
    dependencies: SymbolDependency[],
    symbols: Map<string, SymbolInfo>,
    scope?: string,
    importMap?: Map<string, string>
  ): void {
    if (!this.isCallExpression(node) || !scope) {
      return;
    }

    const funcNode = this.extractCallCallee(node);
    if (!funcNode) {
      return;
    }
    const target = this.extractCallTarget(funcNode, content);

    // Check if it's a call to a local symbol (same file)
    const localTargetSymbolId = `${filePath}:${target.calledName}`;
    if (symbols.has(localTargetSymbolId)) {
      dependencies.push({
        sourceSymbolId: scope,
        targetSymbolId: localTargetSymbolId,
        targetFilePath: filePath,
        isTypeOnly: false,
      });
      return;
    }

    // Check if it's a call to an imported symbol (external file).
    // For qualified calls (e.g. Rust `helper::format_data`), resolve via the
    // module qualifier first; otherwise fall back to the bare symbol name.
    if (target.moduleQualifier && importMap?.has(target.moduleQualifier)) {
      const moduleSpecifier = importMap.get(target.moduleQualifier);
      if (moduleSpecifier !== undefined) {
        // Create dependency with module specifier as targetFilePath
        // This will be resolved to absolute path by SpiderSymbolService.getSymbolGraph()
        dependencies.push({
          sourceSymbolId: scope,
          targetSymbolId: `${moduleSpecifier}:${target.calledName}`, // Module specifier + symbol name
          targetFilePath: moduleSpecifier, // Will be resolved by PathResolver
          isTypeOnly: false,
        });
        return;
      }
    }

    if (importMap?.has(target.calledName)) {
      const moduleSpecifier = importMap.get(target.calledName);
      if (moduleSpecifier === undefined) return;
      dependencies.push({
        sourceSymbolId: scope,
        targetSymbolId: `${moduleSpecifier}:${target.calledName}`,
        targetFilePath: moduleSpecifier,
        isTypeOnly: false,
      });
    }
  }

  /** 判断节点是否为调用表达式(Python: 'call';Rust/Swift: 'call_expression')。 */
  protected abstract isCallExpression(node: Node): boolean;

  /** 从调用表达式节点提取被调用方节点。 */
  protected abstract extractCallCallee(node: Node): Node | null;

  /**
   * 从被调用方节点解析调用目标:符号名 + 可选模块限定名。Rust 的限定调用
   * (`module::fn`)返回 moduleQualifier;Python/Swift 仅返回 calledName。
   */
  protected abstract extractCallTarget(funcNode: Node, content: string): {
    calledName: string;
    moduleQualifier?: string;
  };

  /**
   * 除调用依赖外的额外依赖(如 Swift 的类型引用);默认空实现,Rust/Python
   * 无需 override,Swift override 以追加类型依赖。
   */
  protected collectExtraDependencies(
    _node: Node,
    _filePath: string,
    _content: string,
    _dependencies: SymbolDependency[],
    _symbols: Map<string, SymbolInfo>,
    _scope?: string,
    _importMap?: Map<string, string>
  ): void {
    // 默认无额外依赖;子类按需 override。
  }

  protected getNodeText(node: Node, content: string): string {
    return content.slice(node.startIndex, node.endIndex);
  }
}
