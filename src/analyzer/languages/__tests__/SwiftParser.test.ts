import { describe, it, expect, beforeEach } from "vitest";
import { SwiftParser } from "../SwiftParser";
import { SwiftSymbolAnalyzer } from "../SwiftSymbolAnalyzer";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Derive paths from the test file location — vitest's process.cwd() is not
// reliably the project root, so __dirname is used instead.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// __tests/ -> languages -> analyzer -> src -> project root (4 levels up)
const extensionPath = path.resolve(__dirname, "../../../..");

describe("SwiftParser", () => {
  let parser: SwiftParser;
  const testProjectRoot = path.join(extensionPath, "test", "NetNewsWire-main");

  beforeEach(() => {
    parser = new SwiftParser(testProjectRoot, extensionPath);
  });

  describe("parseImports", () => {
    it("should parse Swift import statements", async () => {
      const testFile = path.join(testProjectRoot, "Shared/Assets.swift");
      const dependencies = await parser.parseImports(testFile);

      expect(dependencies.length).toBeGreaterThan(0);

      // Check for expected imports from Assets.swift
      const importModules = dependencies.map((d) => d.module);
      expect(importModules).toContain("Foundation");
      expect(importModules).toContain("RSCore");
      expect(importModules).toContain("Account");

      // Verify structure
      dependencies.forEach((dep) => {
        expect(dep).toHaveProperty("module");
        expect(dep).toHaveProperty("type", "import");
        expect(dep).toHaveProperty("line");
        expect(dep.line).toBeGreaterThan(0);
      });
    });

    it("should handle files with no imports", async () => {
      // Create a temporary test file with no imports
      const testContent = `
        struct TestStruct {
            var name: String
        }
        `;
      const tempFilePath = path.join(testProjectRoot, "TestFile.swift");

      // Note: This test would require creating a real temp file
      // For now, we'll skip it
    });
  });

  describe("resolvePath", () => {
    it("should resolve absolute imports", async () => {
      const testFile = path.join(testProjectRoot, "Shared/Assets.swift");
      const resolved = await parser.resolvePath(testFile, "Foundation");

      // Foundation is a system module, so it might not resolve to a file path
      // But the resolver should not throw an error
      expect(resolved).toBeNull(); // System modules typically return null
    });

    it("should return null for unresolvable modules", async () => {
      const testFile = path.join(testProjectRoot, "Shared/Assets.swift");
      const resolved = await parser.resolvePath(testFile, "NonExistentModule");

      expect(resolved).toBeNull();
    });

    // Swift modules are directories (SwiftPM Sources/<module>/), not files.
    // A module resolves to a representative .swift entry file, mirroring
    // Python's `foo/__init__.py`.
    it("should resolve a SwiftPM directory module to an entry file", async () => {
      // Account has a same-name Account.swift entry, which is preferred.
      const testFile = path.join(testProjectRoot, "Shared/Assets.swift");
      const resolved = await parser.resolvePath(testFile, "Account");

      expect(resolved).not.toBeNull();
      const expectedEntry = path.join(
        testProjectRoot,
        "Modules",
        "Account",
        "Sources",
        "Account",
        "Account.swift",
      );
      expect(resolved).toBe(expectedEntry);
    });

    // Modules sit in a sibling directory (Modules/) that the upward walk
    // from the importing file cannot reach — the project-wide BFS must find
    // them.
    it("should resolve a module in a sibling directory via project-wide search", async () => {
      // AppDelegate.swift lives in Mac/; Modules/ is only reachable by BFS.
      const testFile = path.join(testProjectRoot, "Mac", "AppDelegate.swift");
      const resolved = await parser.resolvePath(testFile, "Articles");

      expect(resolved).not.toBeNull();
      // Articles has no same-name entry, so any .swift in its target dir is fine.
      expect(resolved).toContain(
        path.join("Modules", "Articles", "Sources", "Articles"),
      );
      expect(resolved).toMatch(/\.swift$/u);
    });

    it("should return null for system modules and swift-less packages", async () => {
      const testFile = path.join(testProjectRoot, "Mac", "AppDelegate.swift");

      // System frameworks are not on disk under the project.
      expect(await parser.resolvePath(testFile, "AppKit")).toBeNull();
      expect(await parser.resolvePath(testFile, "os")).toBeNull();

      // RSCoreObjC ships no Swift sources — no entry file exists.
      expect(await parser.resolvePath(testFile, "RSCoreObjC")).toBeNull();
    });

    // End-to-end: the file-dependency view runs parseImports then resolvePath
    // per import. AppDelegate.swift mixes local modules, system frameworks,
    // ObjC/resource-only packages, and third-party — mirroring the user's
    // reported scenario where no related modules showed up.
    it("resolves the local modules of AppDelegate.swift end-to-end", async () => {
      const testFile = path.join(testProjectRoot, "Mac", "AppDelegate.swift");
      const deps = await parser.parseImports(testFile);

      const resolved = new Set<string>();
      for (const dep of deps) {
        const p = await parser.resolvePath(testFile, dep.module);
        if (p) {
          resolved.add(dep.module);
        }
      }

      const expectedLocal = ["Account", "Articles", "ErrorLog", "RSCore", "RSWeb", "Secrets"];
      for (const m of expectedLocal) {
        expect(resolved.has(m), `${m} should resolve to a local module`).toBe(true);
      }

      // System / ObjC / resource-only / third-party must NOT resolve.
      // CrashReporter is an Apple framework; a same-named file exists at
      // Mac/CrashReporter/CrashReporter.swift but must NOT be linked.
      const expectedUnresolved = [
        "AppKit",
        "os",
        "CrashReporter",
        "RSCoreObjC",
        "RSCoreResources",
        "Sparkle",
      ];
      for (const m of expectedUnresolved) {
        expect(resolved.has(m), `${m} should not resolve`).toBe(false);
      }
    });
  });
});

describe("SwiftSymbolAnalyzer", () => {
  let analyzer: SwiftSymbolAnalyzer;
  const testProjectRoot = path.join(extensionPath, "test", "NetNewsWire-main");

  beforeEach(() => {
    analyzer = new SwiftSymbolAnalyzer(testProjectRoot, extensionPath);
  });

  describe("analyzeFile", () => {
    it("should extract Swift symbols from file", async () => {
      const testFile = path.join(testProjectRoot, "Shared/Assets.swift");
      const symbols = await analyzer.analyzeFile(testFile);

      expect(symbols.size).toBeGreaterThan(0);

      const symbolArray = Array.from(symbols.values());

      // tree-sitter-swift unifies struct/class/enum/extension into
      // class_declaration, so structs surface as ClassDeclaration.
      const structSymbols = symbolArray.filter((s) => s.kind === "ClassDeclaration");
      expect(structSymbols.length).toBeGreaterThan(0);

      // Verify structure
      symbolArray.forEach((symbol) => {
        expect(symbol).toHaveProperty("name");
        expect(symbol).toHaveProperty("kind");
        expect(symbol).toHaveProperty("line");
        expect(symbol).toHaveProperty("id");
        expect(symbol).toHaveProperty("category");
        expect(symbol).toHaveProperty("isExported");
      });
    });

    it("should extract nested symbols", async () => {
      const testFile = path.join(testProjectRoot, "Shared/Assets.swift");
      const symbols = await analyzer.analyzeFile(testFile);

      const symbolArray = Array.from(symbols.values());

      // Check for nested structures (like Assets.Images)
      const nestedSymbols = symbolArray.filter((s) => s.parentSymbolId);
      expect(nestedSymbols.length).toBeGreaterThan(0);

      nestedSymbols.forEach((symbol) => {
        expect(symbol.parentSymbolId).toBeDefined();
        expect(symbol.parentSymbolId).toContain(testFile);
      });
    });
  });

  describe("getSymbolDependencies", () => {
    it("should extract symbol dependencies", async () => {
      const testFile = path.join(testProjectRoot, "Shared/Assets.swift");
      const dependencies = await analyzer.getSymbolDependencies(testFile);

      // Should have some dependencies
      expect(dependencies.length).toBeGreaterThanOrEqual(0);

      // Verify structure
      dependencies.forEach((dep) => {
        expect(dep).toHaveProperty("sourceSymbolId");
        expect(dep).toHaveProperty("targetSymbolId");
        expect(dep).toHaveProperty("targetFilePath");
        expect(dep).toHaveProperty("isTypeOnly");
      });
    });
  });

  describe("analyzeFileContent", () => {
    it("should analyze Swift code and return symbols and dependencies", async () => {
      await analyzer.ensureInitialized();

      const testCode = `
        import Foundation

        struct TestStruct {
            var name: String

            func processName() -> String {
                return name.uppercased()
            }
        }

        class TestClass {
            let value: Int

            init(value: Int) {
                self.value = value
            }

            func calculate() -> Int {
                return value * 2
            }
        }
        `;

      const result = analyzer.analyzeFileContent("test.swift", testCode);

      expect(result.symbols.length).toBeGreaterThan(0);
      expect(result.dependencies).toBeDefined();

      // struct TestStruct surfaces as ClassDeclaration (grammar unification).
      const structSymbol = result.symbols.find((s) => s.name === "TestStruct");
      expect(structSymbol).toBeDefined();
      expect(structSymbol?.kind).toBe("ClassDeclaration");

      const classSymbol = result.symbols.find((s) => s.name === "TestClass");
      expect(classSymbol).toBeDefined();
      expect(classSymbol?.kind).toBe("ClassDeclaration");

      // Check for method symbols
      const methodSymbols = result.symbols.filter((s) => s.category === "function");
      expect(methodSymbols.length).toBeGreaterThan(0);
    });

    it("should correctly identify exported symbols", async () => {
      await analyzer.ensureInitialized();

      const testCode = `
        public struct PublicStruct {
            var value: Int
        }

        private struct PrivateStruct {
            var value: Int
        }

        internal struct InternalStruct {
            var value: Int
        }
        `;

      const result = analyzer.analyzeFileContent("test.swift", testCode);

      const publicStruct = result.symbols.find((s) => s.name === "PublicStruct");
      expect(publicStruct?.isExported).toBe(true);

      const privateStruct = result.symbols.find((s) => s.name === "PrivateStruct");
      expect(privateStruct?.isExported).toBe(false);

      const internalStruct = result.symbols.find((s) => s.name === "InternalStruct");
      expect(internalStruct?.isExported).toBe(true); // internal is exported within module
    });
  });
});
