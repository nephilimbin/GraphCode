/**
 * View Mode Service Module
 *
 * Manages view modes for graph visualization.
 * This service connects to ProviderStateManager to maintain view mode state.
 */

import * as vscode from 'vscode';
import type { ProviderStateManager } from '../state/provider-state-manager';

/**
 * View mode types - aligned with ProviderStateManager
 */
export type ViewMode = 'file' | 'list' | 'symbol' | 'callgraph';

/**
 * View layout types
 */
export type ViewLayout = 'hierarchical' | 'force-directed' | 'radial';

/**
 * View mode service interface
 */
export interface IViewModeService {
  /**
   * Set current view mode
   */
  setViewMode(mode: ViewMode): Promise<void>;

  /**
   * Get current view mode
   */
  getCurrentMode(): ViewMode;

  /**
   * Get available view modes
   */
  getAvailableViewModes(): ViewMode[];

  /**
   * Set specific view modes
   */
  setFileMode(): Promise<void>;
  setListMode(): Promise<void>;
  setSymbolMode(): Promise<void>;
  setCallgraphMode(): Promise<void>;

  /**
   * Toggle between view modes
   */
  toggleMode(): Promise<void>;

  /**
   * VS Code context management
   */
  updateContext(context: vscode.ExtensionContext): Promise<void>;

  /**
   * Subscribe to view mode changes
   */
  onChange(callback: (mode: ViewMode) => void): () => void;
}

/**
 * View Mode Service implementation
 * Connects to ProviderStateManager for production use
 */
export class ViewModeService implements IViewModeService {
  private stateManager: ProviderStateManager;
  private context?: vscode.ExtensionContext;
  private listeners: Array<(mode: ViewMode) => void> = [];

  constructor(stateManager: ProviderStateManager) {
    this.stateManager = stateManager;
  }

  async setViewMode(mode: ViewMode): Promise<void> {
    await this.stateManager.setViewMode(mode);
    await this.updateContextIfReady();
    this.notifyListeners();
  }

  getCurrentMode(): ViewMode {
    return this.stateManager.viewMode;
  }

  getAvailableViewModes(): ViewMode[] {
    return ['file', 'list', 'symbol', 'callgraph'];
  }

  async setFileMode(): Promise<void> {
    return this.setViewMode('file');
  }

  async setListMode(): Promise<void> {
    return this.setViewMode('list');
  }

  async setSymbolMode(): Promise<void> {
    return this.setViewMode('symbol');
  }

  async setCallgraphMode(): Promise<void> {
    return this.setViewMode('callgraph');
  }

  async toggleMode(): Promise<void> {
    const current = this.getCurrentMode();
    const modes = this.getAvailableViewModes();
    const currentIndex = modes.indexOf(current);
    const nextIndex = (currentIndex + 1) % modes.length;
    await this.setViewMode(modes[nextIndex]);
  }

  async updateContext(context: vscode.ExtensionContext): Promise<void> {
    this.context = context;
    await this.updateContextIfReady();
  }

  onChange(callback: (mode: ViewMode) => void): () => void {
    this.listeners.push(callback);

    // Return unsubscribe function
    return () => {
      const index = this.listeners.indexOf(callback);
      if (index >= 0) {
        this.listeners.splice(index, 1);
      }
    };
  }

  /**
   * Update VS Code context if context is available
   */
  private async updateContextIfReady(): Promise<void> {
    if (!this.context) return;

    const mode = this.getCurrentMode();
    await vscode.commands.executeCommand(
      'setContext',
      'graphcode.viewMode',
      mode
    );
  }

  /**
   * Notify all listeners of view mode changes
   */
  private notifyListeners(): void {
    const mode = this.getCurrentMode();
    for (const listener of this.listeners) {
      listener(mode);
    }
  }
}

/**
 * Create a view mode service connected to state manager
 */
export function createViewModeService(
  stateManager: ProviderStateManager
): IViewModeService {
  return new ViewModeService(stateManager);
}
