# FileSystemWatcher Module

## 职责

提供文件系统监听功能，支持防抖和过滤。

## 导出

```typescript
import {
  FileSystemWatcher,
  createFileWatcher,
  DEFAULT_FILE_WATCHER_OPTIONS,
  type FileChangeEvent,
  type FileChangeType,
  type FileWatcherOptions,
} from '@/analyzer/infrastructure/file-watcher';
```

## 使用示例

```typescript
import { FileSystemWatcher } from '@/analyzer/infrastructure/file-watcher';

const watcher = new FileSystemWatcher({
  debounceDelay: 100,
  recursive: true,
  ignore: ['node_modules', '.git'],
});

// Subscribe to file changes
const unsubscribe = watcher.onFileChange((event) => {
  console.log('File changed:', event.path, event.type);
});

// Start watching
watcher.watch('/path/to/watch');

// Stop watching
watcher.unwatch('/path/to/watch');
unsubscribe();

// Cleanup all
watcher.dispose();
```

## 测试

```bash
npm test -- file-watcher
```

测试覆盖率：> 80%
