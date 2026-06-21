// @vitest-environment node
/**
 * SpiderBuilder 回归测试。
 *
 * SpiderBuilder(批次 2.6 重构为 fluent 配置收集器)原无独立测试。本测试巩固
 * 其契约:fluent 链式返回 this、validate 校验规则、build 返回 Spider。
 *
 * build() 调 createSpiderServices(18 service 实例化),已由 standalone-sdk.test.ts
 * 证实可空跑(service 惰性 init,WASM/worker 延迟到 analyze)。validate 抛错用例
 * 在 createSpiderServices 之前抛出,不构造 service。
 */
import { describe, it, expect } from "vitest";
import { SpiderBuilder } from "../SpiderBuilder";
import { Spider } from "../spider";

describe("SpiderBuilder", () => {
  describe("fluent 配置收集", () => {
    it("withXxx 链式返回 this", () => {
      const b = new SpiderBuilder();
      expect(b.withRootDir("/proj")).toBe(b);
      expect(b.withMaxDepth(10)).toBe(b);
      expect(b.withReverseIndex(true)).toBe(b);
      expect(b.withExcludeNodeModules(false)).toBe(b);
    });

    it("withConfig 批量配置返回 this", () => {
      const b = new SpiderBuilder();
      expect(b.withConfig({ rootDir: "/proj", maxDepth: 5 })).toBe(b);
    });

    it("withCacheConfig 返回 this", () => {
      const b = new SpiderBuilder();
      expect(b.withCacheConfig({ maxCacheSize: 100 })).toBe(b);
    });
  });

  describe("validate 校验", () => {
    it("缺 rootDir 抛错", () => {
      expect(() => new SpiderBuilder().build()).toThrow("rootDir is required");
    });

    it("maxDepth 为负抛错", () => {
      expect(() =>
        new SpiderBuilder().withRootDir("/p").withMaxDepth(-1).build(),
      ).toThrow("maxDepth must be non-negative");
    });

    it("indexingConcurrency < 1 抛错", () => {
      expect(() =>
        new SpiderBuilder().withRootDir("/p").withIndexingConcurrency(0).build(),
      ).toThrow("indexingConcurrency must be at least 1");
    });

    it("maxCacheSize 为负抛错", () => {
      expect(() =>
        new SpiderBuilder().withRootDir("/p").withCacheConfig({ maxCacheSize: -1 }).build(),
      ).toThrow("maxCacheSize must be non-negative");
    });
  });

  describe("build", () => {
    it("最小配置 build 返回 Spider 实例", () => {
      const spider = new SpiderBuilder().withRootDir(__dirname).build();
      expect(spider).toBeInstanceOf(Spider);
    });
  });
});
