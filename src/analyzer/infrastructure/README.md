# Infrastructure Layer

基础设施层 - 提供缓存、事件、文件监听和 Worker 线程池等基础服务。

## 模块

### CacheManager
通用缓存管理器，支持 LRU 和 TTL 缓存策略。

**功能：**
- LRU（最近最少使用）缓存
- TTL（生存时间）缓存
- 访问计数统计
- 缓存大小管理

**文件：**
- `cache-manager/cache-manager.ts`

### EventPublisher
发布-订阅事件系统。

**功能：**
- 事件发布和订阅
- 错误隔离
- 一次性订阅
- 事件历史查询

**文件：**
- `event-publisher/event-publisher.ts`

### FileSystemWatcher
文件系统监听服务。

**功能：**
- 文件变更监听
- 路径过滤
- 防抖处理
- 事件发布集成

**文件：**
- `file-watcher/file-system-watcher.ts`

### WorkerPool
Worker 线程池管理。

**功能：**
- IndexerWorker 管理（后台索引）
- AstWorker 管理（AST 分析）
- Worker 通信抽象
- 消息超时处理
- 生命周期管理

**文件：**
- `worker-pool/worker-pool.ts`
- `worker-pool/index.ts`

## 运行测试

```bash
npm test -- src/analyzer/infrastructure
```

## 设计模式

1. **策略模式** - CacheManager 支持多种缓存策略
2. **观察者模式** - EventPublisher 发布-订阅
3. **模板方法模式** - WorkerHost 抽象基类
4. **工厂模式** - createWorkerPoolManager()

## 架构决策

1. **Worker 隔离**：每个 Worker 类型有独立的 Host 类
2. **消息抽象**：统一的 WorkerMessage/WorkerResponse 接口
3. **超时保护**：30秒超时防止 Worker 挂起
4. **错误隔离**：Worker 错误不影响主线程

## 下一步

- [ ] 实现真实的 Worker 通信（需要编译 Worker 文件）
- [ ] 添加 Worker 重启机制
- [ ] 实现 Worker 池化和复用
- [ ] 添加 Worker 性能监控
