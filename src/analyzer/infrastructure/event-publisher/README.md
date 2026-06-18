# EventPublisher Module

## 职责

提供通用的发布-订阅事件系统，用于解耦模块间通信。

## 导出

```typescript
import {
  EventPublisher,
  globalEventPublisher,
  type EventListener,
} from '@/analyzer/infrastructure/event-publisher';
```

## 使用示例

```typescript
import { EventPublisher } from '@/analyzer/infrastructure/event-publisher';

const publisher = new EventPublisher();

// Subscribe
const unsubscribe = publisher.on('file-changed', (data) => {
  console.log('File changed:', data);
});

// One-time subscription
publisher.once('analysis-complete', (data) => {
  console.log('Analysis complete:', data);
});

// Publish event
await publisher.emit('file-changed', { path: '/test.ts' });

// Unsubscribe
unsubscribe();

// Remove all subscribers
publisher.off('file-changed');

// Cleanup
publisher.dispose();
```

## 测试

```bash
npm test -- event-publisher
```

测试覆盖率：> 80%
