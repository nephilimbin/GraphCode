import { Node } from "web-tree-sitter";
import { SymbolDependency, SymbolInfo } from '../foundation/types';
import { WasmBaseSymbolAnalyzer } from './WasmBaseSymbolAnalyzer';

/**
 * Python symbol analyzer backed by tree-sitter WASM.
 * 公共流程(WASM 初始化 / 解析 / 符号抽取骨架)由 WasmBaseSymbolAnalyzer 提供,
 * 本类只实现 Python 特有:符号声明节点识别、import 语法、调用/作用域规则。
 * In unit tests, mock `WasmParserFactory` directly to avoid WASM initialization.
 */
export class PythonSymbolAnalyzer extends WasmBaseSymbolAnalyzer {
  protected readonly languageConfig = {
    parserLanguage: "python",
    wasmFileName: "tree-sitter-python.wasm",
    label: "Python",
  } as const;

  protected tryExtractSymbolFromNode(
    node: Node,
    filePath: string,
    content: string,
    symbols: Map<string, SymbolInfo>,
    parentSymbolId?: string
  ): boolean {
    if (node.type === 'function_definition') {
      this.handleFunctionDefinition(node, filePath, content, symbols, parentSymbolId);
      return true;
    }

    if (node.type === 'class_definition') {
      this.handleClassDefinition(node, filePath, content, symbols, parentSymbolId);
      return true;
    }

    if (node.type === 'decorated_definition') {
      this.handleDecoratedDefinition(node, filePath, content, symbols, parentSymbolId);
      return true;
    }

    return false;
  }

  private handleFunctionDefinition(
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
    const isAsync = this.hasChild(node, 'async');

    symbols.set(symbolId, {
      name,
      kind: isAsync ? 'AsyncFunction' : 'FunctionDeclaration',
      line: nameNode.startPosition.row + 1,
      isExported: this.isExported(node, content),
      id: symbolId,
      parentSymbolId,
      category: 'function',
    });

    this.extractSymbolsFromChildren(node, filePath, content, symbols, symbolId);
  }

  private handleClassDefinition(
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
      kind: 'ClassDeclaration',
      line: nameNode.startPosition.row + 1,
      isExported: this.isExported(node, content),
      id: symbolId,
      parentSymbolId,
      category: 'class',
    });

    this.extractSymbolsFromChildren(node, filePath, content, symbols, symbolId);
  }

  private handleDecoratedDefinition(
    node: Node,
    filePath: string,
    content: string,
    symbols: Map<string, SymbolInfo>,
    parentSymbolId?: string
  ): void {
    for (const child of node.children) {
      if (child.type === 'function_definition' || child.type === 'class_definition') {
        this.extractSymbols(child, filePath, content, symbols, parentSymbolId);
      }
    }
  }

  /**
   * Build a map of imported names to their module specifiers
   * e.g., format_result -> utils.helpers, connect_db -> utils.database
   */
  protected buildImportMap(node: Node, content: string): Map<string, string> {
    const importMap = new Map<string, string>();
    this.traverseForImports(node, importMap, content);
    return importMap;
  }

  private traverseForImports(node: Node, importMap: Map<string, string>, content: string): void {
    if (node.type === 'import_from_statement') {
      this.processFromImport(node, importMap, content);
    } else if (node.type === 'import_statement') {
      this.processImportStatement(node, importMap, content);
    }

    for (const child of node.children) {
      this.traverseForImports(child, importMap, content);
    }
  }

  /** Handle: from module import name [as alias] */
  private processFromImport(node: Node, importMap: Map<string, string>, content: string): void {
    const moduleNode = node.childForFieldName('module_name');
    if (!moduleNode) {
      return;
    }

    const modulePath = this.getNodeText(moduleNode, content);

    for (const child of node.children) {
      this.processFromImportChild(child, importMap, content, modulePath);
    }
  }

  private processFromImportChild(
    child: Node,
    importMap: Map<string, string>,
    content: string,
    modulePath: string
  ): void {
    if (child.type === 'aliased_import') {
      this.addAliasedFromImport(child, importMap, content, modulePath);
      return;
    }

    if (child.type === 'dotted_name' || child.type === 'identifier') {
      const nameText = this.getNodeText(child, content);
      // Skip the module name itself and names that are part of an aliased_import
      if (nameText === modulePath || child.parent?.type === 'aliased_import') {
        return;
      }
      importMap.set(nameText, modulePath);
    }
  }

  private addAliasedFromImport(
    child: Node,
    importMap: Map<string, string>,
    content: string,
    modulePath: string
  ): void {
    const nameNode = child.childForFieldName('name');
    if (!nameNode) {
      return;
    }
    const name = this.getNodeText(nameNode, content);
    const aliasNode = child.childForFieldName('alias');
    const alias = aliasNode ? this.getNodeText(aliasNode, content) : name;
    importMap.set(alias, modulePath);
  }

  /** Handle: import module [as alias] */
  private processImportStatement(node: Node, importMap: Map<string, string>, content: string): void {
    for (const child of node.children) {
      this.processImportStatementChild(child, importMap, content);
    }
  }

  private processImportStatementChild(
    child: Node,
    importMap: Map<string, string>,
    content: string
  ): void {
    if (child.type === 'aliased_import') {
      const nameNode = child.childForFieldName('name');
      if (!nameNode) {
        return;
      }
      const modulePath = this.getNodeText(nameNode, content);
      const aliasNode = child.childForFieldName('alias');
      const alias = aliasNode ? this.getNodeText(aliasNode, content) : modulePath;
      importMap.set(alias, modulePath);
      return;
    }

    if (child.type === 'dotted_name' || child.type === 'identifier') {
      const modulePath = this.getNodeText(child, content);
      if (modulePath !== 'import') {
        importMap.set(modulePath, modulePath);
      }
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
    if (node.type !== 'function_definition' && node.type !== 'class_definition') {
      return currentScope;
    }

    const nameNode = node.childForFieldName('name');
    if (!nameNode) {
      return currentScope;
    }

    const name = this.getNodeText(nameNode, content);
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
    if (node.type !== 'call') {
      return;
    }

    const funcNode = node.childForFieldName('function');
    if (!funcNode || !scope) {
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

  private getCalledName(funcNode: Node, content: string): string {
    if (funcNode.type !== 'attribute') {
      return this.getNodeText(funcNode, content);
    }

    const attrNode = funcNode.childForFieldName('attribute');
    if (!attrNode) {
      return this.getNodeText(funcNode, content);
    }

    return this.getNodeText(attrNode, content);
  }

  /**
   * Check if a symbol is exported (Python doesn't have explicit exports, so we check if it's not private)
   */
  private isExported(node: Node, content: string): boolean {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {
      return false;
    }
    const name = this.getNodeText(nameNode, content);
    // In Python, names starting with _ are considered private
    return !name.startsWith('_');
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
}
