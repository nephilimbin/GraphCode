import { Node, Parser } from "web-tree-sitter";
import { normalizePath } from '../path';
import { FileReader } from '../FileReader';
import { ISymbolAnalyzer, SpiderError, SymbolDependency, SymbolInfo } from '../types';
import { WasmParserFactory } from './WasmParserFactory';
import { resolveWasmFile } from '../wasmResolver';

/**
 * Swift symbol analyzer backed by tree-sitter WASM.
 * Requires `extensionPath` to locate `dist/wasm`.
 * In unit tests, mock `WasmParserFactory` directly to avoid WASM initialization.
 */
export class SwiftSymbolAnalyzer implements ISymbolAnalyzer {
  private parser: Parser | null = null;
  private readonly fileReader: FileReader;
  private initPromise: Promise<void> | null = null;
  private readonly extensionPath?: string;

  constructor(rootDirOrExtensionPath?: string, extensionPath?: string) {
    // Backward compatibility:
    // Historically some call sites passed only extensionPath as first argument.
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

        const swiftWasmPath = resolveWasmFile("tree-sitter-swift.wasm", this.extensionPath);
        this.parser = await factory.getParser("swift", swiftWasmPath);
      } catch (error) {
        // Clear the promise so retry is possible
        this.initPromise = null;

        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Failed to initialize Swift WASM parser for symbol analysis: ${errorMessage}`,
          { cause: error }
        );
      }
    })();

    await this.initPromise;
  }
  /**
   * Analyze a Swift file and extract symbols
   */
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
   * Synchronously analyze Swift content and extract symbols
   * Used by AstWorker when content is already loaded
   * NOTE: Parser must be initialized before calling this method (call ensureInitialized() first)
   */
  analyzeFileFromContent(filePath: string, content: string): Map<string, SymbolInfo> {
    if (!this.parser) {
      throw new Error(
        "Parser not initialized. Call ensureInitialized() before using analyzeFileFromContent()."
      );
    }

    const tree = this.parser.parse(content);
    if (!tree) {
      throw new Error(`Failed to parse Swift file: ${filePath}`);
    }
    const symbols = new Map<string, SymbolInfo>();
    const normalizedPath = normalizePath(filePath);

    this.extractSymbols(tree.rootNode, normalizedPath, content, symbols);

    return symbols;
  }

  /**
   * Synchronously analyze Swift content and extract both symbols and dependencies
   * Used by AstWorker when content is already loaded
   * NOTE: Parser must be initialized before calling this method (call ensureInitialized() first)
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
      throw new Error(`Failed to parse Swift file: ${filePath}`);
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

  /**
   * Get symbol-level dependencies for a Swift file
   */
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

  /**
   * Extract symbols from AST
   */
  private extractSymbols(
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

  private tryExtractSymbolFromNode(
    node: Node,
    filePath: string,
    content: string,
    symbols: Map<string, SymbolInfo>,
    parentSymbolId?: string
  ): boolean {
    if (node.type === 'function_declaration') {
      this.handleFunctionDeclaration(node, filePath, content, symbols, parentSymbolId);
      return true;
    }

    // The tree-sitter-wasms Swift grammar unifies class / struct / enum /
    // extension under a single `class_declaration` node. struct & class are
    // indistinguishable (both use `class_body`); enum uses `enum_class_body`;
    // an extension wraps its name in `user_type`. handleClassDeclaration
    // disambiguates them by inspecting the body / name node.
    if (node.type === 'class_declaration') {
      this.handleClassDeclaration(node, filePath, content, symbols, parentSymbolId);
      return true;
    }

    if (node.type === 'protocol_declaration') {
      this.handleProtocolDeclaration(node, filePath, content, symbols, parentSymbolId);
      return true;
    }

    if (node.type === 'typealias_declaration') {
      this.handleTypealiasDeclaration(node, filePath, content, symbols, parentSymbolId);
      return true;
    }

    if (node.type === 'init_declaration') {
      this.handleInitDeclaration(node, filePath, content, symbols, parentSymbolId);
      return true;
    }

    return false;
  }

  private handleFunctionDeclaration(
    node: Node,
    filePath: string,
    content: string,
    symbols: Map<string, SymbolInfo>,
    parentSymbolId?: string
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {
      return;
    }

    const name = this.getNodeText(nameNode, content);
    const symbolId = `${filePath}:${name}`;

    // Check if this is a method (has parent) or a function
    const kind = parentSymbolId ? 'MethodDeclaration' : 'FunctionDeclaration';

    symbols.set(symbolId, {
      name,
      kind,
      line: nameNode.startPosition.row + 1,
      isExported: this.isExported(node, content),
      id: symbolId,
      parentSymbolId,
      category: 'function',
    });

    this.extractSymbolsFromChildren(node, filePath, content, symbols, symbolId);
  }

  private handleClassDeclaration(
    node: Node,
    filePath: string,
    content: string,
    symbols: Map<string, SymbolInfo>,
    parentSymbolId?: string
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {
      return;
    }

    const name = this.getNodeText(nameNode, content);
    // extension: name is a user_type (e.g. `extension String`); enum: body is
    // enum_class_body; everything else (class / struct) is ClassDeclaration.
    const isExtension = nameNode.type === 'user_type';
    const isEnum = this.hasChild(node, 'enum_class_body');
    const symbolId = isExtension ? `${filePath}:extension:${name}` : `${filePath}:${name}`;

    symbols.set(symbolId, {
      name: isExtension ? `extension ${name}` : name,
      kind: isExtension ? 'ExtensionDeclaration' : isEnum ? 'EnumDeclaration' : 'ClassDeclaration',
      line: nameNode.startPosition.row + 1,
      isExported: isExtension ? true : this.isExported(node, content),
      id: symbolId,
      parentSymbolId,
      category: isExtension || isEnum ? 'other' : 'class',
    });

    this.extractSymbolsFromChildren(node, filePath, content, symbols, symbolId);
  }

  private handleProtocolDeclaration(
    node: Node,
    filePath: string,
    content: string,
    symbols: Map<string, SymbolInfo>,
    parentSymbolId?: string
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {
      return;
    }

    const name = this.getNodeText(nameNode, content);
    const symbolId = `${filePath}:${name}`;

    symbols.set(symbolId, {
      name,
      kind: 'ProtocolDeclaration',
      line: nameNode.startPosition.row + 1,
      isExported: this.isExported(node, content),
      id: symbolId,
      parentSymbolId,
      category: 'interface',
    });

    this.extractSymbolsFromChildren(node, filePath, content, symbols, symbolId);
  }

  private handleTypealiasDeclaration(
    node: Node,
    filePath: string,
    content: string,
    symbols: Map<string, SymbolInfo>,
    parentSymbolId?: string
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {
      return;
    }

    const name = this.getNodeText(nameNode, content);
    const symbolId = `${filePath}:${name}`;

    symbols.set(symbolId, {
      name,
      kind: 'TypeAliasDeclaration',
      line: nameNode.startPosition.row + 1,
      isExported: this.isExported(node, content),
      id: symbolId,
      parentSymbolId,
      category: 'type',
    });

    this.extractSymbolsFromChildren(node, filePath, content, symbols, symbolId);
  }

  private handleInitDeclaration(
    node: Node,
    filePath: string,
    content: string,
    symbols: Map<string, SymbolInfo>,
    parentSymbolId?: string
  ): void {
    const symbolId = `${filePath}:init`;

    symbols.set(symbolId, {
      name: 'init',
      kind: 'InitializerDeclaration',
      line: node.startPosition.row + 1,
      isExported: this.isExported(node, content),
      id: symbolId,
      parentSymbolId,
      category: 'function',
    });

    this.extractSymbolsFromChildren(node, filePath, content, symbols, symbolId);
  }

  private extractSymbolsFromChildren(
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

  /**
   * Build a map of imported names to their module specifiers
   * e.g., Foundation -> Foundation, UIKit -> UIKit
   */
  private buildImportMap(node: Node, content: string): Map<string, string> {
    const importMap = new Map<string, string>();
    this.traverseForImports(node, importMap, content);
    return importMap;
  }

  private traverseForImports(node: Node, importMap: Map<string, string>, content: string): void {
    if (node.type === 'import_declaration') {
      this.processImportDeclaration(node, importMap, content);
    }

    for (const child of node.children) {
      this.traverseForImports(child, importMap, content);
    }
  }

  /** Handle: import module */
  private processImportDeclaration(node: Node, importMap: Map<string, string>, content: string): void {
    // Swift grammar: import_declaration -> identifier -> simple_identifier(s).
    const identifier = this.findChildByType(node, 'identifier');
    if (!identifier) {
      return;
    }
    const modulePath = this.getNodeText(identifier, content).trim();
    if (!modulePath) {
      return;
    }

    // Add both the full module path and components
    importMap.set(modulePath, modulePath);

    // Also add individual components for easier lookup
    const components = modulePath.split('.');
    for (let i = 1; i <= components.length; i++) {
      const partialPath = components.slice(0, i).join('.');
      importMap.set(partialPath, modulePath);
    }
  }

  /**
   * Extract symbol dependencies from AST
   */
  private extractDependencies(
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
    this.addTypeDependencyIfAny(node, filePath, content, dependencies, symbols, newScope, importMap);

    for (const child of node.children) {
      this.extractDependencies(child, filePath, content, dependencies, symbols, newScope, importMap);
    }
  }

  private getScopeForNode(
    node: Node,
    filePath: string,
    content: string,
    currentScope?: string
  ): string | undefined {
    const symbolTypes = [
      'function_declaration',
      'class_declaration',
      'protocol_declaration',
      'typealias_declaration',
      'init_declaration',
    ];

    if (!symbolTypes.includes(node.type)) {
      return currentScope;
    }

    let name: string;
    if (node.type === 'init_declaration') {
      name = 'init';
    } else {
      const nameNode = node.childForFieldName('name');
      if (!nameNode) {
        return currentScope;
      }
      // extension: the `class_declaration` name field is a user_type node; keep
      // the id format in sync with handleClassDeclaration (`extension:<name>`).
      if (node.type === 'class_declaration' && nameNode.type === 'user_type') {
        name = `extension:${this.getNodeText(nameNode, content)}`;
      } else {
        name = this.getNodeText(nameNode, content);
      }
    }

    return `${filePath}:${name}`;
  }

  private addCallDependencyIfAny(
    node: Node,
    filePath: string,
    content: string,
    dependencies: SymbolDependency[],
    symbols: Map<string, SymbolInfo>,
    scope?: string,
    importMap?: Map<string, string>
  ): void {
    if (node.type !== 'call_expression') {
      return;
    }

    if (!scope) {
      return;
    }

    // Swift call_expression has no `function` field: the callee is the first
    // child (simple_identifier for direct/constructor calls, navigation_expression
    // for method calls).
    const funcNode = this.getCallCallee(node);
    if (!funcNode) {
      return;
    }

    const calledName = this.getCalledName(funcNode, content);

    // Check if it's a call to a local symbol (same file)
    const localTargetSymbolId = `${filePath}:${calledName}`;
    if (symbols.has(localTargetSymbolId)) {
      dependencies.push({
        sourceSymbolId: scope,
        targetSymbolId: localTargetSymbolId,
        targetFilePath: filePath,
        isTypeOnly: false,
      });
      return;
    }

    // Check if it's a call to an imported symbol (external file)
    if (importMap?.has(calledName)) {
      const moduleSpecifier = importMap.get(calledName);
      if (moduleSpecifier === undefined) return;
      // Create dependency with module specifier as targetFilePath
      // This will be resolved to absolute path by SpiderSymbolService.getSymbolGraph()
      dependencies.push({
        sourceSymbolId: scope,
        targetSymbolId: `${moduleSpecifier}:${calledName}`, // Module specifier + symbol name
        targetFilePath: moduleSpecifier, // Will be resolved by PathResolver
        isTypeOnly: false,
      });
    }
  }

  private addTypeDependencyIfAny(
    node: Node,
    filePath: string,
    content: string,
    dependencies: SymbolDependency[],
    symbols: Map<string, SymbolInfo>,
    scope?: string,
    importMap?: Map<string, string>
  ): void {
    // Handle type references in parameter declarations, return types, etc.
    if (node.type !== 'type_identifier' && node.type !== 'user_type') {
      return;
    }

    if (!scope) {
      return;
    }

    const typeName = this.getNodeText(node, content);

    // Check if it's a reference to a local symbol (same file)
    const localTargetSymbolId = `${filePath}:${typeName}`;
    if (symbols.has(localTargetSymbolId)) {
      dependencies.push({
        sourceSymbolId: scope,
        targetSymbolId: localTargetSymbolId,
        targetFilePath: filePath,
        isTypeOnly: true,
      });
      return;
    }

    // Check if it's a reference to an imported type (external file)
    if (importMap?.has(typeName)) {
      const moduleSpecifier = importMap.get(typeName);
      if (moduleSpecifier === undefined) return;
      dependencies.push({
        sourceSymbolId: scope,
        targetSymbolId: `${moduleSpecifier}:${typeName}`,
        targetFilePath: moduleSpecifier,
        isTypeOnly: true,
      });
    }
  }

  private getCallCallee(callNode: Node): Node | null {
    // Swift call_expression: callee is the first simple_identifier
    // (direct / constructor call) or navigation_expression (method call).
    for (const child of callNode.children) {
      if (child.type === 'simple_identifier' || child.type === 'navigation_expression') {
        return child;
      }
    }
    return null;
  }

  private getCalledName(funcNode: Node, content: string): string {
    if (funcNode.type === 'simple_identifier') {
      return this.getNodeText(funcNode, content);
    }

    // Method call: navigation_expression -> navigation_suffix -> suffix (simple_identifier).
    if (funcNode.type === 'navigation_expression') {
      const suffix = this.findChildByType(funcNode, 'navigation_suffix');
      if (suffix) {
        const id = this.findChildByType(suffix, 'simple_identifier');
        if (id) {
          return this.getNodeText(id, content);
        }
      }
      return this.getNodeText(funcNode, content);
    }

    return this.getNodeText(funcNode, content);
  }

  /**
   * Check if a symbol is exported (public, internal, or default)
   */
  private isExported(node: Node, content: string): boolean {
    // Swift access modifiers may sit in `modifier`, `access_level_modifier`,
    // or another node depending on grammar version. Match by text on direct
    // children so the check is robust to the node-type name.
    for (const child of node.children) {
      const text = this.getNodeText(child, content);
      if (text === 'private' || text === 'fileprivate') {
        return false;
      }
    }

    // Default access level in Swift is internal (exported within module)
    return true;
  }

  /**
   * Check if node has a child of specific type
   */
  private hasChild(node: Node, type: string): boolean {
    for (const child of node.children) {
      if (child.type === type) {
        return true;
      }
    }
    return false;
  }

  /**
   * Find the first direct child of a specific type, if any
   */
  private findChildByType(node: Node, type: string): Node | null {
    for (const child of node.children) {
      if (child.type === type) {
        return child;
      }
    }
    return null;
  }

  /**
   * Get text content of a node
   */
  private getNodeText(node: Node, content: string): string {
    return content.slice(node.startIndex, node.endIndex);
  }
}
