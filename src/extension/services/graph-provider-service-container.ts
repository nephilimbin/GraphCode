import * as path from "node:path";
import * as vscode from "vscode";
import { Spider } from "../../analyzer/spider";
import { SpiderBuilder } from "../../analyzer/SpiderBuilder";
import type { VsCodeLogger } from "../extensionLogger"
import { WebviewManager } from "../infrastructure/webview-manager";
import { BackgroundIndexingManager } from "./background-indexing-manager";
import { CallGraphViewService } from "./callgraph-view-service";
import { EditorNavigationService } from "./editor-navigation-service";
import type { GraphRefreshReason } from "./extension-event-hub";
import { ExtensionEventHub } from "./extension-event-hub";
import type { EventType } from "./file-change-scheduler";
import { FileChangeScheduler } from "./file-change-scheduler";
import { FileLineCounter } from "./file-line-counter";
import { GraphState } from "../infrastructure/graph-state";
import { GraphViewService } from "./graph-view-service";
import { NodeInteractionService } from "./node-interaction-service";
import {
  ProviderConfigSnapshot,
  ProviderStateManager,
} from "../state/provider-state-manager";
import { ServiceContainer, ServiceToken } from "../infrastructure/service-container";
import { SourceFileWatcher } from "./source-file-watcher";
import { SymbolViewService } from "./symbol-view-service";
import { UnusedAnalysisCache } from "./unused-analysis-cache";

export const graphProviderServiceTokens = {
  spider: Symbol("Spider") as ServiceToken<Spider>,
  webviewManager: Symbol("WebviewManager") as ServiceToken<WebviewManager>,
  stateManager: Symbol("ProviderStateManager") as ServiceToken<ProviderStateManager>,
  graphState: Symbol("GraphState") as ServiceToken<GraphState>,
  unusedAnalysisCache: Symbol("UnusedAnalysisCache") as ServiceToken<UnusedAnalysisCache>,
  graphViewService: Symbol("GraphViewService") as ServiceToken<GraphViewService>,
  callGraphViewService: Symbol("CallGraphViewService") as ServiceToken<CallGraphViewService>,
  symbolViewService: Symbol("SymbolViewService") as ServiceToken<SymbolViewService>,
  nodeInteractionService: Symbol("NodeInteractionService") as ServiceToken<NodeInteractionService>,
  navigationService: Symbol("EditorNavigationService") as ServiceToken<EditorNavigationService>,
  indexingManager: Symbol("BackgroundIndexingManager") as ServiceToken<BackgroundIndexingManager>,
  fileChangeScheduler: Symbol("FileChangeScheduler") as ServiceToken<FileChangeScheduler>,
  fileLineCounter: Symbol("FileLineCounter") as ServiceToken<FileLineCounter>,
  sourceFileWatcher: Symbol("SourceFileWatcher") as ServiceToken<SourceFileWatcher>,
  eventHub: Symbol("ExtensionEventHub") as ServiceToken<ExtensionEventHub>,
} as const;

export interface GraphProviderServiceContainerOptions {
  extensionUri: vscode.Uri;
  context: vscode.ExtensionContext;
  defaultIndexingStartDelay: number;
  logger: VsCodeLogger;
  onIndexingComplete: () => Promise<void>;
  viewProvider: () => vscode.WebviewView | undefined;
  updateGraph: (isRefresh?: boolean, refreshReason?: GraphRefreshReason) => Promise<void>;
  handleDrillDown: (
    filePathOrSymbolId: string,
    isRefresh?: boolean,
    targetMode?: "list" | "symbol",
  ) => Promise<void>;
  handleFileChange: (filePath: string, eventType: EventType) => Promise<void>;
}

export interface GraphProviderServiceContainerResult {
  container: ServiceContainer;
  configSnapshot: ProviderConfigSnapshot;
}

function resolvePreferredWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
  const activeEditor = vscode.window.activeTextEditor;
  const getWorkspaceFolder = (vscode.workspace as typeof vscode.workspace & {
    getWorkspaceFolder?: (uri: vscode.Uri) => vscode.WorkspaceFolder | undefined;
  }).getWorkspaceFolder;

  if (activeEditor?.document.uri.scheme === "file" && typeof getWorkspaceFolder === "function") {
    const editorFolder = getWorkspaceFolder(activeEditor.document.uri);
    if (editorFolder) {
      return editorFolder;
    }
  }

  return vscode.workspace.workspaceFolders?.[0];
}

export function createGraphProviderServiceContainer(
  options: GraphProviderServiceContainerOptions,
): GraphProviderServiceContainerResult {
  const container = new ServiceContainer();

  container.register(
    graphProviderServiceTokens.stateManager,
    () => new ProviderStateManager(options.context, options.defaultIndexingStartDelay),
  );
  container.register(
    graphProviderServiceTokens.graphState,
    () => new GraphState(container.get(graphProviderServiceTokens.stateManager)),
  );
  container.register(
    graphProviderServiceTokens.webviewManager,
    () => new WebviewManager(options.extensionUri),
  );

  const stateManager = container.get(graphProviderServiceTokens.stateManager);
  const configSnapshot = stateManager.loadConfiguration();

  const workspaceFolder = resolvePreferredWorkspaceFolder();
  const workspaceRoot = workspaceFolder?.uri.fsPath;
  const hasWorkspace = Boolean(workspaceRoot);

  if (hasWorkspace && workspaceRoot) {
    container.register(graphProviderServiceTokens.spider, () => {
      return new SpiderBuilder()
        .withRootDir(workspaceRoot)
        .withTsConfigPath(path.join(workspaceRoot, "tsconfig.json"))
        .withExtensionPath(options.context.extensionPath)
        .withExcludeNodeModules(configSnapshot.excludeNodeModules)
        .withMaxDepth(configSnapshot.maxDepth)
        .withReverseIndex(configSnapshot.enableBackgroundIndexing)
        .withIndexingConcurrency(configSnapshot.indexingConcurrency)
        .withCacheConfig({
          maxCacheSize: configSnapshot.maxCacheSize,
          maxSymbolCacheSize: configSnapshot.maxSymbolCacheSize,
        })
        .build();
    });

    container.register(
      graphProviderServiceTokens.unusedAnalysisCache,
      () =>
        new UnusedAnalysisCache(
          options.context,
          configSnapshot.persistUnusedAnalysisCache,
          configSnapshot.maxUnusedAnalysisCacheSize,
        ),
    );

    container.register(
      graphProviderServiceTokens.fileLineCounter,
      () => new FileLineCounter(),
    );

    container.register(graphProviderServiceTokens.graphViewService, () => {
      return new GraphViewService(
        container.get(graphProviderServiceTokens.spider),
        options.logger,
        {
          unusedAnalysisConcurrency: configSnapshot.unusedAnalysisConcurrency,
          unusedAnalysisMaxEdges: configSnapshot.unusedAnalysisMaxEdges,
        },
        container.get(graphProviderServiceTokens.unusedAnalysisCache),
      );
    });

    // CallGraphViewService — indexed before SymbolViewService so the latter
    // can pull it from the container to enrich symbol view with cross-file callers.
    container.register(
      graphProviderServiceTokens.callGraphViewService,
      () => new CallGraphViewService(options.context),
    );

    container.register(
      graphProviderServiceTokens.symbolViewService,
      () => {
        const symbolView = new SymbolViewService(
          container.get(graphProviderServiceTokens.spider),
          options.logger,
        );
        // Enrich symbol view with cross-file callers from the call-graph DB.
        // CallGraphViewService implements ICallGraphQueryService.
        symbolView.setCallGraphQueryService(
          container.get(graphProviderServiceTokens.callGraphViewService),
        );
        return symbolView;
      },
    );

    container.register(
      graphProviderServiceTokens.nodeInteractionService,
      () => new NodeInteractionService(container.get(graphProviderServiceTokens.spider), options.logger),
    );

    container.register(
      graphProviderServiceTokens.navigationService,
      () => new EditorNavigationService(container.get(graphProviderServiceTokens.spider), options.logger),
    );

    container.register(
      graphProviderServiceTokens.indexingManager,
      () =>
        new BackgroundIndexingManager({
          context: options.context,
          extensionUri: options.extensionUri,
          spider: container.get(graphProviderServiceTokens.spider),
          logger: options.logger,
          onIndexingComplete: options.onIndexingComplete,
          initialConfig: configSnapshot,
        }),
    );

    container.register(
      graphProviderServiceTokens.fileChangeScheduler,
      () =>
        new FileChangeScheduler({
          processHandler: options.handleFileChange,
          debounceDelay: 300,
        }),
    );

    container.register(
      graphProviderServiceTokens.sourceFileWatcher,
      () =>
        new SourceFileWatcher({
          context: options.context,
          logger: options.logger,
          fileChangeScheduler: container.get(graphProviderServiceTokens.fileChangeScheduler),
        }),
    );

    container.register(
      graphProviderServiceTokens.eventHub,
      () =>
        new ExtensionEventHub({
          spider: container.get(graphProviderServiceTokens.spider),
          indexingManager: container.get(graphProviderServiceTokens.indexingManager),
          unusedAnalysisCache: container.get(graphProviderServiceTokens.unusedAnalysisCache),
          fileLineCounter: container.get(graphProviderServiceTokens.fileLineCounter),
          stateManager: container.get(graphProviderServiceTokens.stateManager),
          navigationService: container.get(graphProviderServiceTokens.navigationService),
          viewProvider: options.viewProvider,
          updateGraph: options.updateGraph,
          handleDrillDown: options.handleDrillDown,
          logger: options.logger,
        }),
    );
  }

  return { container, configSnapshot };
}
