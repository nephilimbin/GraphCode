import { Node } from "web-tree-sitter";
import { SymbolDependency, SymbolInfo } from '../foundation/types';
import { WasmBaseSymbolAnalyzer } from './WasmBaseSymbolAnalyzer';

/**
 * Swift symbol analyzer backed by tree-sitter WASM.
 * 公共流程(WASM 初始化 / 解析 / 符号抽取骨架)由 WasmBaseSymbolAnalyzer 提供,
 * 本类只实现 Swift 特有:符号声明节点识别、import 语法、调用/类型/作用域规则。
 * In unit tests, mock `WasmParserFactory` directly to avoid WASM initialization.
 */
export class SwiftSymbolAnalyzer extends WasmBaseSymbolAnalyzer {
  protected readonly languageConfig = {
    parserLanguage: "swift",
    wasmFileName: "tree-sitter-swift.wasm",
    label: "Swift",
  } as const;

  protected tryExtractSymbolFromNode(
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

  /**
   * Build a map of imported names to their module specifiers
   * e.g., Foundation -> Foundation, UIKit -> UIKit
   */
  protected buildImportMap(node: Node, content: string): Map<string, string> {
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
}
