// @vitest-environment node
/**
 * PathPredicates 回归测试。
 *
 * PathPredicates(批次 2.6 从 PathResolver 抽出的 8 个纯谓词)原无测试。
 * 8 个函数均为纯字符串分类(无 IO/状态),逐函数测正/负/边界。
 */
import { describe, it, expect } from "vitest";
import {
  hasFileExtension,
  isInIgnoredDirectory,
  isNodeModule,
  isPackageJsonAliasCandidate,
  isPythonFile,
  isPythonRelativeImport,
  isRelativePath,
  isSubpathImport,
} from "../PathPredicates";

describe("PathPredicates", () => {
  describe("isRelativePath", () => {
    it("./ 或 ../ 开头为相对路径", () => {
      expect(isRelativePath("./foo")).toBe(true);
      expect(isRelativePath("../bar")).toBe(true);
      expect(isRelativePath("foo")).toBe(false);
      expect(isRelativePath("/abs")).toBe(false);
    });
  });

  describe("isNodeModule", () => {
    it("裸模块名(非 . / / # @ 开头)", () => {
      expect(isNodeModule("lodash")).toBe(true);
      expect(isNodeModule("./foo")).toBe(false);
      expect(isNodeModule("/abs")).toBe(false);
      expect(isNodeModule("#internal")).toBe(false);
      expect(isNodeModule("@scope/pkg")).toBe(false);
    });
  });

  describe("isSubpathImport", () => {
    it("# 开头为 Node subpath import", () => {
      expect(isSubpathImport("#internal/foo")).toBe(true);
      expect(isSubpathImport("lodash")).toBe(false);
    });
  });

  describe("isPackageJsonAliasCandidate", () => {
    it("@ 开头为 package.json alias 候选", () => {
      expect(isPackageJsonAliasCandidate("@scope/pkg")).toBe(true);
      expect(isPackageJsonAliasCandidate("lodash")).toBe(false);
    });
  });

  describe("hasFileExtension", () => {
    it("basename 含 . 且不以 . 开头", () => {
      expect(hasFileExtension("foo.ts")).toBe(true);
      expect(hasFileExtension("foo")).toBe(false);
      expect(hasFileExtension(".bashrc")).toBe(false);
      expect(hasFileExtension("/path/to/foo.ts")).toBe(true);
    });
  });

  describe("isPythonRelativeImport", () => {
    it(". / .. 前缀且无 / 且非裸 . / ..", () => {
      expect(isPythonRelativeImport(".helpers")).toBe(true);
      expect(isPythonRelativeImport("..utils")).toBe(true);
      expect(isPythonRelativeImport("./helpers")).toBe(false); // 含 /
      expect(isPythonRelativeImport(".")).toBe(false);
      expect(isPythonRelativeImport("..")).toBe(false);
      expect(isPythonRelativeImport("helpers")).toBe(false);
    });
  });

  describe("isPythonFile", () => {
    it(".py / .pyi 扩展", () => {
      expect(isPythonFile("foo.py")).toBe(true);
      expect(isPythonFile("foo.pyi")).toBe(true);
      expect(isPythonFile("foo.ts")).toBe(false);
    });
  });

  describe("isInIgnoredDirectory", () => {
    it("路径含忽略目录段(非末段/文件名)返回 true", () => {
      expect(isInIgnoredDirectory("/proj/node_modules/pkg/index.js")).toBe(true);
      expect(isInIgnoredDirectory("/proj/.git/config")).toBe(true);
      expect(isInIgnoredDirectory("/proj/src/foo.ts")).toBe(false);
      // 末段视为文件名,不算忽略目录
      expect(isInIgnoredDirectory("/proj/foo/node_modules")).toBe(false);
    });
  });
});
