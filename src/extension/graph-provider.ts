import * as vscode from "vscode";
import { Spider, type IndexerStatusSnapshot } from "../analyzer";
import { SUPPORTED_SOURCE_FILE_REGEX } from "../shared/constants";
import type {
  ExtensionToWebviewMessage,
  SetExpandAllMessage,
  SwitchModeMessage,
  WebviewLogMessage,
  WebviewToExtensionMessage,
} from "../shared/messages";
import { getExtensionLogger } from "./extensionLogger"
import type { BackgroundIndexingManager } from "./services/background-indexing-manager";
import type { CallGraphViewService } from "./services/callgraph-view-service";
import type { EditorNavigationService } from "./services/editor-navigation-service";
import { ExtensionEventHub } from "./services/extension-event-hub";
import type { EventType, FileChangeScheduler } from "./services/file-change-scheduler";
import {
  createGraphProviderServiceContainer,
  graphProviderServiceTokens,
} from "./services/graph-provider-service-container";
import { GraphState } from "./infrastructure/graph-state";
import type { GraphViewService } from "./services/graph-view-service";
import type { NodeInteractionService } from "./services/node-interaction-service";
import type {
  ProviderConfigSnapshot,
  ProviderStateManager,
  ViewMode,
} from "./state/provider-state-manager";
import { ServiceContainer } from "./infrastructure/service-container";
import type { SymbolViewService } from "./services/symbol-view-service";
import type { UnusedAnalysisCache } from "./services/unused-analysis-cache";
import { createViewLayer, type IViewLayer } from "./view-layer";

/** Logger instance for GraphProvider */
const log = getExtensionLogger("GraphProvider");

/** Default delay before starting background indexing (ms) */
const DEFAULT_INDEXING_START_DELAY = 1000;

export class GraphProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = "graphcode.graphView";

  private _view?: vscode.WebviewView;
  private readonly _container: ServiceContainer;
  private _configSnapshot: ProviderConfigSnapshot;
  private readonly _fileChangeScheduler?: FileChangeScheduler;
  private readonly _stateManager: ProviderStateManager;
  private readonly _graphState: GraphState;
  /**
   * Optional callback used by EditorEventsService to notify MCP server.
   * Populated by extension activation if MCP server is registered.
   */
  public notifyMcpServerOfConfigChange?: () => void;

  /**
   * Sequence counter for handleDrillDown calls.
   * Incremented on each new call; checked after async buildSymbolGraph
   * to discard stale results when multiple analyses run concurrently.
   */
  private _drillDownSeq = 0;

  /**
   * Sequence number of the last completed (or errored) handleDrillDown invocation.
   * Compared against _drillDownSeq to detect in-flight analyses.
   * When _drillDownSeq > _drillDownCompleteSeq an analysis is in progress and
   * cursor-triggered refreshes should be suppressed to avoid livelocking.
   */
  private _drillDownCompleteSeq = 0;

  /**
   * Cache for the last successful buildSymbolGraph result.
   * Avoids re-running the expensive (~60 s) LSP analysis when the user
   * switches between list and symbol view for the same file.
   * Invalidated on file save / file-system change for that file.
   */
  private _symbolGraphCache: {
    filePath: string;
    rootNodeId: string;
    result: Awaited<ReturnType<SymbolViewService['buildSymbolGraph']>>;
    timestamp: number;
  } | null = null;

  private readonly _viewLayer: IViewLayer;

  private get spider(): Spider | undefined {
    return this._container.has(graphProviderServiceTokens.spider)
      ? this._container.get(graphProviderServiceTokens.spider)
      : undefined;
  }

  /**
   * Call-graph view service — resolved from the service container (same as
   * every other service), no longer injected via a setter.
   */
  private get callGraphViewService(): CallGraphViewService | undefined {
    return this._container.has(graphProviderServiceTokens.callGraphViewService)
      ? this._container.get(graphProviderServiceTokens.callGraphViewService)
      : undefined;
  }

  /**
   * Expose the Spider instance for use by LmToolsService.
   * Returns undefined when no workspace folder is open.
   */
  public getSpiderForLmTools(): Spider | undefined {
    return this.spider;
  }

  /**
   * Expose the CallGraphViewService for use by LmToolsService.
   * Returns undefined when no workspace folder is open.
   */
  public getCallGraphViewServiceForLmTools(): CallGraphViewService | undefined {
    return this.callGraphViewService;
  }

  /**
   * Render the call graph for the symbol under the cursor.
   * Delegates to CallGraphViewService; called by the `graphcode.showCallGraph` command.
   */
  public async showCallGraph(): Promise<void> {
    await this.callGraphViewService?.show();
  }

  private get webviewManager() {
    return this._container.get(graphProviderServiceTokens.webviewManager);
  }

  private get indexingManager(): BackgroundIndexingManager | undefined {
    return this._container.has(graphProviderServiceTokens.indexingManager)
      ? this._container.get(graphProviderServiceTokens.indexingManager)
      : undefined;
  }


  private get graphViewService(): GraphViewService | undefined {
    return this._container.has(graphProviderServiceTokens.graphViewService)
      ? this._container.get(graphProviderServiceTokens.graphViewService)
      : undefined;
  }

  private get symbolViewService(): SymbolViewService | undefined {
    return this._container.has(graphProviderServiceTokens.symbolViewService)
      ? this._container.get(graphProviderServiceTokens.symbolViewService)
      : undefined;
  }

  private get nodeInteractionService(): NodeInteractionService | undefined {
    return this._container.has(graphProviderServiceTokens.nodeInteractionService)
      ? this._container.get(graphProviderServiceTokens.nodeInteractionService)
      : undefined;
  }

  private get navigationService(): EditorNavigationService | undefined {
    return this._container.has(graphProviderServiceTokens.navigationService)
      ? this._container.get(graphProviderServiceTokens.navigationService)
      : undefined;
  }

  private get unusedAnalysisCache(): UnusedAnalysisCache | undefined {
    return this._container.has(graphProviderServiceTokens.unusedAnalysisCache)
      ? this._container.get(graphProviderServiceTokens.unusedAnalysisCache)
      : undefined;
  }

  private get eventHub(): ExtensionEventHub | undefined {
    return this._container.has(graphProviderServiceTokens.eventHub)
      ? this._container.get(graphProviderServiceTokens.eventHub)
      : undefined;
  }

  /**
   * Get the file change scheduler for use by EditorEventsService
   */
  public get fileChangeScheduler(): FileChangeScheduler | undefined {
    return this._fileChangeScheduler;
  }

  /**
   * Get the state manager for configuration management
   */
  public get stateManager(): ProviderStateManager {
    return this._stateManager;
  }

  /**
   * Flush unused analysis cache to disk (called on deactivation)
   */
  public async flushCaches(): Promise<void> {
    await this.unusedAnalysisCache?.flush();
  }

  /**
   * Dispose every service held in the service container.
   *
   * This is the single cleanup point for extension-level singletons (Spider,
   * CallGraphViewService, watchers, schedulers, …). VS Code invokes it
   * automatically on extension deactivation when this provider is pushed onto
   * `context.subscriptions`. It must NOT run on webview view close — view
   * close only tears down view-local resources (see `onDidDispose` in
   * `resolveWebviewView`) so that services survive a view reopen.
   */
  public async dispose(): Promise<void> {
    await this._container.dispose();
  }

  private _initializeFilterContext(): void {
    void vscode.commands.executeCommand(
      "setContext",
      "graphcode\.unusedFilterActive",
      this._stateManager.getUnusedFilterActive(),
    );
    // Initialize viewMode context key
    void vscode.commands.executeCommand(
      "setContext",
      "graphcode\.viewMode",
      this._stateManager.viewMode,
    );
    // Initialize reverseDependenciesVisible context key
    void vscode.commands.executeCommand(
      "setContext",
      "graphcode\.reverseDependenciesVisible",
      false,
    );
  }

  /**
   * Update the viewMode context key based on current state
   */
  private async _updateViewModeContext(): Promise<void> {
    const mode = this._stateManager.viewMode;
    await vscode.commands.executeCommand(
      "setContext",
      "graphcode\.viewMode",
      mode,
    );
    log.debug(`Updated viewMode context to: ${mode}`);
  }

  constructor(extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
    const { container, configSnapshot } = createGraphProviderServiceContainer({
      extensionUri,
      context,
      defaultIndexingStartDelay: DEFAULT_INDEXING_START_DELAY,
      logger: log,
      onIndexingComplete: () => this._refreshAfterIndexing(),
      viewProvider: () => this._view,
      updateGraph: this.updateGraph.bind(this),
      handleDrillDown: this.handleDrillDown.bind(this),
      handleFileChange: this.handleFileChange.bind(this),
    });

    this._container = container;
    this._stateManager = container.get(graphProviderServiceTokens.stateManager);
    this._graphState = container.get(graphProviderServiceTokens.graphState);
    this._configSnapshot = configSnapshot;
    this._fileChangeScheduler = container.has(
      graphProviderServiceTokens.fileChangeScheduler,
    )
      ? container.get(graphProviderServiceTokens.fileChangeScheduler)
      : undefined;

    // Eagerly start the source file watcher. The service container is lazy, so
    // a registered-but-never-resolved service never runs its factory.
    // SourceFileWatcher's constructor attaches the FileSystemWatcher that fires
    // onDidCreate/onDidChange/onDidDelete; without resolving it here, external
    // file changes (notably deletions) never reach the graph, which would only
    // ever update on editor saves.
    if (container.has(graphProviderServiceTokens.sourceFileWatcher)) {
      container.get(graphProviderServiceTokens.sourceFileWatcher);
    }

    // Initialize ViewLayer with all view-related services
    this._viewLayer = createViewLayer({
      context,
      stateManager: this._stateManager,
    });

    // Initialize context for toggle button (async operation moved after init)
    this._initializeFilterContext();

  }

  private async _refreshAfterIndexing(): Promise<void> {
    if (this._stateManager.currentSymbol) {
      await this.handleDrillDown(this._stateManager.currentSymbol, true);
    } else {
      await this.updateGraph(true, "indexing");
    }
  }

  public updateConfig() {
    const spider = this.spider;
    if (spider) {
      this._configSnapshot = this._stateManager.loadConfiguration();

      spider.updateConfig({
        excludeNodeModules: this._configSnapshot.excludeNodeModules,
        maxDepth: this._configSnapshot.maxDepth,
        enableReverseIndex: this._configSnapshot.enableBackgroundIndexing,
        indexingConcurrency: this._configSnapshot.indexingConcurrency,
      });

      if (this.indexingManager) {
        this.indexingManager.updateConfiguration(this._configSnapshot);
        void this.indexingManager.handleConfigUpdate(
          spider.hasReverseIndex(),
        );
      }

      // Notify webview of the updated filter configuration
      // This ensures the webview has the correct unusedDependencyMode
      // when the user toggles the filter after changing settings
      if (this._view) {
        const filterActive = this._stateManager.getUnusedFilterActive();
        const effectiveMode = filterActive
          ? this._configSnapshot.unusedDependencyMode
          : "none";
        this._view.webview.postMessage({
          command: "updateFilter",
          filterUnused: filterActive,
          unusedDependencyMode: effectiveMode,
        });
      }

      this.updateGraph();
    }
  }

  /**
   * Handle active file change - update view for new file while preserving view type
   * If in symbol view, show symbols for new file
   * If in file view, show dependencies for new file
   */
  public async onActiveFileChanged(): Promise<void> {
    await this.eventHub?.handleActiveFileChanged();
  }

  /**
   * Unified handler for file changes from both editor saves and file system watcher.
   * Called by FileChangeScheduler after debouncing and event coalescence.
   * @param filePath Normalized file path
   * @param eventType Type of event (create, change, delete)
   */
  public async handleFileChange(
    filePath: string,
    eventType: EventType,
  ): Promise<void> {
    // Invalidate symbol graph cache when the analysed file changes on disk.
    if (this._symbolGraphCache?.filePath === filePath) {
      this._symbolGraphCache = null;
      log.debug(`[GraphProvider] Symbol graph cache invalidated (${eventType}): ${filePath}`);
    }
    await this.eventHub?.handleFileChange(filePath, eventType);
  }

  /**
   * Handle openFile message
   * Supports both regular file paths and symbol IDs (filePath:symbolName)
   * @param filePath The file path or symbol ID
   * @param line Optional line number to navigate to (1-indexed)
   * @param skipGraphUpdate If true, skip automatic graph view update after opening file
   */
  private async handleOpenFile(filePath: string, line?: number, skipGraphUpdate: boolean = false): Promise<void> {
    if (!this.navigationService) {
      return;
    }
    try {
      await this.navigationService.openFile(filePath, line, skipGraphUpdate);
    } catch (e) {
      log.error("Error opening file:", e);
      vscode.window.showErrorMessage(`Could not open file: ${filePath}`);
    }
  }

  /**
   * Handle updateGraphForFile message (用于双击节点更新 graph view)
   * @param filePath The file path to update graph view for
   */
  private async handleUpdateGraphForFile(filePath: string): Promise<void> {
    log.debug("handleUpdateGraphForFile called for:", filePath);
    await this._stateManager.setLastActiveFilePath(filePath);
    await this.updateGraph(false, "navigation");
  }

  /**
   * Handle expandNode message
   */
  private async handleExpandNode(
    nodeId: string,
    knownNodes: string[] | undefined,
  ): Promise<void> {
    if (!this.nodeInteractionService || !this._view) {
      return;
    }

    // Cancel only the previous expansion for the same node.
    // Cancelling across different nodes makes fast user interactions unreliable.
    this._graphState.getExpansionController(nodeId)?.abort();
    const abortController = new AbortController();
    this._graphState.setExpansionController(nodeId, abortController);

    const sendProgress = (
      status: "started" | "in-progress" | "completed" | "cancelled" | "error",
      processed?: number,
      total?: number,
      message?: string,
    ): void => {
      this._view?.webview.postMessage({
        command: "expansionProgress",
        nodeId,
        status,
        processed,
        total,
        message,
      });
    };

    sendProgress("started");

    try {
      const result = await this.nodeInteractionService.expandNode(
        nodeId,
        knownNodes,
        {
          signal: abortController.signal,
          onBatch: async (batch, totals) => {
            if (!this._view) return;
            this._view.webview.postMessage({
              command: "expandedGraph",
              nodeId,
              data: batch,
            });
            sendProgress("in-progress", totals.nodes);
          },
        },
      );

      if (abortController.signal.aborted) {
        sendProgress("cancelled", undefined, undefined, "Cancelled");
        return;
      }

      this._view.webview.postMessage(result);
      sendProgress("completed", result.data.nodes.length);
    } catch (e) {
      if (abortController.signal.aborted) {
        sendProgress("cancelled", undefined, undefined, "Cancelled");
        return;
      }
      log.error("Error expanding node:", e);
      sendProgress(
        "error",
        undefined,
        undefined,
        e instanceof Error ? e.message : "Unknown error",
      );
    } finally {
      const current = this._graphState.getExpansionController(nodeId);
      if (current === abortController)
        this._graphState.deleteExpansionController(nodeId);
    }
  }

  /**
   * Handle cancel expansion message
   */
  private async handleCancelExpandNode(nodeId?: string): Promise<void> {
    if (!nodeId) {
      this._graphState.abortAndClearExpansionControllers();
      return;
    }

    const controller = this._graphState.getExpansionController(nodeId);
    controller?.abort();
  }

  /**
   * Handle findReferencingFiles message
   */
  private async handleFindReferencingFiles(nodeId: string): Promise<void> {
    if (!this.nodeInteractionService || !this._view) {
      return;
    }
    try {
      const result =
        await this.nodeInteractionService.getReferencingFiles(nodeId);
      this._view.webview.postMessage(result);
    } catch (e) {
      log.error("Error finding referencing files:", e);
    }
  }

  /**
   * TASK-014: Handle selectSymbol message
   * Sets the selected symbol and filters the graph to show only files that reference it
   * @param symbolId The symbol ID to filter by, or undefined to clear the filter
   */
  public async handleSelectSymbol(symbolId: string | undefined): Promise<void> {
    log.debug("Selecting symbol:", symbolId);

    // Update the selected symbol in state manager
    this._stateManager.selectedSymbolId = symbolId;

    if (symbolId && this.spider) {
      // Get referencing files from SymbolReverseIndex
      const referencingFiles = this.spider.getSymbolReferencingFiles(symbolId);
      this._stateManager.setSymbolReferencingFiles(symbolId, referencingFiles);

      log.debug(`Symbol ${symbolId} selected - ${referencingFiles.size} referencing files found`);
    } else {
      // Clear the filter
      log.debug("Symbol filter cleared");
    }

    // Refresh the graph with the updated filter
    await this.updateGraph(true, "usage-analysis");
  }

  /**
   * Handle drillDown message (Symbol Analysis)
   * @param filePath The file to analyze
   * @param isRefresh If true, this is a refresh not navigation - don't push to history
   * @param targetViewMode Optional target view mode to pass to webview
   */
  private async handleDrillDown(
    filePath: string,
    isRefresh: boolean = false,
    targetViewMode?: "symbol" | "list",
  ): Promise<void> {
    log.info(
      `[GraphProvider] handleDrillDown ENTRY: filePath=${filePath}, isRefresh=${isRefresh}`,
    );
    if (!this.symbolViewService || !this._view || !this.navigationService) {
      log.warn(
        `[GraphProvider] handleDrillDown ABORT: Missing services (symbolView=${!!this.symbolViewService}, view=${!!this._view}, navigation=${!!this.navigationService})`,
      );
      return;
    }

    // Stamp this invocation so we can discard stale concurrent analyses.
    const drillDownSeq = ++this._drillDownSeq;

    // Don't eagerly set current symbol yet - we need to resolve relative/module
    // specifiers first so the tracked file is always an absolute path.

    try {
      log.info(
        isRefresh ? "Refreshing" : "Drilling down into",
        filePath,
        "for symbol analysis",
      );

      const resolved = await this._resolveDrillDownTarget(filePath, targetViewMode);
      if (!resolved) return;
      const { resolvedFilePath, rootNodeId } = resolved;

      // Skip the expensive LSP analysis when a fresh cached result exists
      // (e.g. user switching list ↔ symbol view for the same file).
      if (this._trySymbolGraphFromCache(resolvedFilePath, rootNodeId, drillDownSeq, isRefresh, targetViewMode)) {
        return;
      }

      log.info(
        `[GraphProvider] Building symbol graph for ${resolvedFilePath}`,
      );

      const symbolGraph = await this.symbolViewService.buildSymbolGraph(
        resolvedFilePath,
        rootNodeId,
      );

      // Always cache valid analysis results — even stale ones. The data is
      // correct for this file; it just arrived after a newer request was fired.
      // Caching here means the very next handleDrillDown for the same file will
      // get an instant cache hit instead of re-running the 60 s LSP analysis.
      this._symbolGraphCache = {
        filePath: resolvedFilePath,
        rootNodeId,
        result: symbolGraph,
        timestamp: Date.now(),
      };

      // Discard this result if a newer analysis was triggered while we awaited.
      if (drillDownSeq !== this._drillDownSeq) {
        log.info(
          `[GraphProvider] handleDrillDown: discarding stale result for ${resolvedFilePath} (seq=${drillDownSeq}, current=${this._drillDownSeq}) — cached for next request`,
        );
        return;
      }

      // Confirmed latest analysis — commit the selected symbol state.
      this._stateManager.selectedSymbolId = rootNodeId;

      this._sendSymbolGraphToWebview(symbolGraph, rootNodeId, isRefresh, targetViewMode);
    } catch (error) {
      log.error("Error drilling down into symbols:", error);
      vscode.window.showErrorMessage(
        `Failed to analyze symbols: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    } finally {
      // Mark as complete so cursor-triggered refreshes can resume.
      // Only update when this is still the latest dispatched analysis —
      // stale invocations (drillDownSeq < _drillDownSeq) must NOT clear the
      // in-flight flag because the newer analysis is still running.
      if (drillDownSeq === this._drillDownSeq) {
        this._drillDownCompleteSeq = drillDownSeq;
      }
    }
  }

  /**
   * Resolve the drill-down target: parse symbol ID, resolve absolute path,
   * update state manager, and set view mode. Returns null when resolution fails.
   */
  private async _resolveDrillDownTarget(
    filePath: string,
    targetViewMode?: "symbol" | "list",
  ): Promise<{ resolvedFilePath: string; rootNodeId: string } | null> {
    // Parse symbol ID (e.g. './utils:format') to separate file path from symbol name
    const { actualFilePath: requestedPath, symbolName } =
      this.navigationService!.parseFilePathAndSymbol(filePath);

    // Resolve the file path to an absolute path if needed
    const resolvedFilePath =
      await this.navigationService!.resolveDrillDownPath(
        requestedPath,
        this._stateManager.currentSymbol,
      );
    if (!resolvedFilePath) return null; // Messages already shown by resolver

    await this._stateManager.setLastActiveFilePath(resolvedFilePath);
    await this._stateManager.setCurrentFilePath(resolvedFilePath);

    // Track the resolved (absolute) file we are viewing for refreshes
    const rootNodeId = symbolName
      ? `${resolvedFilePath}:${symbolName}`
      : resolvedFilePath;

    // Update state — set mode explicitly if targetViewMode provided
    await this._stateManager.setViewMode(targetViewMode ?? "symbol");
    // NOTE: selectedSymbolId is intentionally NOT set here.
    // Setting it before buildSymbolGraph would allow background tasks (e.g.
    // indexing completion) to see an active currentSymbol and call
    // handleDrillDown again, creating a concurrency race. It is assigned
    // after the stale-result check confirms this invocation is still the latest one.

    // Update context key for toolbar visibility
    this._updateViewModeContext();

    return { resolvedFilePath, rootNodeId };
  }

  /** Build the symbolGraph webview message and post it (extracted to keep handleDrillDown complexity low). */
  private _sendSymbolGraphToWebview(
    symbolGraph: Awaited<ReturnType<SymbolViewService["buildSymbolGraph"]>>,
    rootNodeId: string,
    isRefresh: boolean,
    targetViewMode?: "symbol" | "list",
  ): void {
    if (!this._view) return;

    log.info(
      `[GraphProvider] Symbol graph built: ${symbolGraph.symbolData.symbols.length} symbols, ${symbolGraph.symbolData.dependencies.length} dependencies`,
    );

    const response: ExtensionToWebviewMessage = {
      command: "symbolGraph",
      filePath: rootNodeId,
      isRefresh,
      targetViewMode,
      graph: symbolGraph.intraFileGraph ?? {
        filePath: rootNodeId,
        nodes: [],
        edges: [],
        hasCycle: false,
      },
      breadcrumb: {
        segments: [rootNodeId.split("/").pop() || rootNodeId],
        filePath: rootNodeId,
      },
      data: {
        nodes: symbolGraph.nodes,
        edges: symbolGraph.edges,
        symbolData: symbolGraph.symbolData,
        incomingDependencies: symbolGraph.incomingDependencies,
        referencingFiles: symbolGraph.referencingFiles,
        parentCounts: symbolGraph.parentCounts,
      },
      config: {
        graphViewLayout: this._configSnapshot.graphViewLayout,
      },
    };

    log.debug(
      `[GraphProvider] Sending symbolGraph message: ${symbolGraph.symbolData.symbols.length} symbols, ${symbolGraph.symbolData.dependencies.length} dependencies, ${symbolGraph.edges.length} edges`,
    );

    this._view.webview.postMessage(response);
    log.debug(
      "Sent symbol graph with",
      symbolGraph.nodes.length, "nodes and",
      symbolGraph.edges.length, "edges",
    );
  }

  /**
   * Returns true (and posts the cached symbolGraph message) when a fresh cache
   * entry exists for the given file. Falls back to false so the caller runs a
   * full LSP analysis.
   */
  private _trySymbolGraphFromCache(
    resolvedFilePath: string,
    rootNodeId: string,
    drillDownSeq: number,
    isRefresh: boolean,
    targetViewMode: 'symbol' | 'list' | undefined,
  ): boolean {
    const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
    const entry = this._symbolGraphCache;
    if (
      entry?.filePath !== resolvedFilePath ||
      entry.rootNodeId !== rootNodeId ||
      Date.now() - entry.timestamp >= CACHE_TTL_MS
    ) {
      return false;
    }

    log.info(
      `[GraphProvider] Cache HIT for ${resolvedFilePath} (age=${Math.round((Date.now() - entry.timestamp) / 1000)}s) — reusing cached analysis`,
    );

    // Guard against a concurrent explicit navigation that arrived while we
    // were resolving the file path above.
    if (drillDownSeq !== this._drillDownSeq || !this._view) {
      return true; // cache hit; caller should still return early
    }

    this._stateManager.selectedSymbolId = entry.rootNodeId;
    const sg = entry.result;
    this._view.webview.postMessage({
      command: 'symbolGraph',
      filePath: entry.rootNodeId,
      isRefresh,
      targetViewMode,
      graph: { filePath: entry.rootNodeId, nodes: [], edges: [], hasCycle: false },
      breadcrumb: {
        segments: [entry.rootNodeId.split('/').pop() ?? entry.rootNodeId],
        filePath: entry.rootNodeId,
      },
      data: {
        nodes: sg.nodes,
        edges: sg.edges,
        symbolData: sg.symbolData,
        incomingDependencies: sg.incomingDependencies,
        referencingFiles: sg.referencingFiles,
        parentCounts: sg.parentCounts,
      },
      config: {
        graphViewLayout: this._configSnapshot.graphViewLayout,
      },
    } satisfies ExtensionToWebviewMessage);
    return true;
  }

  /**
   * Refresh the current graph view (used when the file is saved in symbol view)
   */
  public async refreshCurrentGraphView(): Promise<void> {
    const stateManager = this._stateManager;
    const currentFilePath = stateManager.currentFilePath;
    const currentMode = stateManager.viewMode;

    // Check if view is available - if not, skip refresh
    if (!this._view) {
      log.debug('View not available, skipping refresh');
      return;
    }

    if (!currentFilePath || currentMode !== 'symbol') {
      return; // Only refresh in symbol mode
    }

    // Guard against livelock: if an analysis is already running, skip this
    // cursor-triggered refresh. The analysis will update the view when done.
    if (this._drillDownSeq !== this._drillDownCompleteSeq) {
      log.debug(
        `refreshCurrentGraphView: skipping, analysis in progress (seq=${this._drillDownSeq}, complete=${this._drillDownCompleteSeq})`,
      );
      return;
    }

    log.info(`Refreshing current graph view: mode=${currentMode}, file=${currentFilePath}`);

    // Get current symbol if any
    const currentSymbol = stateManager.currentSymbol;
    const filePath = currentSymbol || currentFilePath;

    // Call handleDrillDown with isRefresh=true to re-run LSP analysis
    log.info(`Calling handleDrillDown for refresh in ${currentMode} mode`);
    await this.handleDrillDown(filePath, true, currentMode);
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;

    // Share the sidebar webview with CallGraphViewService so it can postMessage
    this.callGraphViewService?.setSidebarWebview(webviewView);

    webviewView.webview.options = this.webviewManager.getWebviewOptions();
    webviewView.webview.html = this.webviewManager.getHtmlForWebview(webviewView.webview);

    const messageListener = webviewView.webview.onDidReceiveMessage(
      async (message: WebviewToExtensionMessage) => {
        await this.handleWebviewMessage(message);
      },
    );

    // View-local teardown only. Extension-level singletons (Spider, watchers,
    // schedulers, event hub, call-graph DB) are owned by the service container
    // and disposed together via GraphProvider.dispose() on extension
    // deactivation — NOT here. Disposing them here would leave the container
    // holding zombie instances, so a later view reopen would reuse a Spider
    // whose worker is already terminated.
    webviewView.onDidDispose(() => {
      messageListener.dispose();
      // Cancel the deferred indexing started in resolveWebviewView; a reopen
      // re-schedules it.
      this.indexingManager?.cancelScheduledIndexing();
      // Detach the sidebar webview so call-graph messages stop flowing.
      this.callGraphViewService?.setSidebarWebview(null);
    });

    // Schedule deferred indexing now that view is ready
    this.indexingManager?.scheduleDeferredIndexing();

    // Pre-index call graph in background, alongside the reverse-index lifecycle.
    // Both indexers are independent (different parsers, no shared resources).
    const config = vscode.workspace.getConfiguration("graphcode");
    if (config.get<boolean>("preIndexCallGraph", true)) {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (workspaceRoot && this.callGraphViewService) {
        this.callGraphViewService
          .indexWorkspaceIfNeeded(workspaceRoot)
          .catch(() => { /* best-effort */ });
      }
    }

    // Initial update if we have an active editor
    this.updateGraph();
  }


  /**
   * Force a full re-index immediately (useful for debugging / command palette)
   * Public wrapper so other components (or commands) can trigger indexing.
   */
  public async forceReindex(): Promise<void> {
    await this.indexingManager?.forceReindex();
  }

  /**
   * Refresh the current graph view (preserves view mode)
   */
  public async refreshGraph(): Promise<void> {
    if (!this._view) {
      log.warn("Cannot refresh: view not initialized");
      return;
    }

    try {
      const currentMode = this._stateManager.viewMode;
      const currentFilePath = this._stateManager.currentFilePath;

      log.info(`Refreshing current graph view: mode=${currentMode}, file=${currentFilePath}`);
      log.info(`currentSymbol=${this._stateManager.currentSymbol}`);

      if (currentMode === "callgraph") {
        // In call graph view — force a full reindex + re-render
        if (this.callGraphViewService) {
          log.info("Triggering call graph force reindex via refresh");
          await this.callGraphViewService.forceReindex();
        }
      } else if (currentMode === "symbol" || currentMode === "list") {
        // In symbol/list view - refresh symbol analysis
        if (currentFilePath) {
          log.info(`Calling handleDrillDown for refresh in ${currentMode} mode`);
          await this.handleDrillDown(currentFilePath, true, currentMode);
          log.info("handleDrillDown completed successfully");
        } else {
          log.warn("Cannot refresh symbol view: no current file path");
        }
      } else {
        // In file view - behave like "re-open current file":
        // reset state in the webview and cancel any ongoing expansions.
        log.info("Refreshing file view");
        this._graphState.abortAndClearExpansionControllers();
        await this.updateGraph(false, "manual");
      }
    } catch (error) {
      log.error("Error during refresh:", error);
      throw error;
    }
  }




  /**
   * Cycle through view modes: file → list → symbol → file
   * Kept for backward compatibility
   * @returns The new view mode
   */
  public async toggleViewMode(): Promise<{
    mode: "file" | "list" | "symbol";
    message: string;
  }> {
    // Delegate to ViewLayer for mode switching
    await this._viewLayer.viewModeService.toggleMode();
    const newMode = this._viewLayer.viewModeService.getCurrentMode();

    // Call the mode-specific method for side effects
    if (newMode === "list") {
      await this.setViewModeList();
      return { mode: "list", message: "Switched to List View" };
    } else if (newMode === "symbol") {
      await this.setViewModeSymbol();
      return { mode: "symbol", message: "Switched to Symbol View" };
    } else {
      // newMode === "file"
      await this.setViewModeFile();
      return { mode: "file", message: "Switched to File View" };
    }
  }

  /**
   * Switch directly to file view mode
   */
  public async setViewModeFile(): Promise<void> {
    if (!this._view) {
      vscode.window.showWarningMessage("View not initialized");
      return;
    }

    log.info("Switching to file view mode");
    // Delegate to ViewLayer
    await this._viewLayer.viewModeService.setFileMode();

    // Explicitly tell the webview to switch view mode. This is required when
    // transitioning from callgraph mode, because _sendGraphUpdate's updateGraph
    // message deliberately does NOT override viewMode when it is "callgraph".
    await this._view.webview.postMessage({ command: "switchViewMode", mode: "file" });

    // Switch to current file in file mode
    const editor = vscode.window.activeTextEditor;
    if (editor?.document.uri.scheme === "file") {
      await this._sendGraphUpdate(editor.document.fileName, false);
    } else {
      const filePath = this._stateManager.getLastActiveFilePath();
      if (filePath) {
        await this._sendGraphUpdate(filePath, false);
      } else {
        await this.updateGraph();
      }
    }
  }

  /**
   * Switch directly to list view mode
   */
  public async setViewModeList(): Promise<void> {
    if (!this._view) {
      vscode.window.showWarningMessage("View not initialized");
      return;
    }

    log.info("Switching to list view mode");
    // Delegate to ViewLayer
    await this._viewLayer.viewModeService.setListMode();

    // Switch to current file in list mode
    const editor = vscode.window.activeTextEditor;
    const filePath =
      editor?.document.uri.scheme === "file"
        ? editor.document.fileName
        : this._stateManager.getLastActiveFilePath();

    if (filePath) {
      await this.handleDrillDown(filePath, false, "list");
    } else {
      vscode.window.showWarningMessage("No active file for list view");
    }
  }

  /**
   * Switch directly to symbol view mode
   */
  public async setViewModeSymbol(): Promise<void> {
    if (!this._view) {
      vscode.window.showWarningMessage("View not initialized");
      return;
    }

    log.info("Switching to symbol view mode");
    // Delegate to ViewLayer
    await this._viewLayer.viewModeService.setSymbolMode();

    // Switch to current file in symbol mode
    const editor = vscode.window.activeTextEditor;
    const filePath =
      editor?.document.uri.scheme === "file"
        ? editor.document.fileName
        : this._stateManager.getLastActiveFilePath();

    if (filePath) {
      await this.handleDrillDown(filePath, false, "symbol");
    } else {
      vscode.window.showWarningMessage("No active file for symbol view");
    }
  }

  /**
   * Switch to call graph view mode (updates context key so toolbar buttons hide)
   */
  public async setViewModeCallgraph(): Promise<void> {
    log.info("Switching to call graph view mode");
    // Delegate to ViewLayer
    await this._viewLayer.viewModeService.setCallgraphMode();
    await this._updateViewModeContext();
  }

  /**
   * Show reverse dependencies (which files import/reference the current file)
   */
  public async showReverseDependencies(): Promise<void> {
    if (!this._view) {
      vscode.window.showWarningMessage("View not initialized");
      return;
    }

    const editor = vscode.window.activeTextEditor;
    const filePath =
      editor?.document.uri.scheme === "file"
        ? editor.document.fileName
        : this._stateManager.getLastActiveFilePath();

    if (!filePath) {
      vscode.window.showWarningMessage(
        "No active file to show reverse dependencies",
      );
      return;
    }

    log.info(`Showing reverse dependencies for: ${filePath}`);

    // Use the existing getReferencingFiles functionality
    const result = await this.nodeInteractionService?.getReferencingFiles(filePath);

    if (result && this._view) {
      await this._view.webview.postMessage(result);
    }

    // Set context to indicate reverse dependencies are visible
    this._graphState.setReverseDependenciesVisible(true);
    await vscode.commands.executeCommand(
      "setContext",
      "graphcode\.reverseDependenciesVisible",
      true,
    );

    vscode.window.showInformationMessage(
      "Showing files that import this file",
    );
  }

  /**
   * Hide reverse dependencies overlay
   */
  public async hideReverseDependencies(): Promise<void> {
    if (!this._view) {
      vscode.window.showWarningMessage("View not initialized");
      return;
    }

    log.info("Hiding reverse dependencies");

    // Post message to webview to clear reverse dependencies
    await this._view.webview.postMessage({
      command: "clearReverseDependencies",
    });

    // Clear context to indicate reverse dependencies are hidden
    this._graphState.setReverseDependenciesVisible(false);
    await vscode.commands.executeCommand(
      "setContext",
      "graphcode\.reverseDependenciesVisible",
      false,
    );
  }

  /**
   * Toggle expand/collapse all nodes in the current graph view
   * @returns The new state (true if expanded, false if collapsed)
   */
  public async expandAllNodes(): Promise<{
    expanded: boolean;
    message: string;
  }> {
    if (!this._view) {
      return { expanded: false, message: "View not initialized" };
    }

    // Get current state and toggle it
    const currentExpandAll = this._graphState.getExpandAll();
    const newExpandAll = !currentExpandAll;

    // Update state
    await this._graphState.setExpandAll(newExpandAll);

    // Send message to webview to toggle expand/collapse
    const message: ExtensionToWebviewMessage = {
      command: "setExpandAll",
      expandAll: newExpandAll,
    };

    log.info("Sending setExpandAll message to webview:", newExpandAll);
    this._view.webview.postMessage(message);
    log.debug("Toggled expandAll from", currentExpandAll, "to", newExpandAll);
    // Notify webview to show progress overlay when expanding a large graph
    if (newExpandAll) {
      this._view.webview.postMessage({
        command: "expansionProgress",
        nodeId: "expandAll",
        status: "started",
      });
    }

    return {
      expanded: newExpandAll,
      message: newExpandAll ? "All nodes expanded" : "All nodes collapsed",
    };
  }

  /**
   * Get current unused dependency filter state
   */
  public getUnusedFilterActive(): boolean {
    // Delegate to ViewLayer
    return this._viewLayer.filterService.isUnusedFilterActive();
  }

  /**
   * Get current view mode
   * @returns Current view mode ('file', 'list', or 'symbol')
   */
  public getViewMode(): ViewMode {
    return this._stateManager.viewMode;
  }

  /**
   * Get reverse dependencies visibility state
   * @returns True if reverse dependencies are visible
   */
  public getReverseDependenciesVisible(): boolean {
    return this._graphState.getReverseDependenciesVisible();
  }

  /** E2E observability pass-throughs to CallGraphViewService */
  public getCallGraphRenderCount(): number {
    return this.callGraphViewService?.getCallGraphRenderCount() ?? 0;
  }
  public getCallGraphNodeCount(): number {
    return this.callGraphViewService?.getCallGraphNodeCount() ?? 0;
  }
  public getCallGraphEdgeCount(): number {
    return this.callGraphViewService?.getCallGraphEdgeCount() ?? 0;
  }
  public getCallGraphCycleCount(): number {
    return this.callGraphViewService?.getCallGraphCycleCount() ?? 0;
  }

  /**
   * Toggle unused dependency filter
   */
  public async toggleUnusedFilter(): Promise<void> {
    log.info("Toggling unused filter");

    // Delegate to ViewLayer
    const newState = await this._viewLayer.filterService.toggleUnusedFilter();

    log.info(`Filter toggled to: ${newState}`);

    // When activating the filter, rebuild the graph to ensure unusedEdges data is available
    // When deactivating, just update the filter state (no rebuild needed)
    if (newState) {
      // Activating filter - rebuild graph with usage analysis
      log.debug("Filter activated - rebuilding graph with usage analysis");
      await this.updateGraph(true, "usage-analysis");
    } else {
      // Deactivating filter - just update filter state in webview
      log.debug("Filter deactivated - updating filter state only");
      if (this._view) {
        this._view.webview.postMessage({
          command: "updateFilter",
          filterUnused: false,
          unusedDependencyMode: "none",
        });
      }
    }
  }

  /**
   * Return current indexer status snapshot (or null if spider not initialized)
   */
  public getIndexStatus(): IndexerStatusSnapshot | null {
    if (!this.spider) return null;
    try {
      return this.spider.getIndexStatus();
    } catch {
      return null;
    }
  }

  /**
   * Update the file graph for the current active document
   * @param isRefresh If true, this is a refresh not navigation - preserve view mode
   */
  public async updateGraph(
    isRefresh: boolean = false,
    refreshReason:
      | "manual"
      | "indexing"
      | "fileSaved"
      | "navigation"
      | "fileChange"
      | "usage-analysis"
      | "unknown" = "unknown",
  ) {
    if (!this._view || !this.spider || !this.graphViewService) {
      log.debug("View or Spider not initialized");
      return;
    }

    // Do NOT clear currentSymbol here. View-mode transitions (setViewModeFile/setViewModeList/setViewModeSymbol)
    // are responsible for resetting symbol state. Clearing it on a plain update would
    // silently push the context key back to "file", breaking symbol-mode workflows.

    const editor = vscode.window.activeTextEditor;
    if (editor?.document.uri.scheme !== "file") {
      const lastFilePath = this._stateManager.getLastActiveFilePath();
      if (lastFilePath && SUPPORTED_SOURCE_FILE_REGEX.test(lastFilePath)) {
        log.debug(
          "No active file editor, using last active file",
          lastFilePath,
        );
        await this._sendGraphUpdate(lastFilePath, isRefresh, refreshReason);
        return;
      }
      log.debug("No active file editor");
      // Send empty state message to webview
      const message: ExtensionToWebviewMessage = {
        command: "emptyState",
        reason: "no-file-open",
        message: "Open a source file to visualize its dependencies",
      };
      this._view.webview.postMessage(message);
      return;
    }

    const filePath = editor.document.fileName;
    log.debug(isRefresh ? "Refreshing" : "Updating", "graph for", filePath);

    // Only analyze supported files
    if (!SUPPORTED_SOURCE_FILE_REGEX.test(filePath)) {
      log.debug("Unsupported file type");
      return;
    }

    await this._stateManager.setLastActiveFilePath(filePath);
    await this._sendGraphUpdate(filePath, isRefresh, refreshReason);
  }

  private async _sendGraphUpdate(
    filePath: string,
    isRefresh: boolean,
    refreshReason:
      | "manual"
      | "indexing"
      | "fileSaved"
      | "fileChange"
      | "navigation"
      | "usage-analysis"
      | "unknown" = "unknown",
  ): Promise<void> {
    if (!this.graphViewService || !this._view) {
      return;
    }

    try {
      // Step 1: Send immediate graph (fast, no usage check)
      const filterActive = this._stateManager.getUnusedFilterActive();
      // Effective mode is 'none' if filter is inactive, otherwise the configured mode ('hide' or 'dim')
      // Note: If configured mode is 'none' (which we removed from UI but config might lag), treat as 'none'.
      // Actually package.json update removed 'none' from enum but users might have stale config.
      const configuredMode = this._configSnapshot.unusedDependencyMode;
      const effectiveMode = filterActive ? configuredMode : "none";

      const checkUsage = effectiveMode !== "none";

      // Get the referencing files for filtering (if a symbol is selected)
      const selectedSymbol = this._stateManager.selectedSymbolId;
      const referencingFiles = selectedSymbol
        ? this._stateManager.getSymbolReferencingFiles(selectedSymbol)
        : undefined;

      // Always build without check first to show something quickly
      const initialGraphData = await this.graphViewService.buildGraphData(
        filePath,
        false,
        undefined,
        referencingFiles,
      );

      const expandAll = this._stateManager.getExpandAll();

      // Get project root directory for module path computation
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

      // If checking usage is enabled, we'll send a second update.
      // If NOT checking usage, this is the only update.
      // If checking usage, we still send this one first so the user sees the graph immediately.

      const initialMessage: ExtensionToWebviewMessage = {
        command: "updateGraph",
        filePath,
        data: initialGraphData,
        expandAll,
        isRefresh,
        refreshReason,
        unusedDependencyMode: effectiveMode,
        filterUnused: filterActive,
        showModulePath: this._configSnapshot.showReferencingPaths, // Renamed config field
        showFileLineCounts: this._graphState.getShowFileLineCounts(),
        projectRoot: workspaceRoot, // Pass project root directory
      };
      this._view.webview.postMessage(initialMessage);

      // Step 2: If usage check is required, perform it and send update
      if (checkUsage) {
        log.debug("Performing background usage analysis for", filePath);
        // Reuse the nodes/edges from initial data to avoid re-crawling (optimized)
        const enrichedGraphData = await this.graphViewService.buildGraphData(
          filePath,
          true,
          initialGraphData,
          referencingFiles,
        );

        // Only send update if unused edges were found (or if we need to confirm they are empty?)
        // Actually, we should confirm if they are computed.
        // Using the specific 'done' state or just replacing the data.

        // Verify if we actually found different data or if we just added unusedEdges (which might be empty).
        // Ensure we don't trigger unnecessary re-renders if nothing changed.
        // But unusedEdges property presence is the change.

        const enrichedMessage: ExtensionToWebviewMessage = {
          command: "updateGraph",
          filePath,
          data: enrichedGraphData,
          expandAll, // Keep same expansion state
          isRefresh: true, // Treat as refresh to avoid internal navigation reset?
          // Actually, if we send isRefresh=true, it merges.
          refreshReason: "usage-analysis",
          unusedDependencyMode: effectiveMode,
          filterUnused: filterActive,
          showModulePath: this._configSnapshot.showReferencingPaths, // Renamed config field
          showFileLineCounts: this._graphState.getShowFileLineCounts(),
          projectRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath, // Pass project root directory
        };

        this._view.webview.postMessage(enrichedMessage);
      }

      // 行数独立通道：推送当前可见文件节点的全量行数（与依赖图解耦，mtime 缓存兜底）
      const fileLineCounter = this._container.has(graphProviderServiceTokens.fileLineCounter)
        ? this._container.get(graphProviderServiceTokens.fileLineCounter)
        : undefined;
      if (fileLineCounter) {
        const counts = await fileLineCounter.countLinesBatch(initialGraphData.nodes);
        this._view?.webview.postMessage({ command: "updateFileLineCounts", counts });
      }
    } catch (error) {
      log.error("Failed to analyze file:", error);
    }
  }

  /**
   * Handle webview messages
   * Routes messages to appropriate handlers
   */
  private async handleWebviewMessage(message: WebviewToExtensionMessage): Promise<void> {
    log.debug('Received webview message', message.command);

    switch (message.command) {
      case 'openFile':
        if (message.path) await this.handleOpenFile(message.path, message.line, message.skipGraphUpdate);
        break;
      case 'updateGraphForFile':
        if (message.filePath) await this.handleUpdateGraphForFile(message.filePath);
        break;
      case 'expandNode':
        if (message.nodeId) await this.handleExpandNode(message.nodeId, message.knownNodes);
        break;
      case 'cancelExpandNode':
        await this.handleCancelExpandNode(message.nodeId);
        break;
      case 'setExpandAll':
        await this.handleSetExpandAll(message);
        break;
      case 'toggleFileLineCounts':
        await this.handleToggleFileLineCounts();
        break;
      case 'refreshGraph':
        await this.refreshGraph();
        break;
      case 'findReferencingFiles':
        if (message.nodeId) await this.handleFindReferencingFiles(message.nodeId);
        break;
      case 'drillDown':
        if (message.filePath) await this.handleDrillDown(message.filePath);
        break;
      case 'ready':
        log.debug("Webview ready, sending initial graph");
        await this.updateGraph();
        break;
      case 'webviewLog':
        await this.forwardWebviewLog(message);
        break;
      case 'switchMode':
        await this.handleSwitchMode(message);
        break;
      case 'enableUnusedFilter':
        if (!this._viewLayer.filterService.isUnusedFilterActive()) {
          await this._viewLayer.filterService.toggleUnusedFilter();
        }
        break;
      case 'disableUnusedFilter':
        if (this._viewLayer.filterService.isUnusedFilterActive()) {
          await this._viewLayer.filterService.toggleUnusedFilter();
        }
        break;
      case 'selectSymbol':
        await this.handleSelectSymbol(message.symbolId);
        break;
      case 'navigateToSymbol':
        if (message.filePath && message.line) {
          await this.handleOpenFile(message.filePath, message.line);
        }
        break;
      case 'callGraphOpenFile':
      case 'callGraphSymbolFocus':
      case 'callGraphReady':
      case 'callGraphMounted':
      case 'callGraphDepthChanged':
      case 'callGraphFilterChanged':
        this.callGraphViewService?.handleWebviewMessage(message);
        break;
      default:
        log.warn('Unknown webview message command:', message.command);
    }
  }

  /**
   * Handle setExpandAll message
   */
  private async handleSetExpandAll(message: SetExpandAllMessage): Promise<void> {
    log.debug("Setting expandAll to", message.expandAll);
    await this._graphState.setExpandAll(message.expandAll);
  }

  /**
   * Handle toggleFileLineCounts: 翻转行数显示开关。
   * 状态权威在 GraphState（服务层），翻转后回推 webview 同步，保证单一真相源。
   */
  private async handleToggleFileLineCounts(): Promise<void> {
    const next = !this._graphState.getShowFileLineCounts();
    this._graphState.setShowFileLineCounts(next);
    log.info("Toggled showFileLineCounts to", next);
    this._view?.webview.postMessage({ command: "setShowFileLineCounts", value: next });
  }

  /**
   * Handle switchMode message
   */
  private async handleSwitchMode(message: SwitchModeMessage): Promise<void> {
    log.debug("Switching to", message.mode, "mode");

    if (message.mode === "file") {
      const previousSymbolId = this._stateManager.selectedSymbolId;
      await this._stateManager.setViewMode("file");
      this._stateManager.selectedSymbolId = undefined;

      const fallbackLastFile = this._stateManager.getLastActiveFilePath();
      const candidate = previousSymbolId
        ? this.parseFilePathAndSymbol(previousSymbolId)?.actualFilePath
        : undefined;
      const targetFilePath = candidate || fallbackLastFile;

      if (targetFilePath && SUPPORTED_SOURCE_FILE_REGEX.test(targetFilePath)) {
        await this._sendGraphUpdate(targetFilePath, false);
        return;
      }

      await this.updateGraph();
      return;
    }

    if (message.mode === "symbol") {
      const filePath = this.getActiveEditorFilePath();
      if (filePath) {
        await this.handleDrillDown(filePath);
      }
    }
  }

  /**
   * Forward webview log messages to extension logger
   */
  private async forwardWebviewLog(message: WebviewLogMessage): Promise<void> {
    const level = message.level ?? "info";
    const msg = message.message ?? "";
    const args = message.args ?? [];
    const webviewLogger = getExtensionLogger("Webview");

    switch (level) {
      case "debug":
        webviewLogger.debug(msg, ...args);
        break;
      case "info":
        webviewLogger.info(msg, ...args);
        break;
      case "warn":
        webviewLogger.warn(msg, ...args);
        break;
      case "error":
        webviewLogger.error(msg, ...args);
        break;
    }
  }

  /**
   * Get the active editor file path
   */
  private getActiveEditorFilePath(): string | undefined {
    const editor = vscode.window.activeTextEditor;
    return editor?.document.uri.scheme === "file" ? editor.document.fileName : undefined;
  }

  /**
   * Parse file path and symbol from symbol ID
   */
  private parseFilePathAndSymbol(symbolId: string): { actualFilePath: string } | undefined {
    // Simple implementation - extract file path from symbol ID
    const colonIndex = symbolId.lastIndexOf(':');
    if (colonIndex > 0) {
      return { actualFilePath: symbolId.substring(0, colonIndex) };
    }
    return { actualFilePath: symbolId };
  }
}
