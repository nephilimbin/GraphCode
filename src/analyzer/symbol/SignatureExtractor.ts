import {
  Project,
  SourceFile,
  SyntaxKind,
  type FunctionDeclaration,
  type ParameterDeclaration,
  type Type,
} from 'ts-morph';
import type {
  InterfaceMemberInfo,
  ParameterInfo,
  SignatureInfo,
  TypeAliasInfo,
} from './signatureTypes';

/**
 * SignatureExtractor —— 用 ts-morph 从 TS/JS 源码提取签名信息。
 *
 * 从 SignatureAnalyzer 抽出的"提取"职责:持有内存 ts-morph Project,产出
 * SignatureInfo / InterfaceMemberInfo / TypeAliasInfo,不含比较逻辑。
 * VS Code agnostic(NO import vscode)。
 */
export class SignatureExtractor {
  private readonly project: Project;

  constructor() {
    this.project = new Project({
      skipAddingFilesFromTsConfig: true,
      useInMemoryFileSystem: true,
      compilerOptions: {
        target: 99, // ESNext
        module: 99, // ESNext
        strict: true,
      },
    });
  }

  /**
   * Extract all function/method signatures from a file
   */
  extractSignatures(filePath: string, content: string): SignatureInfo[] {
    const sourceFile = this.getOrCreateSourceFile(filePath, content);
    const signatures: SignatureInfo[] = [];

    // Extract top-level functions
    for (const func of sourceFile.getFunctions()) {
      const sig = this.extractFunctionSignature(func);
      if (sig) signatures.push(sig);
    }

    // Extract class methods
    for (const classDecl of sourceFile.getClasses()) {
      const className = classDecl.getName() ?? 'Anonymous';

      // Constructor
      const ctor = classDecl.getConstructors()[0];
      if (ctor) {
        signatures.push({
          name: `${className}.constructor`,
          kind: 'constructor',
          parameters: this.extractParameters(ctor.getParameters()),
          returnType: className,
          isAsync: false,
          line: ctor.getStartLineNumber(),
        });
      }

      // Methods
      for (const method of classDecl.getMethods()) {
        const methodName = method.getName();
        signatures.push({
          name: `${className}.${methodName}`,
          kind: 'method',
          parameters: this.extractParameters(method.getParameters()),
          returnType: this.safeGetTypeText(method.getReturnType(), 'void'),
          isAsync: method.isAsync(),
          isStatic: method.isStatic(),
          visibility: this.getVisibility(method),
          typeParameters: method.getTypeParameters().map(tp => this.safeGetText(tp)),
          line: method.getStartLineNumber(),
        });
      }
    }

    // Extract arrow functions in variable declarations
    for (const varDecl of sourceFile.getVariableDeclarations()) {
      const initializer = varDecl.getInitializer();
      if (initializer?.getKind() === SyntaxKind.ArrowFunction) {
        const arrowFunc = initializer.asKindOrThrow(SyntaxKind.ArrowFunction);
        signatures.push({
          name: varDecl.getName(),
          kind: 'arrow',
          parameters: this.extractParameters(arrowFunc.getParameters()),
          returnType: this.safeGetTypeText(arrowFunc.getReturnType(), 'unknown'),
          isAsync: arrowFunc.isAsync(),
          line: varDecl.getStartLineNumber(),
        });
      }
    }

    return signatures;
  }

  /**
   * Extract interface members for comparison
   */
  extractInterfaceMembers(filePath: string, content: string): Map<string, InterfaceMemberInfo[]> {
    const sourceFile = this.getOrCreateSourceFile(filePath, content);
    const result = new Map<string, InterfaceMemberInfo[]>();

    for (const iface of sourceFile.getInterfaces()) {
      const name = iface.getName();
      const members: InterfaceMemberInfo[] = [];

      // Properties
      for (const prop of iface.getProperties()) {
        members.push({
          name: prop.getName(),
          kind: 'property',
          type: this.safeGetTypeText(prop.getType(), 'unknown'),
          isOptional: prop.hasQuestionToken(),
          isReadonly: prop.isReadonly(),
        });
      }

      // Methods
      for (const method of iface.getMethods()) {
        const params = method.getParameters().map(p => `${p.getName()}: ${this.safeGetTypeText(p.getType(), 'unknown')}`).join(', ');
        const returnType = this.safeGetTypeText(method.getReturnType(), 'unknown');
        members.push({
          name: method.getName(),
          kind: 'method',
          type: `(${params}) => ${returnType}`,
          isOptional: method.hasQuestionToken(),
          isReadonly: false,
        });
      }

      result.set(name, members);
    }

    return result;
  }

  /**
   * Extract type alias definitions
   */
  extractTypeAliases(filePath: string, content: string): TypeAliasInfo[] {
    const sourceFile = this.getOrCreateSourceFile(filePath, content);
    const types: TypeAliasInfo[] = [];

    for (const typeAlias of sourceFile.getTypeAliases()) {
      types.push({
        name: typeAlias.getName(),
        type: this.safeGetTypeText(typeAlias.getType(), 'unknown'),
        typeParameters: typeAlias.getTypeParameters().map(tp => this.safeGetText(tp)),
      });
    }

    return types;
  }

  private getOrCreateSourceFile(filePath: string, content: string): SourceFile {
    // Always remove existing file to avoid stale type references
    const existing = this.project.getSourceFile(filePath);
    if (existing) {
      this.project.removeSourceFile(existing);
    }
    return this.project.createSourceFile(filePath, content);
  }

  private extractFunctionSignature(func: FunctionDeclaration): SignatureInfo | null {
    const name = func.getName();
    if (!name) return null;

    // Safely get return type with fallback
    let returnType: string;
    try {
      const type = func.getReturnType();
      returnType = this.safeGetTypeText(type, 'void');
    } catch {
      // If return type cannot be determined, use 'void' as fallback
      returnType = 'void';
    }

    return {
      name,
      kind: 'function',
      parameters: this.extractParameters(func.getParameters()),
      returnType,
      isAsync: func.isAsync(),
      typeParameters: func.getTypeParameters().map(tp => this.safeGetText(tp)),
      line: func.getStartLineNumber(),
    };
  }

  private extractParameters(params: ParameterDeclaration[]): ParameterInfo[] {
    return params.map((param, index) => ({
      name: param.getName(),
      type: this.safeGetTypeText(param.getType(), 'unknown'),
      isOptional: param.isOptional(),
      hasDefault: param.hasInitializer(),
      isRest: param.isRestParameter(),
      position: index,
    }));
  }

  /**
   * Safely get type text, handling edge cases where getText() may fail
   */
  private safeGetTypeText(type: Type | undefined, fallback: string): string {
    if (!type) return fallback;
    try {
      const text = type.getText();
      // Avoid overly complex type representations
      if (text.length > 200) {
        return type.getBaseTypeOfLiteralType()?.getText() ?? fallback;
      }
      return text || fallback;
    } catch {
      return fallback;
    }
  }

  /**
   * Safely get text from a node
   */
  private safeGetText(node: { getText?: () => string } | undefined): string {
    if (!node) return '';
    try {
      return node.getText?.() ?? '';
    } catch {
      return '';
    }
  }

  private getVisibility(
    node: { getScope?: () => import('ts-morph').Scope }
  ): 'public' | 'private' | 'protected' {
    const scope = node.getScope?.();
    if (!scope) return 'public';

    const scopeText = scope.toString();
    if (scopeText.includes('Private')) return 'private';
    if (scopeText.includes('Protected')) return 'protected';
    return 'public';
  }
}
