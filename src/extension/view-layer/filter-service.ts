/**
 * Filter Service Module
 *
 * Provides filtering capabilities for GraphCode visualization.
 * Connects to ProviderStateManager for unused dependency filter management.
 */

import * as vscode from 'vscode';
import type { ProviderStateManager } from '../state/provider-state-manager';

/**
 * Filter service interface
 */
export interface IFilterService {
  /**
   * Toggle unused dependency filter
   */
  toggleUnusedFilter(): Promise<boolean>;

  /**
   * Check if unused filter is active
   */
  isUnusedFilterActive(): boolean;

  /**
   * VS Code context management
   */
  initializeContext(context: vscode.ExtensionContext): void;

  /**
   * Update VS Code context
   */
  updateContext(): void;

  /**
   * Set the state manager for filter functionality
   */
  setStateManager(stateManager: ProviderStateManager): void;
}

/**
 * Filter Service implementation
 * Connects to ProviderStateManager for production use
 */
export class FilterService implements IFilterService {
  private stateManager?: ProviderStateManager;
  private context?: vscode.ExtensionContext;

  setStateManager(stateManager: ProviderStateManager): void {
    this.stateManager = stateManager;
  }

  async toggleUnusedFilter(): Promise<boolean> {
    if (!this.stateManager) {
      throw new Error('StateManager not set. Call setStateManager first.');
    }

    const currentState = this.isUnusedFilterActive();
    const newState = !currentState;

    await this.stateManager.setUnusedFilterActive(newState);
    this.updateContext();

    return newState;
  }

  isUnusedFilterActive(): boolean {
    if (!this.stateManager) {
      return false;
    }

    return this.stateManager.getUnusedFilterActive();
  }

  initializeContext(context: vscode.ExtensionContext): void {
    this.context = context;
    this.updateContext();
  }

  updateContext(): void {
    if (!this.context || !this.stateManager) {
      return;
    }

    const filterActive = this.isUnusedFilterActive();

    void vscode.commands.executeCommand(
      'setContext',
      'graphcode.unusedFilterActive',
      filterActive
    );
  }
}

/**
 * Create a filter service
 */
export function createFilterService(): IFilterService {
  return new FilterService();
}
