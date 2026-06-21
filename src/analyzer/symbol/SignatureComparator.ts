import type {
  BreakingChange,
  InterfaceMemberInfo,
  ParameterInfo,
  SignatureComparisonResult,
  SignatureInfo,
  TypeAliasInfo,
} from './signatureTypes';

/**
 * SignatureComparator —— 比较签名信息,检测破坏性变更(纯逻辑,无 ts-morph Project)。
 *
 * 从 SignatureAnalyzer 抽出的"比较"职责:接收已提取的 SignatureInfo /
 * InterfaceMemberInfo / TypeAliasInfo,产出 SignatureComparisonResult。文件级
 * 编排(analyzeBreakingChanges)在 facade SignatureAnalyzer。
 */
export class SignatureComparator {
  /**
   * Compare two signatures and detect breaking changes
   */
  compareSignatures(
    oldSig: SignatureInfo,
    newSig: SignatureInfo
  ): SignatureComparisonResult {
    const breakingChanges: BreakingChange[] = [];
    const nonBreakingChanges: string[] = [];

    // Check for parameter changes
    this.compareParameters(oldSig, newSig, breakingChanges, nonBreakingChanges);

    // Check return type
    if (oldSig.returnType !== newSig.returnType) {
      // Widening return type is a breaking change for consumers
      breakingChanges.push({
        type: 'return-type-changed',
        symbolName: newSig.name,
        description: `Return type changed from '${oldSig.returnType}' to '${newSig.returnType}'`,
        severity: 'error',
        oldValue: oldSig.returnType,
        newValue: newSig.returnType,
        line: newSig.line,
      });
    }

    // Check visibility
    if (oldSig.visibility && newSig.visibility) {
      const visibilityOrder = { public: 3, protected: 2, private: 1 };
      const oldLevel = visibilityOrder[oldSig.visibility];
      const newLevel = visibilityOrder[newSig.visibility];

      if (newLevel < oldLevel) {
        breakingChanges.push({
          type: 'visibility-reduced',
          symbolName: newSig.name,
          description: `Visibility reduced from '${oldSig.visibility}' to '${newSig.visibility}'`,
          severity: 'error',
          oldValue: oldSig.visibility,
          newValue: newSig.visibility,
          line: newSig.line,
        });
      }
    }

    return {
      symbolName: newSig.name,
      hasBreakingChanges: breakingChanges.length > 0,
      breakingChanges,
      nonBreakingChanges,
    };
  }

  /**
   * Compare interface definitions and detect breaking changes
   */
  compareInterfaces(
    interfaceName: string,
    oldMembers: InterfaceMemberInfo[],
    newMembers: InterfaceMemberInfo[]
  ): SignatureComparisonResult {
    const breakingChanges: BreakingChange[] = [];
    const nonBreakingChanges: string[] = [];

    const oldMemberMap = new Map(oldMembers.map(m => [m.name, m]));
    const newMemberMap = new Map(newMembers.map(m => [m.name, m]));

    // Check for removed members
    for (const [name, oldMember] of oldMemberMap) {
      if (!newMemberMap.has(name)) {
        breakingChanges.push({
          type: 'member-removed',
          symbolName: `${interfaceName}.${name}`,
          description: `Member '${name}' was removed from interface '${interfaceName}'`,
          severity: 'error',
          oldValue: oldMember.type,
        });
      }
    }

    // Check for type changes and optional → required
    for (const [name, newMember] of newMemberMap) {
      const oldMember = oldMemberMap.get(name);

      if (!oldMember) {
        if (newMember.isOptional) {
          nonBreakingChanges.push(`New optional member '${name}' added`);
        } else {
          // New required member is a breaking change
          breakingChanges.push({
            type: 'member-optional-to-required',
            symbolName: `${interfaceName}.${name}`,
            description: `New required member '${name}' added to interface '${interfaceName}'`,
            severity: 'error',
            newValue: newMember.type,
          });
        }
        continue;
      }

      // Check type change
      if (oldMember.type !== newMember.type) {
        breakingChanges.push({
          type: 'member-type-changed',
          symbolName: `${interfaceName}.${name}`,
          description: `Type of member '${name}' changed from '${oldMember.type}' to '${newMember.type}'`,
          severity: 'error',
          oldValue: oldMember.type,
          newValue: newMember.type,
        });
      }

      // Check optional → required
      if (oldMember.isOptional && !newMember.isOptional) {
        breakingChanges.push({
          type: 'member-optional-to-required',
          symbolName: `${interfaceName}.${name}`,
          description: `Member '${name}' changed from optional to required`,
          severity: 'error',
        });
      }
    }

    return {
      symbolName: interfaceName,
      hasBreakingChanges: breakingChanges.length > 0,
      breakingChanges,
      nonBreakingChanges,
    };
  }

  /**
   * Compare type aliases and detect breaking changes
   */
  compareTypeAliases(
    oldType: TypeAliasInfo,
    newType: TypeAliasInfo
  ): SignatureComparisonResult {
    const breakingChanges: BreakingChange[] = [];
    const nonBreakingChanges: string[] = [];

    if (oldType.type !== newType.type) {
      breakingChanges.push({
        type: 'type-alias-changed',
        symbolName: newType.name,
        description: `Type alias '${newType.name}' changed from '${oldType.type}' to '${newType.type}'`,
        severity: 'warning', // Type changes might be intentional refinements
        oldValue: oldType.type,
        newValue: newType.type,
      });
    }

    return {
      symbolName: newType.name,
      hasBreakingChanges: breakingChanges.length > 0,
      breakingChanges,
      nonBreakingChanges,
    };
  }

  private compareParameters(
    oldSig: SignatureInfo,
    newSig: SignatureInfo,
    breakingChanges: BreakingChange[],
    nonBreakingChanges: string[]
  ): void {
    const oldParams = oldSig.parameters;
    const newParams = newSig.parameters;

    // Build maps for comparison
    const oldParamMap = new Map(oldParams.map(p => [p.name, p]));
    const newParamMap = new Map(newParams.map(p => [p.name, p]));

    // Check for removed parameters
    this.detectRemovedParameters(oldParams, newParamMap, newSig, breakingChanges);

    // Check each new parameter
    this.detectNewAndChangedParameters(newParams, oldParamMap, newSig, breakingChanges, nonBreakingChanges);

    // Check for position changes (can break positional calls)
    this.detectPositionChanges(oldParams, newParams, nonBreakingChanges);
  }

  /**
   * Detect parameters that were removed
   */
  private detectRemovedParameters(
    oldParams: ParameterInfo[],
    newParamMap: Map<string, ParameterInfo>,
    newSig: SignatureInfo,
    breakingChanges: BreakingChange[]
  ): void {
    for (const oldParam of oldParams) {
      if (!newParamMap.has(oldParam.name)) {
        breakingChanges.push({
          type: 'parameter-removed',
          symbolName: newSig.name,
          description: `Parameter '${oldParam.name}' was removed`,
          severity: 'error',
          oldValue: `${oldParam.name}: ${oldParam.type}`,
          line: newSig.line,
        });
      }
    }
  }

  /**
   * Detect new parameters and changes to existing parameters
   */
  private detectNewAndChangedParameters(
    newParams: ParameterInfo[],
    oldParamMap: Map<string, ParameterInfo>,
    newSig: SignatureInfo,
    breakingChanges: BreakingChange[],
    nonBreakingChanges: string[]
  ): void {
    for (const newParam of newParams) {
      const oldParam = oldParamMap.get(newParam.name);

      if (!oldParam) {
        this.handleNewParameter(newParam, newSig, breakingChanges, nonBreakingChanges);
        continue;
      }

      this.handleChangedParameter(oldParam, newParam, newSig, breakingChanges);
    }
  }

  /**
   * Handle a newly added parameter
   */
  private handleNewParameter(
    newParam: ParameterInfo,
    newSig: SignatureInfo,
    breakingChanges: BreakingChange[],
    nonBreakingChanges: string[]
  ): void {
    const isOptionalOrDefault = newParam.isOptional || newParam.hasDefault;
    if (isOptionalOrDefault) {
      nonBreakingChanges.push(`New optional parameter '${newParam.name}' added`);
    } else {
      breakingChanges.push({
        type: 'parameter-added-required',
        symbolName: newSig.name,
        description: `New required parameter '${newParam.name}' added`,
        severity: 'error',
        newValue: `${newParam.name}: ${newParam.type}`,
        line: newSig.line,
      });
    }
  }

  /**
   * Handle changes to an existing parameter
   */
  private handleChangedParameter(
    oldParam: ParameterInfo,
    newParam: ParameterInfo,
    newSig: SignatureInfo,
    breakingChanges: BreakingChange[]
  ): void {
    // Check type change
    if (oldParam.type !== newParam.type) {
      breakingChanges.push({
        type: 'parameter-type-changed',
        symbolName: newSig.name,
        description: `Type of parameter '${newParam.name}' changed from '${oldParam.type}' to '${newParam.type}'`,
        severity: 'error',
        oldValue: oldParam.type,
        newValue: newParam.type,
        line: newSig.line,
      });
    }

    // Check optional → required
    const wasOptional = oldParam.isOptional || oldParam.hasDefault;
    const isNowRequired = !newParam.isOptional && !newParam.hasDefault;
    if (wasOptional && isNowRequired) {
      breakingChanges.push({
        type: 'parameter-optional-to-required',
        symbolName: newSig.name,
        description: `Parameter '${newParam.name}' changed from optional to required`,
        severity: 'error',
        line: newSig.line,
      });
    }
  }

  /**
   * Detect parameter position changes
   */
  private detectPositionChanges(
    oldParams: ParameterInfo[],
    newParams: ParameterInfo[],
    nonBreakingChanges: string[]
  ): void {
    const minLength = Math.min(oldParams.length, newParams.length);
    for (let i = 0; i < minLength; i++) {
      if (oldParams[i].name !== newParams[i].name) {
        nonBreakingChanges.push(
          `Parameter order changed at position ${i}: '${oldParams[i].name}' → '${newParams[i].name}'`
        );
      }
    }
  }
}
