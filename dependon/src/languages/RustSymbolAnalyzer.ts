/**
 * @module dependon/languages
 */
import { Node } from "web-tree-sitter";
import { SymbolInfo } from '../domain/Symbol';
import { WasmBaseSymbolAnalyzer } from './WasmBaseSymbolAnalyzer';

/**
 * Rust symbol analyzer backed by tree-sitter WASM.
 * 公共流程(WASM 初始化 / 解析 / 符号抽取骨架)由 WasmBaseSymbolAnalyzer 提供,
 * 本类只实现 Rust 特有:符号声明节点识别、use/mod import 语法、调用/作用域规则。
 * In unit tests, mock `WasmParserFactory` directly to avoid WASM initialization.
 */
export class RustSymbolAnalyzer extends WasmBaseSymbolAnalyzer {
  protected readonly languageConfig = {
    parserLanguage: "rust",
    wasmFileName: "tree-sitter-rust.wasm",
    label: "Rust",
  } as const;

  protected tryExtractSymbolFromNode(
    node: Node,
    filePath: string,
    content: string,
    symbols: Map<string, SymbolInfo>,
    parentSymbolId?: string
  ): boolean {
    if (node.type === 'function_item') {
      this.handleFunctionItem(node, filePath, content, symbols, parentSymbolId);
      return true;
    }

    if (node.type === 'struct_item') {
      this.handleStructItem(node, filePath, content, symbols, parentSymbolId);
      return true;
    }

    if (node.type === 'enum_item') {
      this.handleEnumItem(node, filePath, content, symbols, parentSymbolId);
      return true;
    }

    if (node.type === 'trait_item') {
      this.handleTraitItem(node, filePath, content, symbols, parentSymbolId);
      return true;
    }

    if (node.type === 'impl_item') {
      this.handleImplItem(node, filePath, content, symbols, parentSymbolId);
      return true;
    }

    return false;
  }

  private handleFunctionItem(
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
    const isAsync = this.hasModifier(node, 'async');
    const isPublic = this.hasVisibilityModifier(node, 'pub');

    symbols.set(symbolId, {
      name,
      kind: isAsync ? 'AsyncFunction' : 'FunctionDeclaration',
      line: nameNode.startPosition.row + 1,
      isExported: isPublic,
      id: symbolId,
      parentSymbolId,
      category: 'function',
    });

    this.extractSymbolsFromChildren(node, filePath, content, symbols, symbolId);
  }

  private handleStructItem(
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
    const isPublic = this.hasVisibilityModifier(node, 'pub');

    symbols.set(symbolId, {
      name,
      kind: 'StructDeclaration',
      line: nameNode.startPosition.row + 1,
      isExported: isPublic,
      id: symbolId,
      parentSymbolId,
      category: 'class',
    });

    this.extractSymbolsFromChildren(node, filePath, content, symbols, symbolId);
  }

  private handleEnumItem(
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
    const isPublic = this.hasVisibilityModifier(node, 'pub');

    symbols.set(symbolId, {
      name,
      kind: 'EnumDeclaration',
      line: nameNode.startPosition.row + 1,
      isExported: isPublic,
      id: symbolId,
      parentSymbolId,
      category: 'type',
    });

    this.extractSymbolsFromChildren(node, filePath, content, symbols, symbolId);
  }

  private handleTraitItem(
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
    const isPublic = this.hasVisibilityModifier(node, 'pub');

    symbols.set(symbolId, {
      name,
      kind: 'InterfaceDeclaration',
      line: nameNode.startPosition.row + 1,
      isExported: isPublic,
      id: symbolId,
      parentSymbolId,
      category: 'type',
    });

    this.extractSymbolsFromChildren(node, filePath, content, symbols, symbolId);
  }

  private handleImplItem(
    node: Node,
    filePath: string,
    content: string,
    symbols: Map<string, SymbolInfo>,
    parentSymbolId?: string
  ): void {
    // impl blocks don't have a name themselves, extract methods inside
    this.extractSymbolsFromChildren(node, filePath, content, symbols, parentSymbolId);
  }

  /**
   * Build a map of imported names to their module specifiers
   * e.g., HashMap -> std::collections::HashMap
   */
  protected buildImportMap(node: Node, content: string): Map<string, string> {
    const importMap = new Map<string, string>();

    const traverse = (n: Node) => {
      // Handle: use path::to::module;
      if (n.type === 'use_declaration') {
        this.extractUseDeclarationImports(n, content, importMap);
      }

      // Handle: mod module_name; (declare a module)
      // This is critical for Rust - mod declarations bring modules into scope
      if (n.type === 'mod_item') {
        const nameNode = n.childForFieldName('name');
        if (nameNode) {
          const moduleName = this.getNodeText(nameNode, content);
          // Map module name to itself (will be resolved to file path later)
          importMap.set(moduleName, moduleName);
        }
      }

      for (const child of n.children) {
        traverse(child);
      }
    };

    traverse(node);
    return importMap;
  }

  private extractUseDeclarationImports(
    node: Node,
    content: string,
    importMap: Map<string, string>
  ): void {
    // Handle use_list (e.g., use path::{A, B, C})
    this.extractFromUseLists(node, content, importMap);

    // Find scoped_identifier (e.g., std::collections::HashMap or utils::helpers::format_data)
    this.extractFromScopedIdentifiers(node, content, importMap);

    // Handle use_as_clause (aliasing)
    this.extractFromUseAsClauses(node, content, importMap);
  }

  /**
   * Extract imports from use_list syntax (e.g., use path::{A, B, C})
   */
  private extractFromUseLists(
    node: Node,
    content: string,
    importMap: Map<string, string>
  ): void {
    const useLists = this.findAllByType(node, 'use_list');
    for (const useList of useLists) {
      const baseModule = this.findBaseModuleForUseList(useList, content);
      this.extractIdentifiersFromUseList(useList, baseModule, content, importMap);
    }
  }

  /**
   * Find the base module path for a use_list by traversing parent nodes
   */
  private findBaseModuleForUseList(useList: Node, content: string): string {
    let current = useList.parent;
    while (current) {
      if (current.type === 'scoped_use_list') {
        const baseModule = this.findScopedIdentifierInChildren(current, content);
        if (baseModule) return baseModule;
      }
      current = current.parent;
    }
    return '';
  }

  /**
   * Find scoped_identifier in children nodes
   */
  private findScopedIdentifierInChildren(node: Node, content: string): string {
    for (const child of node.children) {
      if (child.type === 'scoped_identifier') {
        return this.getNodeText(child, content);
      }
    }
    return '';
  }

  /**
   * Extract all identifiers from a use_list and add to import map
   */
  private extractIdentifiersFromUseList(
    useList: Node,
    baseModule: string,
    content: string,
    importMap: Map<string, string>
  ): void {
    for (const child of useList.children) {
      if (child.type === 'identifier') {
        const localName = this.getNodeText(child, content);
        // Import map: localName -> module path (without the symbol name)
        // E.g., connect_db -> utils::database
        importMap.set(localName, baseModule);
      }
    }
  }

  /**
   * Extract imports from scoped_identifier nodes (e.g., std::collections::HashMap)
   */
  private extractFromScopedIdentifiers(
    node: Node,
    content: string,
    importMap: Map<string, string>
  ): void {
    const scopedIds = this.findAllByType(node, 'scoped_identifier');
    for (const scopedId of scopedIds) {
      // Skip scoped_identifiers that are part of use_list (already handled above)
      if (this.hasAncestorOfType(scopedId, 'use_list')) {
        continue;
      }

      const fullPath = this.getNodeText(scopedId, content);
      const { localName, modulePath } = this.splitModulePath(fullPath);
      // Import map: localName -> module path
      // E.g., format_data -> utils::helpers
      importMap.set(localName, modulePath);
    }
  }

  /**
   * Split a full module path into local name and module path
   * E.g., "utils::helpers::format_data" -> { localName: "format_data", modulePath: "utils::helpers" }
   */
  private splitModulePath(fullPath: string): { localName: string; modulePath: string } {
    const parts = fullPath.split('::');
    const localName = parts.at(-1) ?? '';
    const modulePath = parts.slice(0, -1).join('::');
    return { localName, modulePath };
  }

  /**
   * Extract imports from use_as_clause (aliasing syntax)
   */
  private extractFromUseAsClauses(
    node: Node,
    content: string,
    importMap: Map<string, string>
  ): void {
    const useClauses = this.findAllByType(node, 'use_as_clause');
    for (const useClause of useClauses) {
      const pathNode = useClause.childForFieldName('path');
      const aliasNode = useClause.childForFieldName('alias');
      if (pathNode && aliasNode) {
        const path = this.getNodeText(pathNode, content);
        const alias = this.getNodeText(aliasNode, content);
        importMap.set(alias, path);
      }
    }
  }

  protected getScopeForNode(
    node: Node,
    filePath: string,
    content: string,
    currentScope?: string
  ): string | undefined {
    if (node.type !== 'function_item') {
      return currentScope;
    }

    const nameNode = node.childForFieldName('name');
    if (!nameNode) {
      return currentScope;
    }

    const name = this.getNodeText(nameNode, content);
    return `${filePath}:${name}`;
  }

  protected isCallExpression(node: Node): boolean {
    return node.type === 'call_expression';
  }

  protected extractCallCallee(node: Node): Node | null {
    return node.childForFieldName('function');
  }

  protected extractCallTarget(funcNode: Node, content: string): {
    calledName: string;
    moduleQualifier?: string;
  } {
    // Rust 限定调用 module::fn:moduleName 作为 moduleQualifier,symbolName 作为 calledName。
    const { moduleName, symbolName } = this.extractModuleAndSymbolName(funcNode, content);
    return { calledName: symbolName, moduleQualifier: moduleName };
  }

  /**
   * Extract module name and symbol name from a function node
   * Examples:
   *   helper::format_data  -> { moduleName: 'helper', symbolName: 'format_data' }
   *   format_data          -> { moduleName: undefined, symbolName: 'format_data' }
   *   obj.method           -> { moduleName: undefined, symbolName: 'method' }
   */
  private extractModuleAndSymbolName(funcNode: Node, content: string): {
    moduleName?: string;
    symbolName: string;
  } {
    // Handle field_expression (e.g., obj.method())
    if (funcNode.type === 'field_expression') {
      const fieldNode = funcNode.childForFieldName('field');
      if (fieldNode) {
        return {
          moduleName: undefined,
          symbolName: this.getNodeText(fieldNode, content),
        };
      }
    }

    // Handle scoped_identifier (e.g., module::function())
    if (funcNode.type === 'scoped_identifier') {
      const fullPath = this.getNodeText(funcNode, content);
      const parts = fullPath.split('::');

      if (parts.length >= 2) {
        // For helper::format_data, moduleName='helper', symbolName='format_data'
        // For std::collections::HashMap, moduleName='std::collections', symbolName='HashMap'
        const symbolName = parts.at(-1) ?? '';
        const moduleName = parts.slice(0, -1).join('::');

        return {
          moduleName,
          symbolName,
        };
      }

      return {
        moduleName: undefined,
        symbolName: parts[0],
      };
    }

    return {
      moduleName: undefined,
      symbolName: this.getNodeText(funcNode, content),
    };
  }

  /**
   * Check if node has a visibility modifier (pub)
   */
  private hasVisibilityModifier(node: Node, _modifier: string): boolean {
    // Check field name first
    const visNode = node.childForFieldName('visibility_modifier');
    if (visNode) {
      return true; // In Rust, if visibility_modifier exists, it's 'pub'
    }

    // Also check direct children for 'visibility_modifier' node type
    for (const child of node.children) {
      if (child.type === 'visibility_modifier') {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if node has an ancestor of a specific type
   */
  private hasAncestorOfType(node: Node, ancestorType: string): boolean {
    let current = node.parent;
    while (current) {
      if (current.type === ancestorType) {
        return true;
      }
      current = current.parent;
    }
    return false;
  }

  /**
   * Check if node has a specific modifier
   */
  private hasModifier(node: Node, modifier: string): boolean {
    for (const child of node.children) {
      if (child.type === modifier) {
        return true;
      }
    }
    return false;
  }

  /**
   * Find all nodes of a specific type
   */
  private findAllByType(node: Node, type: string): Node[] {
    const results: Node[] = [];

    const traverse = (n: Node) => {
      if (n.type === type) {
        results.push(n);
      }
      for (const child of n.children) {
        traverse(child);
      }
    };

    traverse(node);
    return results;
  }
}
