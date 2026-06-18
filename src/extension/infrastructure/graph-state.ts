import type { ProviderStateManager, ViewMode } from "../state/provider-state-manager";

export class GraphState {
  private reverseDependenciesVisible = false;
  private showFileLineCounts = false;
  private readonly activeExpansionControllers = new Map<string, AbortController>();
  private readonly stateManager: ProviderStateManager;

  constructor(stateManager: ProviderStateManager) {
    this.stateManager = stateManager;
  }

  getViewMode(): ViewMode {
    return this.stateManager.viewMode;
  }

  getUnusedFilterActive(): boolean {
    return this.stateManager.getUnusedFilterActive();
  }

  getExpandAll(): boolean {
    return this.stateManager.getExpandAll();
  }

  async setExpandAll(value: boolean): Promise<void> {
    await this.stateManager.setExpandAll(value);
  }

  getReverseDependenciesVisible(): boolean {
    return this.reverseDependenciesVisible;
  }

  setReverseDependenciesVisible(value: boolean): void {
    this.reverseDependenciesVisible = value;
  }

  // 文件行数显示开关：纯内存状态，随 GraphState 释放（dispose 前跨视图保持）
  getShowFileLineCounts(): boolean {
    return this.showFileLineCounts;
  }

  setShowFileLineCounts(value: boolean): void {
    this.showFileLineCounts = value;
  }

  getExpansionController(nodeId: string): AbortController | undefined {
    return this.activeExpansionControllers.get(nodeId);
  }

  setExpansionController(nodeId: string, controller: AbortController): void {
    this.activeExpansionControllers.set(nodeId, controller);
  }

  deleteExpansionController(nodeId: string): void {
    this.activeExpansionControllers.delete(nodeId);
  }

  abortAndClearExpansionControllers(): void {
    for (const controller of this.activeExpansionControllers.values()) {
      controller.abort();
    }
    this.activeExpansionControllers.clear();
  }
}
