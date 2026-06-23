import { describe, expect, it } from "vitest";
import { parseJsonc } from "../parseJsonc";

describe("parseJsonc", () => {
  it("解析纯 JSON(无注释)", () => {
    expect(parseJsonc('{"a":1}')).toEqual({ a: 1 });
  });

  it("剥离行注释 //", () => {
    expect(parseJsonc('{\n"a":1 // comment\n}')).toEqual({ a: 1 });
  });

  it("剥离块注释 /* */", () => {
    expect(parseJsonc('{"a":1 /* c */,"b":2}')).toEqual({ a: 1, b: 2 });
  });

  it("保留字符串内的 //(不误伤 url)", () => {
    expect(parseJsonc('{"url":"http://x//y"}')).toEqual({ url: "http://x//y" });
  });

  it("保留字符串内的 /* */", () => {
    expect(parseJsonc('{"a":"x/*not a comment*/y"}')).toEqual({
      a: "x/*not a comment*/y",
    });
  });

  it("去除对象的 trailing comma", () => {
    expect(parseJsonc('{"a":1,}')).toEqual({ a: 1 });
  });

  it("去除数组的 trailing comma", () => {
    expect(parseJsonc("[1,2,]")).toEqual([1, 2]);
  });

  it("不误删字符串内的逗号+闭合符(关键回归)", () => {
    // 逗号和 } 都在字符串值内,必须原样保留
    expect(parseJsonc('{"a":"x,}"}')).toEqual({ a: "x,}" });
    expect(parseJsonc('{"a":"x,]"}')).toEqual({ a: "x,]" });
  });

  it("处理转义引号", () => {
    expect(parseJsonc('{"a":"say \\"hi\\""}')).toEqual({ a: 'say "hi"' });
  });

  it("混合注释 + trailing comma + 字符串(模拟真实 tsconfig)", () => {
    const ts = `{
      /* Bundler mode */
      "compilerOptions": {
        "target": "ES2022",
        "baseUrl": ".",
        "paths": { "@/*": ["src/*"] }, // path alias
      }
    }`;
    expect(parseJsonc(ts)).toEqual({
      compilerOptions: {
        target: "ES2022",
        baseUrl: ".",
        paths: { "@/*": ["src/*"] },
      },
    });
  });

  it("注释跨越多行且含换行符", () => {
    const ts = `{
      "a": 1,
      /*
       * multi-line
       * block comment
       */
      "b": 2
    }`;
    expect(parseJsonc(ts)).toEqual({ a: 1, b: 2 });
  });
});
