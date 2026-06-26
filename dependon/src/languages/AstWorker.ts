/**
 * AstWorker — dependon languages (worker thread entry).
 *
 * Runs in a separate thread to isolate ts-morph / WASM parsing from the main
 * bundle. Dispatches file analysis to language-specific symbol analyzers.
 *
 * Scope (vs analyzer): signature/breaking-change message handlers and the
 * SignatureAnalyzer are removed (dead code). Only analyzeFile /
 * getInternalExportDeps / getFileCount remain.
 *
 * Pure Node.js — no VS Code dependency.
 *
 * @module dependon/languages
 */

import { parentPort, workerData } from 'node:worker_threads';
import { getLogger } from '../core/Logger';
import { detectLanguageFromExtension } from '../core/LanguageDetection';
import type { SymbolDependency, SymbolInfo } from '../domain/Symbol';
import { TypeScriptSymbolAnalyzer } from './TypeScriptSymbolAnalyzer';
import { PythonSymbolAnalyzer } from './PythonSymbolAnalyzer';
import { RustSymbolAnalyzer } from './RustSymbolAnalyzer';
import { SwiftSymbolAnalyzer } from './SwiftSymbolAnalyzer';

interface WorkerData {
  /** Optional package root for locating WASM files. Auto-located when omitted. */
  extensionPath?: string;
}

const data = workerData as WorkerData;
const extensionPath = data.extensionPath;

// Worker message types (signature methods intentionally removed)
type WorkerRequest =
  | { type: 'analyzeFile'; id: number; filePath: string; content: string }
  | { type: 'getInternalExportDeps'; id: number; filePath: string; content: string }
  | { type: 'getFileCount'; id: number };

type WorkerResponse =
  | { type: 'success'; id: number; result: unknown }
  | { type: 'error'; id: number; error: string; stack?: string };

const log = getLogger('AstWorker');
const symbolAnalyzer = new TypeScriptSymbolAnalyzer(undefined, { maxFiles: 100 });

const pythonSymbolAnalyzer = new PythonSymbolAnalyzer(undefined, extensionPath);
const rustSymbolAnalyzer = new RustSymbolAnalyzer(undefined, extensionPath);
const swiftSymbolAnalyzer = new SwiftSymbolAnalyzer(undefined, extensionPath);

/** Detect language based on file extension */
function detectLanguage(filePath: string): 'python' | 'rust' | 'swift' | 'typescript' {
  const language = detectLanguageFromExtension(filePath);
  if (language === 'python') {
    return 'python';
  }
  if (language === 'rust') {
    return 'rust';
  }
  if (language === 'swift') {
    return 'swift';
  }
  return 'typescript';
}

/** Handle incoming messages from the parent thread */
async function handleMessage(message: WorkerRequest): Promise<void> {
  try {
    let result: unknown;

    switch (message.type) {
      case 'analyzeFile': {
        const language = detectLanguage(message.filePath);
        if (language === 'python') {
          await pythonSymbolAnalyzer.ensureInitialized();
          const { symbols, dependencies } = pythonSymbolAnalyzer.analyzeFileContent(
            message.filePath,
            message.content
          );
          result = { symbols, dependencies };
        } else if (language === 'rust') {
          await rustSymbolAnalyzer.ensureInitialized();
          const { symbols, dependencies } = rustSymbolAnalyzer.analyzeFileContent(
            message.filePath,
            message.content
          );
          result = { symbols, dependencies };
        } else if (language === 'swift') {
          await swiftSymbolAnalyzer.ensureInitialized();
          const { symbols, dependencies } = swiftSymbolAnalyzer.analyzeFileContent(
            message.filePath,
            message.content
          );
          result = { symbols, dependencies };
        } else {
          const { symbols, dependencies } = symbolAnalyzer.analyzeFileContent(
            message.filePath,
            message.content
          );
          result = { symbols, dependencies };
        }
        break;
      }

      case 'getInternalExportDeps': {
        const graph = symbolAnalyzer.getInternalExportDependencyGraph(
          message.filePath,
          message.content
        );
        // Convert Map to plain object for serialization
        result = Object.fromEntries(
          Array.from(graph.entries()).map(([k, v]) => [k, Array.from(v)])
        );
        break;
      }

      case 'getFileCount': {
        result = symbolAnalyzer.getFileCount();
        break;
      }

      default: {
        const exhaustive: never = message;
        throw new Error(`Unknown message type: ${JSON.stringify(exhaustive)}`);
      }
    }

    const response: WorkerResponse = {
      type: 'success',
      id: message.id,
      result,
    };
    parentPort?.postMessage(response);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    const response: WorkerResponse = {
      type: 'error',
      id: message.id,
      error: errorMessage,
      stack,
    };
    parentPort?.postMessage(response);
  }
}

// Listen for messages from parent thread
if (parentPort) {
  parentPort.on('message', (message: WorkerRequest) => {
    void handleMessage(message);
  });
} else {
  log.error('parentPort is null - worker not properly initialized');
  process.exit(1);
}

// Export types for use in AstWorkerHost
export type { SymbolDependency, SymbolInfo };
export type { WorkerRequest, WorkerResponse };
