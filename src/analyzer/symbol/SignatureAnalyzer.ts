/**
 * SignatureAnalyzer - Detects breaking changes in function/method signatures
 *
 * Facade:编排 SignatureExtractor(提取)与 SignatureComparator(比较),并实现
 * 文件级破坏性变更分析(analyzeBreakingChanges)。对外契约(公开方法 + 类型
 * 导出)不变,AstWorker 无需修改。
 *
 * CRITICAL ARCHITECTURE RULE: This module is completely VS Code agnostic!
 * NO import * as vscode from 'vscode' allowed!
 */

export * from './signatureTypes';

import type {
  BreakingChangeType,
  InterfaceMemberInfo,
  SignatureComparisonResult,
  SignatureInfo,
  TypeAliasInfo,
} from './signatureTypes';
import { SignatureExtractor } from './SignatureExtractor';
import { SignatureComparator } from './SignatureComparator';

/**
 * SignatureAnalyzer extracts and compares signatures to detect breaking changes.
 */
export class SignatureAnalyzer {
  private readonly extractor: SignatureExtractor;
  private readonly comparator: SignatureComparator;

  constructor() {
    this.extractor = new SignatureExtractor();
    this.comparator = new SignatureComparator();
  }

  /**
   * Extract all function/method signatures from a file
   */
  extractSignatures(filePath: string, content: string): SignatureInfo[] {
    return this.extractor.extractSignatures(filePath, content);
  }

  /**
   * Extract interface members for comparison
   */
  extractInterfaceMembers(filePath: string, content: string): Map<string, InterfaceMemberInfo[]> {
    return this.extractor.extractInterfaceMembers(filePath, content);
  }

  /**
   * Extract type alias definitions
   */
  extractTypeAliases(filePath: string, content: string): TypeAliasInfo[] {
    return this.extractor.extractTypeAliases(filePath, content);
  }

  /**
   * Compare two signatures and detect breaking changes
   */
  compareSignatures(
    oldSig: SignatureInfo,
    newSig: SignatureInfo
  ): SignatureComparisonResult {
    return this.comparator.compareSignatures(oldSig, newSig);
  }

  /**
   * Compare interface definitions and detect breaking changes
   */
  compareInterfaces(
    interfaceName: string,
    oldMembers: InterfaceMemberInfo[],
    newMembers: InterfaceMemberInfo[]
  ): SignatureComparisonResult {
    return this.comparator.compareInterfaces(interfaceName, oldMembers, newMembers);
  }

  /**
   * Compare type aliases and detect breaking changes
   */
  compareTypeAliases(
    oldType: TypeAliasInfo,
    newType: TypeAliasInfo
  ): SignatureComparisonResult {
    return this.comparator.compareTypeAliases(oldType, newType);
  }

  /**
   * Analyze a file for potential breaking changes compared to an old version
   */
  analyzeBreakingChanges(
    filePath: string,
    oldContent: string,
    newContent: string
  ): SignatureComparisonResult[] {
    const results: SignatureComparisonResult[] = [];

    // Compare functions
    this.compareFunctions(filePath, oldContent, newContent, results);

    // Compare interfaces
    this.compareInterfaceDefinitions(filePath, oldContent, newContent, results);

    // Compare type aliases
    this.compareTypeAliasDefinitions(filePath, oldContent, newContent, results);

    return results;
  }

  // ============================================================================
  // Private: 文件级编排(用 extractor 提取 old/new + comparator 比较)
  // ============================================================================

  /**
   * Compare functions between old and new content
   */
  private compareFunctions(
    filePath: string,
    oldContent: string,
    newContent: string,
    results: SignatureComparisonResult[]
  ): void {
    const oldSigs = this.extractor.extractSignatures(`${filePath}.old`, oldContent);
    const newSigs = this.extractor.extractSignatures(`${filePath}.new`, newContent);

    const oldSigMap = new Map(oldSigs.map(s => [s.name, s]));
    const newSigMap = new Map(newSigs.map(s => [s.name, s]));

    for (const [name, oldSig] of oldSigMap) {
      const newSig = newSigMap.get(name);
      if (newSig) {
        const result = this.comparator.compareSignatures(oldSig, newSig);
        if (result.hasBreakingChanges || result.nonBreakingChanges.length > 0) {
          results.push(result);
        }
      } else {
        results.push(this.createRemovedResult(name, 'member-removed', `Function '${name}' was removed`, oldSig.line));
      }
    }
  }

  /**
   * Compare interface definitions between old and new content
   */
  private compareInterfaceDefinitions(
    filePath: string,
    oldContent: string,
    newContent: string,
    results: SignatureComparisonResult[]
  ): void {
    const oldInterfaces = this.extractor.extractInterfaceMembers(`${filePath}.old`, oldContent);
    const newInterfaces = this.extractor.extractInterfaceMembers(`${filePath}.new`, newContent);

    for (const [name, oldMembers] of oldInterfaces) {
      const newMembers = newInterfaces.get(name);
      if (newMembers) {
        const result = this.comparator.compareInterfaces(name, oldMembers, newMembers);
        if (result.hasBreakingChanges || result.nonBreakingChanges.length > 0) {
          results.push(result);
        }
      } else {
        results.push(this.createRemovedResult(name, 'member-removed', `Interface '${name}' was removed`));
      }
    }
  }

  /**
   * Compare type alias definitions between old and new content
   */
  private compareTypeAliasDefinitions(
    filePath: string,
    oldContent: string,
    newContent: string,
    results: SignatureComparisonResult[]
  ): void {
    const oldTypes = this.extractor.extractTypeAliases(`${filePath}.old`, oldContent);
    const newTypes = this.extractor.extractTypeAliases(`${filePath}.new`, newContent);

    const oldTypeMap = new Map(oldTypes.map(t => [t.name, t]));
    const newTypeMap = new Map(newTypes.map(t => [t.name, t]));

    for (const [name, oldType] of oldTypeMap) {
      const newType = newTypeMap.get(name);
      if (newType) {
        const result = this.comparator.compareTypeAliases(oldType, newType);
        if (result.hasBreakingChanges) {
          results.push(result);
        }
      } else {
        results.push(this.createRemovedResult(name, 'type-alias-changed', `Type alias '${name}' was removed`));
      }
    }
  }

  /**
   * Create a result for a removed symbol
   */
  private createRemovedResult(
    name: string,
    type: BreakingChangeType,
    description: string,
    line?: number
  ): SignatureComparisonResult {
    return {
      symbolName: name,
      hasBreakingChanges: true,
      breakingChanges: [{
        type,
        symbolName: name,
        description,
        severity: 'error',
        line,
      }],
      nonBreakingChanges: [],
    };
  }
}
