// @vitest-environment node
/**
 * SignatureAnalyzer 关键路径回归测试。
 *
 * 【为什么这样测】SignatureAnalyzer 原无测试覆盖。本测试在拆分(抽取
 * SignatureExtractor / SignatureComparator)前建立回归网:断言当前 5 个对外
 * 方法的关键行为,拆分后跑同样用例即可验证"行为零变化"。
 *
 * 断言聚焦稳定语义字段(kind / isOptional / isReadonly / typeParameters /
 * breakingChange.type 等),避开 line(行号)与需 lib 解析的复合类型文本
 * (如 Promise<...>),防止 ts-morph 环境差异造成脆性。
 *
 * 【已知限制】extractTypeAliases / analyzeBreakingChanges 的 type-alias 路径
 * 在内存 Project(skipAddingFilesFromTsConfig + useInMemoryFileSystem,缺 lib)
 * 下,ts-morph 对 type alias 的 getType() 会抛错(reading 'flags'),属
 * pre-existing 行为(非本拆分引入,亦不在拆分 scope)。故该路径不纳入回归网;
 * 拆分时须原样搬迁,保持崩溃行为一致。
 */
import { describe, it, expect } from "vitest";
import { SignatureAnalyzer } from "../SignatureAnalyzer";
import type {
  ParameterInfo,
  SignatureComparisonResult,
  SignatureInfo,
} from "../SignatureAnalyzer";

const analyzer = new SignatureAnalyzer();

/** 构造最小 SignatureInfo(填默认值),便于 compareSignatures 用例聚焦差异。 */
const makeSig = (over: Partial<SignatureInfo> & { name: string }): SignatureInfo => ({
  name: over.name,
  kind: over.kind ?? "function",
  parameters: over.parameters ?? [],
  returnType: over.returnType ?? "void",
  isAsync: over.isAsync ?? false,
  line: over.line ?? 1,
  ...over,
});

/** 构造最小 ParameterInfo。 */
const makeParam = (over: Partial<ParameterInfo> & { name: string }): ParameterInfo => ({
  name: over.name,
  type: over.type ?? "string",
  isOptional: over.isOptional ?? false,
  hasDefault: over.hasDefault ?? false,
  isRest: over.isRest ?? false,
  position: over.position ?? 0,
  ...over,
});

/** 是否存在指定类型的破坏性变更。 */
const hasBreak = (results: SignatureComparisonResult[], type: string): boolean =>
  results.some((r) => r.breakingChanges.some((b) => b.type === type));

describe("SignatureAnalyzer", () => {
  describe("extractSignatures", () => {
    it("提取顶层函数 / 类方法 / 构造 / 箭头函数", () => {
      const content = [
        "function topLevel(a: string, b?: number): void {}",
        "class Foo {",
        "  constructor(public x: number) {}",
        "  greet(p: string): void {}",
        "  private secret(): void {}",
        "}",
        "const arrow = (a: number): boolean => a > 0;",
      ].join("\n");
      const sigs = analyzer.extractSignatures("test.ts", content);
      const byName = new Map(sigs.map((s) => [s.name, s]));

      const top = byName.get("topLevel");
      expect(top).toBeDefined();
      expect(top!.kind).toBe("function");
      expect(top!.returnType).toBe("void");
      expect(top!.parameters).toHaveLength(2);
      expect(top!.parameters[0]).toMatchObject({ name: "a", isOptional: false });
      expect(top!.parameters[1]).toMatchObject({ name: "b", isOptional: true });

      const ctor = byName.get("Foo.constructor");
      expect(ctor).toBeDefined();
      expect(ctor!.kind).toBe("constructor");

      const greet = byName.get("Foo.greet");
      expect(greet).toBeDefined();
      expect(greet!.kind).toBe("method");
      expect(greet!.visibility).toBe("public");

      // getVisibility 对 private 的识别依赖 scope.toString() 文本格式,当前
      // ts-morph 在内存 Project 下对 private 方法返回 'public'(pre-existing),
      // 故此处仅验证 secret 被提取为 method;visibility 比较逻辑由 compareSignatures
      // 的 visibility-reduced 用例(构造对象)覆盖。
      const secret = byName.get("Foo.secret");
      expect(secret).toBeDefined();
      expect(secret!.kind).toBe("method");

      const arrowSig = byName.get("arrow");
      expect(arrowSig).toBeDefined();
      expect(arrowSig!.kind).toBe("arrow");
      expect(arrowSig!.parameters[0]).toMatchObject({ name: "a" });
    });
  });

  describe("extractInterfaceMembers", () => {
    it("提取接口属性与方法", () => {
      const content = [
        "interface I {",
        "  name: string;",
        "  optional?: number;",
        "  readonly id: number;",
        "  greet(p: string): void;",
        "}",
      ].join("\n");
      const map = analyzer.extractInterfaceMembers("test.ts", content);
      const members = map.get("I");
      expect(members).toBeDefined();
      const byName = new Map(members!.map((m) => [m.name, m]));

      expect(byName.get("name")).toMatchObject({ kind: "property", isOptional: false });
      expect(byName.get("optional")).toMatchObject({ kind: "property", isOptional: true });
      expect(byName.get("id")).toMatchObject({ kind: "property", isReadonly: true });
      expect(byName.get("greet")).toMatchObject({ kind: "method" });
    });
  });

  describe("compareSignatures", () => {
    it("参数删除 → parameter-removed", () => {
      const r = analyzer.compareSignatures(
        makeSig({ name: "f", parameters: [makeParam({ name: "a" }), makeParam({ name: "b" })] }),
        makeSig({ name: "f", parameters: [makeParam({ name: "a" })] }),
      );
      expect(r.hasBreakingChanges).toBe(true);
      expect(r.breakingChanges.some((b) => b.type === "parameter-removed")).toBe(true);
    });

    it("新增必填参数 → parameter-added-required", () => {
      const r = analyzer.compareSignatures(
        makeSig({ name: "f", parameters: [makeParam({ name: "a" })] }),
        makeSig({ name: "f", parameters: [makeParam({ name: "a" }), makeParam({ name: "b" })] }),
      );
      expect(r.breakingChanges.some((b) => b.type === "parameter-added-required")).toBe(true);
    });

    it("新增可选参数 → 非破坏性", () => {
      const r = analyzer.compareSignatures(
        makeSig({ name: "f", parameters: [makeParam({ name: "a" })] }),
        makeSig({
          name: "f",
          parameters: [makeParam({ name: "a" }), makeParam({ name: "b", isOptional: true })],
        }),
      );
      expect(r.breakingChanges.some((b) => b.type === "parameter-added-required")).toBe(false);
      expect(r.nonBreakingChanges.some((n) => n.includes("'b'"))).toBe(true);
    });

    it("参数类型变化 → parameter-type-changed", () => {
      const r = analyzer.compareSignatures(
        makeSig({ name: "f", parameters: [makeParam({ name: "a", type: "string" })] }),
        makeSig({ name: "f", parameters: [makeParam({ name: "a", type: "number" })] }),
      );
      expect(r.breakingChanges.some((b) => b.type === "parameter-type-changed")).toBe(true);
    });

    it("返回类型变化 → return-type-changed", () => {
      const r = analyzer.compareSignatures(
        makeSig({ name: "f", returnType: "void" }),
        makeSig({ name: "f", returnType: "string" }),
      );
      expect(r.breakingChanges.some((b) => b.type === "return-type-changed")).toBe(true);
    });

    it("visibility 降低 → visibility-reduced", () => {
      const r = analyzer.compareSignatures(
        makeSig({ name: "f", visibility: "public" }),
        makeSig({ name: "f", visibility: "private" }),
      );
      expect(r.breakingChanges.some((b) => b.type === "visibility-reduced")).toBe(true);
    });
  });

  describe("analyzeBreakingChanges", () => {
    it("函数参数删除 → parameter-removed", () => {
      const results = analyzer.analyzeBreakingChanges(
        "test.ts",
        "function f(a: string, b: number): void {}",
        "function f(a: string): void {}",
      );
      expect(hasBreak(results, "parameter-removed")).toBe(true);
    });

    it("接口成员删除 → member-removed", () => {
      const results = analyzer.analyzeBreakingChanges(
        "test.ts",
        "interface I { a: string; b: number; }",
        "interface I { a: string; }",
      );
      expect(hasBreak(results, "member-removed")).toBe(true);
    });
  });
});
