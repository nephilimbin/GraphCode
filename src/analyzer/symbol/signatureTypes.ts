/**
 * SignatureAnalyzer 相关类型定义。
 *
 * 从 SignatureAnalyzer.ts 抽出,供 SignatureExtractor / SignatureComparator /
 * SignatureAnalyzer(facade)共用。SignatureAnalyzer.ts re-export 全部类型,
 * 保持对外导入路径('../symbol/SignatureAnalyzer')不变。
 */

/** Represents a function/method parameter */
export interface ParameterInfo {
  name: string;
  type: string;
  isOptional: boolean;
  hasDefault: boolean;
  isRest: boolean;
  position: number;
}

/** Represents a function/method signature */
export interface SignatureInfo {
  name: string;
  kind: 'function' | 'method' | 'constructor' | 'arrow';
  parameters: ParameterInfo[];
  returnType: string;
  isAsync: boolean;
  isStatic?: boolean;
  visibility?: 'public' | 'private' | 'protected';
  typeParameters?: string[];
  line: number;
}

/** Represents an interface property or method */
export interface InterfaceMemberInfo {
  name: string;
  kind: 'property' | 'method' | 'index';
  type: string;
  isOptional: boolean;
  isReadonly: boolean;
}

/** Represents a type alias definition */
export interface TypeAliasInfo {
  name: string;
  type: string;
  typeParameters?: string[];
}

/** Types of breaking changes that can be detected */
export type BreakingChangeType =
  | 'parameter-added-required'     // New required parameter added
  | 'parameter-removed'            // Parameter removed
  | 'parameter-type-changed'       // Parameter type changed
  | 'parameter-optional-to-required' // Optional param became required
  | 'return-type-changed'          // Return type changed
  | 'visibility-reduced'           // public → private/protected
  | 'member-removed'               // Interface/class member removed
  | 'member-type-changed'          // Interface/class member type changed
  | 'member-optional-to-required'  // Optional member became required
  | 'type-alias-changed';          // Type alias definition changed

/** Represents a detected breaking change */
export interface BreakingChange {
  type: BreakingChangeType;
  symbolName: string;
  description: string;
  severity: 'error' | 'warning';
  oldValue?: string;
  newValue?: string;
  line?: number;
}

/** Result of signature comparison */
export interface SignatureComparisonResult {
  symbolName: string;
  hasBreakingChanges: boolean;
  breakingChanges: BreakingChange[];
  nonBreakingChanges: string[];
}
