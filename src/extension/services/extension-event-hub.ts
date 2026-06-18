import * as path from "node:path";
import * as vscode from "vscode";
import type { Spider } from "../../analyzer/spider";
import { SUPPORTED_SOURCE_FILE_REGEX } from "../../shared/constants";
import type { VsCodeLogger } from "../extensionLogger"
import type { BackgroundIndexingManager } from "./background-indexing-manager";
import { EditorNavigationService } from "./editor-navigation-service";
import type { EventType } from "./file-change-scheduler";
import type { FileLineCounter } from "./file-line-counter";
import type { ProviderStateManager } from "../state/provider-state-manager";
import type { UnusedAnalysisCache } from "./unused-analysis-cache";

export type GraphRefreshReason =
  | "manual"
  | "indexing"
  | "fileSaved"
  | "navigation"
  | "fileChange"
  | "usage-analysis"
  | "unknown";

export interface EventHubOptions {
  spider?: Spider;
  indexingManager?: BackgroundIndexingManager;
  unusedAnalysisCache?: UnusedAnalysisCache;
  stateManager: ProviderStateManager;
  navigationService?: EditorNavigationService;
  fileLineCounter?: FileLineCounter;
  viewProvider: () => vscode.WebviewView | undefined;
  updateGraph: (isRefresh?: boolean, refreshReason?: GraphRefreshReason) => Promise<void>;
  handleDrillDown: (
    filePathOrSymbolId: string,
    isRefresh?: boolean,
    targetMode?: "list" | "symbol",
  ) => Promise<void>;
  logger: VsCodeLogger;
}

export class ExtensionEventHub {
  private readonly spider?: Spider;
  private readonly indexingManager?: BackgroundIndexingManager;
  private readonly unusedAnalysisCache?: UnusedAnalysisCache;
  private readonly stateManager: ProviderStateManager;
  private readonly navigationService?: EditorNavigationService;
  private readonly fileLineCounter?: FileLineCounter;
  private readonly viewProvider: () => vscode.WebviewView | undefined;
  private readonly updateGraph: (isRefresh?: boolean, refreshReason?: GraphRefreshReason) => Promise<void>;
  private readonly handleDrillDown: (
    filePathOrSymbolId: string,
    isRefresh?: boolean,
    targetMode?: "list" | "symbol",
  ) => Promise<void>;
  private readonly log: VsCodeLogger;
  private fileSaveDebounceTimer?: NodeJS.Timeout;

  constructor(options: EventHubOptions) {
    this.spider = options.spider;
    this.indexingManager = options.indexingManager;
    this.unusedAnalysisCache = options.unusedAnalysisCache;
    this.stateManager = options.stateManager;
    this.navigationService = options.navigationService;
    this.fileLineCounter = options.fileLineCounter;
    this.viewProvider = options.viewProvider;
    this.updateGraph = options.updateGraph;
    this.handleDrillDown = options.handleDrillDown;
    this.log = options.logger;
  }

  async handleFileSaved(filePath: string): Promise<void> {
    if (!this.spider) {
      return;
    }

    if (!SUPPORTED_SOURCE_FILE_REGEX.test(filePath)) {
      return;
    }

    this.log.debug("Re-analyzing saved file:", filePath);

    this.unusedAnalysisCache?.invalidate([filePath]);
    this.stateManager.invalidateSymbolCache(filePath);

    await this.spider.reanalyzeFile(filePath);
    await this.indexingManager?.persistIndexIfEnabled();

    if (this.stateManager.currentSymbol) {
      await this.handleDrillDown(this.stateManager.currentSymbol, true);
    } else {
      await this.updateGraph(true, "fileSaved");
    }

    // 行数独立通道：保存后立即推送该文件最新行数，不等依赖图刷新
    await this.pushFileLineCount(filePath);
  }

  handleFileSaveDocument(
    document: vscode.TextDocument,
    onFileSaved?: (filePath: string) => Promise<void>,
  ): void {
    if (document.uri.scheme !== "file") {
      return;
    }

    const filePath = document.uri.fsPath;

    const currentFilePath = this.stateManager.currentSymbol
      ? this.navigationService?.parseFilePathAndSymbol(
          this.stateManager.currentSymbol,
        ).actualFilePath
      : this.stateManager.getLastActiveFilePath();

    const shouldRefresh =
      currentFilePath &&
      path.normalize(currentFilePath) === path.normalize(filePath);

    if (!shouldRefresh) {
      this.log.debug(
        `File saved but not currently viewing: ${filePath}, skipping refresh`,
      );
      return;
    }

    if (this.fileSaveDebounceTimer) {
      clearTimeout(this.fileSaveDebounceTimer);
    }

    this.fileSaveDebounceTimer = setTimeout(() => {
      this.log.debug(`Debounce complete, refreshing view for: ${filePath}`);

      const view = this.viewProvider();
      if (view) {
        view.webview.postMessage({ command: "refreshing" });
      }

      const handler = onFileSaved ?? this.handleFileSaved.bind(this);
      handler(filePath).catch((error: unknown) => {
        this.log.error(
          "Error refreshing view after file save",
          error instanceof Error ? error : new Error(String(error)),
        );
      });
      this.fileSaveDebounceTimer = undefined;
    }, 500);
  }

  async handleActiveFileChanged(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (editor?.document.uri.scheme !== "file") {
      return;
    }

    const newFilePath = editor.document.fileName;

    if (!SUPPORTED_SOURCE_FILE_REGEX.test(newFilePath)) {
      return;
    }

    console.log('[ExtensionEventHub] handleActiveFileChanged called for:', newFilePath);

    // 检查是否是通过单击节点打开的文件，如果是则跳过 graph view 更新
    if (EditorNavigationService.isRecentlyOpened(newFilePath)) {
      this.log.debug("Skipping graph update for recently opened file:", newFilePath);
      console.log('[ExtensionEventHub] SKIPPING graph update for recently opened file:', newFilePath);
      return;
    }

    this.log.debug("Active file changed to:", newFilePath);
    console.log('[ExtensionEventHub] UPDATING graph for:', newFilePath);

    if (this.stateManager.currentSymbol) {
      await this.handleDrillDown(newFilePath, true);
    } else {
      await this.updateGraph(true, "navigation");
    }
  }

  async handleFileChange(filePath: string, eventType: EventType): Promise<void> {
    if (!this.spider) {
      return;
    }

    if (!SUPPORTED_SOURCE_FILE_REGEX.test(filePath)) {
      return;
    }

    this.log.debug(`Processing ${eventType} event for:`, filePath);

    switch (eventType) {
      case "create":
      case "change":
        await this.spider.reanalyzeFile(filePath);
        await this.indexingManager?.persistIndexIfEnabled();
        await this.refreshByCurrentView();
        break;

      case "delete":
        this.spider.handleFileDeleted(filePath);
        await this.indexingManager?.persistIndexIfEnabled();
        await this.handleDeletedFileRefresh(filePath);
        break;
    }

    // 行数独立通道：create/change 后推送该文件最新行数（delete 不必推，全量刷新时自然剔除）
    if (eventType === "create" || eventType === "change") {
      await this.pushFileLineCount(filePath);
    }
  }

  private async pushFileLineCount(filePath: string): Promise<void> {
    if (!this.fileLineCounter) {
      return;
    }
    const count = await this.fileLineCounter.countLines(filePath);
    if (count === undefined) {
      return;
    }
    this.viewProvider()?.webview.postMessage({
      command: "updateFileLineCounts",
      counts: { [filePath]: count },
    });
  }

  dispose(): void {
    if (this.fileSaveDebounceTimer) {
      clearTimeout(this.fileSaveDebounceTimer);
      this.fileSaveDebounceTimer = undefined;
    }
  }

  private async refreshByCurrentView(): Promise<void> {
    if (this.stateManager.currentSymbol) {
      await this.handleDrillDown(this.stateManager.currentSymbol, true);
    } else {
      await this.updateGraph(true, "fileChange");
    }
  }

  private async handleDeletedFileRefresh(deletedPath: string): Promise<void> {
    if (this.stateManager.selectedSymbolId === deletedPath) {
      await this.stateManager.setViewMode("file");
      this.stateManager.selectedSymbolId = undefined;
      await this.updateGraph();
    } else {
      await this.refreshByCurrentView();
    }
  }
}
