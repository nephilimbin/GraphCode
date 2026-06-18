# AILayer 模块

## 📋 概述

此模块包含所有 AI 相关功能的实现。

**⚠️ 实验性功能** - 当前未在生产代码中使用。

## 🗂️ 目录结构

```
ai-layer/
├── adapters/              # AI 适配器
│   ├── vscode-lm-adapter.ts    # VS Code LM API 适配器
│   └── mcp-adapter.ts         # MCP 服务器适配器
├── tooling/              # AI 工具管理
│   └── tool-registry.ts      # 工具注册表
├── __tests__/            # 测试文件
└── index.ts              # 统一导出
```

## 🔧 功能说明

### ToolRegistry
管理 AI 工具的注册、执行和统计。

### VsCodeLMAdapter
连接到 VS Code Language Model API，支持与各种语言模型的交互。

### McpAdapter
连接到 Model Context Protocol 服务。

## 📊 使用状态

- **开发状态**: 实验性功能
- **生产使用**: 未集成
- **可删除性**: ✅ 可以安全删除整个模块

## 🗑️ 删除方法

如果确认不需要 AI 功能，可以删除整个目录：

```bash
rm -rf src/extension/ai-layer/
```

## 🔗 相关文档

- [模块化架构重构计划](../../docs/modular-architecture-refactor-plan.md)
- [AILayer 重组计划](../../docs/ai-layer-reorganization-plan.md)
