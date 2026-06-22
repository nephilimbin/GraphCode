/**
 * GraphCode Extension Entry Point
 *
 * VS Code extension for code dependency visualization and analysis.
 */

import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import { GraphProvider } from './extension/graph-provider';
import { extensionLoggerManager, getExtensionLogger, watchLogLevelConfig } from './extension/extensionLogger';

// Keep track of services for cleanup
let graphProvider: GraphProvider;

/**
 * Extension activation
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log('GraphCode extension is now active!');

  // Initialize extension logger manager
  const outputChannel = vscode.window.createOutputChannel('GraphCode');
  extensionLoggerManager.initialize(outputChannel);

  // Watch for log level configuration changes
  watchLogLevelConfig(context);

  // Test logger
  const logger = getExtensionLogger('Extension');
  logger.info('GraphCode extension activated successfully');

  // Initialize GraphProvider (creates all services internally via the service container)
  graphProvider = new GraphProvider(context.extensionUri, context);

  // Register GraphProvider as WebviewViewProvider
  const graphViewRegistration = vscode.window.registerWebviewViewProvider(
    GraphProvider.viewType,
    graphProvider,
    {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    }
  );

  context.subscriptions.push(graphViewRegistration);
  // Register the provider itself so VS Code disposes it (and the service
  // container it owns) on extension deactivation.
  context.subscriptions.push(graphProvider);

  // Register commands
  const commands = [
    vscode.commands.registerCommand('graphcode.showGraph', () => {
      vscode.window.showInformationMessage('GraphCode: Showing dependency graph...');
    }),

    vscode.commands.registerCommand('graphcode.forceReindex', async () => {
      try {
        await graphProvider.forceReindex();
        vscode.window.showInformationMessage('GraphCode: Re-indexing started...');
      } catch (error) {
        vscode.window.showErrorMessage(`GraphCode: Failed to reindex - ${error}`);
      }
    }),

    vscode.commands.registerCommand('graphcode.showIndexStatus', () => {
      const status = graphProvider.getIndexStatus();
      if (status) {
        const message = `Indexed: ${status.processed}, To Index: ${status.total}, Progress: ${Math.round((status.processed / status.total) * 100)}%`;
        vscode.window.showInformationMessage(`GraphCode Status: ${message}`);
      } else {
        vscode.window.showWarningMessage('GraphCode: No indexing status available');
      }
    }),

    // View mode commands
    vscode.commands.registerCommand('graphcode.setViewModeFile', async () => {
      try {
        await graphProvider.setViewModeFile();
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to switch to file view: ${error}`);
      }
    }),

    vscode.commands.registerCommand('graphcode.setViewModeList', async () => {
      try {
        await graphProvider.setViewModeList();
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to switch to list view: ${error}`);
      }
    }),

    vscode.commands.registerCommand('graphcode.setViewModeSymbol', async () => {
      try {
        await graphProvider.setViewModeSymbol();
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to switch to symbol view: ${error}`);
      }
    }),

    vscode.commands.registerCommand('graphcode.setViewModeCallgraph', async () => {
      try {
        await graphProvider.setViewModeCallgraph();
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to switch to call graph view: ${error}`);
      }
    }),

    vscode.commands.registerCommand('graphcode.showCallGraph', async () => {
      try {
        await graphProvider.setViewModeCallgraph();
        await graphProvider.showCallGraph().catch((err: unknown) => {
          const logger = getExtensionLogger('Extension');
          logger.error('graphcode.showCallGraph error:', err);
        });
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to show call graph: ${error}`);
      }
    }),

    vscode.commands.registerCommand('graphcode.toggleViewMode', async () => {
      try {
        await graphProvider.toggleViewMode();
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to toggle view mode: ${error}`);
      }
    }),

    vscode.commands.registerCommand('graphcode.enableUnusedFilter', async () => {
      try {
        if (!graphProvider.getUnusedFilterActive()) {
          await graphProvider.toggleUnusedFilter();
        }
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to enable unused filter: ${error}`);
      }
    }),

    vscode.commands.registerCommand('graphcode.disableUnusedFilter', async () => {
      try {
        if (graphProvider.getUnusedFilterActive()) {
          await graphProvider.toggleUnusedFilter();
        }
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to disable unused filter: ${error}`);
      }
    }),

    // Filter commands
    vscode.commands.registerCommand('graphcode.toggleUnusedFilter', async () => {
      try {
        await graphProvider.toggleUnusedFilter();
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to toggle filter: ${error}`);
      }
    }),

    // Node interaction commands
    vscode.commands.registerCommand('graphcode.expandAllNodes', async () => {
      try {
        await graphProvider.expandAllNodes();
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to expand nodes: ${error}`);
      }
    }),

    vscode.commands.registerCommand('graphcode.openStorage', async () => {
      try {
        const storageUri = context.globalStorageUri;
        // 确保目录存在(首次未写缓存时 globalStoragePath 可能不存在)
        await fs.mkdir(storageUri.fsPath, { recursive: true });
        await vscode.commands.executeCommand('revealFileInOS', storageUri);
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to open storage directory: ${error}`);
      }
    }),

    vscode.commands.registerCommand('graphcode.showReverseDependencies', async () => {
      try {
        await graphProvider.showReverseDependencies();
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to show reverse dependencies: ${error}`);
      }
    }),

    vscode.commands.registerCommand('graphcode.hideReverseDependencies', async () => {
      try {
        await graphProvider.hideReverseDependencies();
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to hide reverse dependencies: ${error}`);
      }
    }),

    // Refresh commands
    vscode.commands.registerCommand('graphcode.refreshGraph', async () => {
      try {
        await graphProvider.refreshGraph();
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to refresh graph: ${error}`);
      }
    }),

    vscode.commands.registerCommand('graphcode.updateConfig', () => {
      try {
        graphProvider.updateConfig();
        vscode.window.showInformationMessage('GraphCode: Configuration updated');
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to update configuration: ${error}`);
      }
    }),
  ];

  // Add all command disposables to context
  commands.forEach(command => context.subscriptions.push(command));

  // Handle file changes and active editor changes
  const fileWatcher = vscode.workspace.onDidSaveTextDocument(async (document) => {
    if (document.uri.scheme === 'file') {
      // Trigger graph update on file save
      try {
        await graphProvider.handleFileChange(document.fileName, 'change');
      } catch (error) {
        console.error('Failed to handle file change:', error);
      }
    }
  });

  const activeEditorWatcher = vscode.window.onDidChangeActiveTextEditor(async (editor) => {
    if (editor?.document.uri.scheme === 'file') {
      try {
        await graphProvider.onActiveFileChanged();
      } catch (error) {
        console.error('Failed to handle active file change:', error);
      }
    }
  });

  context.subscriptions.push(fileWatcher, activeEditorWatcher);

  console.log('GraphCode extension successfully initialized');
}

/**
 * Extension deactivation
 */
export async function deactivate() {
  console.log('GraphCode extension is now deactivated');

  // Flush caches before deactivation. The service container itself is torn
  // down automatically by VS Code via GraphProvider.dispose() (registered on
  // context.subscriptions), which calls ServiceContainer.dispose() and
  // disposes every singleton — including CallGraphViewService (DB persist).
  if (graphProvider) {
    try {
      await graphProvider.flushCaches();
    } catch (error) {
      console.error('Failed to flush caches during deactivation:', error);
    }
  }
}
