/**
 * ViewLayer Module
 *
 * Unified export for all view-related services.
 * This module provides the interface for managing view modes, drill-down navigation,
 * and filtering.
 */

import type { ProviderStateManager } from '../state/provider-state-manager';
import * as vscode from 'vscode';

// ViewModeService exports
export {
  ViewModeService,
  createViewModeService,
  type IViewModeService,
  type ViewMode,
  type ViewLayout,
} from './viewmode-service';

// FilterService exports
export {
  FilterService,
  createFilterService,
  type IFilterService,
} from './filter-service';

/**
 * ViewLayer interface
 * Provides access to all view-related services
 */
export interface IViewLayer {
  viewModeService: import('./viewmode-service').IViewModeService;
  filterService: import('./filter-service').IFilterService;
}

/**
 * ViewLayer configuration
 */
export interface ViewLayerConfig {
  context?: vscode.ExtensionContext;
  stateManager: ProviderStateManager;
}

/**
 * Create a fully configured ViewLayer
 * This is the main entry point for creating all view-related services
 */
export function createViewLayer(config: ViewLayerConfig): IViewLayer {
  const { context, stateManager } = config;

  // Create ViewModeService
  const { ViewModeService } = require('./viewmode-service');
  const viewModeService = new ViewModeService(stateManager);

  // Create FilterService
  const { FilterService } = require('./filter-service');
  const filterService = new FilterService();
  filterService.setStateManager(stateManager);

  // Initialize context if provided
  if (context) {
    viewModeService.updateContext(context).catch((error: unknown) => {
      console.error('[ViewLayer] Failed to initialize ViewModeService context:', error);
    });

    filterService.initializeContext(context);
  }

  return {
    viewModeService,
    filterService,
  };
}

/**
 * Create a minimal ViewLayer for testing
 * Does not require VS Code context
 */
export function createTestViewLayer(stateManager: ProviderStateManager): IViewLayer {
  return createViewLayer({
    stateManager,
  });
}
