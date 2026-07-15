# 更新日志（Changelog）

记录 GraphCode 扩展各版本面向用户的变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [Unreleased]

## [0.0.2] - 2026-07-16

### Fixed

- **修复循环依赖误报**：Python 文件中 bare import 命中同名文件时（典型如 `pty.py` 内函数体的 `import pty`），会被误解析为对自身的依赖、形成自环边，进而被误判为「循环依赖」。现已在依赖图构建阶段过滤自环边，真实跨文件循环依赖（A→B→A）的检测不受影响。
