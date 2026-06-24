import { describe, expect, it } from "vitest";
import { GraphExtractor } from "@/analyzer";

/**
 * .tsx call graph 提取回归:tsx 必须用 tree-sitter-tsx.wasm(含 JSX),
 * 而非 tree-sitter-typescript.wasm(无 JSX,AST 残缺,组件函数与调用边丢失)。
 */
describe("GraphExtractor — .tsx 提取", () => {
  it(".tsx 含 JSX + 组件函数 + hook 调用,应捕获组件函数与 CALLS 边", async () => {
    const extractor = new GraphExtractor({ extensionPath: process.cwd() } as never);
    const src = [
      "import { useOrchestrator } from './use-orchestrator';",
      "export function SidePanel() {",
      "  const { session } = useOrchestrator();",
      "  return <div>{session.value}</div>;",
      "}",
    ].join("\n");

    const { nodes, edges } = await extractor.extractSource(
      "/test/SidePanel.tsx",
      "typescript",
      src,
    );

    const names = nodes.map((n: { name: string }) => n.name);
    // 修复前:tsx 落到无 JSX 的 typescript grammar,组件函数丢失
    expect(names).toContain("SidePanel");
    // useOrchestrator() 裸调用 → CALLS 边(目标 @@external:useOrchestrator)
    const callEdges = edges.filter(
      (e: { targetId: string; typeRelation: string }) =>
        /useOrchestrator/.test(e.targetId) && e.typeRelation === "CALLS",
    );
    expect(callEdges.length).toBeGreaterThan(0);

    extractor.dispose();
  });

  it(".ts 仍走 typescript grammar(不受 tsx 分支影响)", async () => {
    const extractor = new GraphExtractor({ extensionPath: process.cwd() } as never);
    const src = "export function add(a: number, b: number) { return a + b; }";
    const { nodes } = await extractor.extractSource("/test/add.ts", "typescript", src);
    expect(nodes.map((n: { name: string }) => n.name)).toContain("add");
    extractor.dispose();
  });

  it(".jsx 含 JSX 也应正确提取(同 tsx 走 tsx grammar)", async () => {
    const extractor = new GraphExtractor({ extensionPath: process.cwd() } as never);
    const src = [
      "import { render } from './render';",
      "export function App() {",
      "  render();",
      "  return <div className='x'>{render()}</div>;",
      "}",
    ].join("\n");

    const { nodes, edges } = await extractor.extractSource(
      "/test/App.jsx",
      "javascript",
      src,
    );

    const names = nodes.map((n: { name: string }) => n.name);
    // 修复前:jsx 落到无 JSX 的 typescript grammar,App 丢失、render() 调用边丢失
    expect(names).toContain("App");
    const callEdges = edges.filter(
      (e: { targetId: string; typeRelation: string }) =>
        /^@@external:render$/.test(e.targetId) && e.typeRelation === "CALLS",
    );
    expect(callEdges.length).toBeGreaterThan(0);

    extractor.dispose();
  });
});
