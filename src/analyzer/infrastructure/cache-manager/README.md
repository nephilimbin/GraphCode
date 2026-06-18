# CacheManager Module

## 职责

提供通用的缓存管理系统，支持 LRU 和 TTL 策略。

## 导出

```typescript
import {
  CacheManager,
  getCacheMetadata,
  DEFAULT_CACHE_POLICY,
  type CachePolicy,
  type CacheEntryMetadata,
} from '@/analyzer/infrastructure/cache-manager';
```

## 使用示例

```typescript
import { CacheManager } from '@/analyzer/infrastructure/cache-manager';

// Create cache with custom policy
const cache = new CacheManager<SymbolGraph>({
  maxSize: 50,
  defaultTTL: 5 * 60 * 1000, // 5 minutes
  useLRU: true,
});

// Set and get values
cache.set('file.ts', symbolGraph);
const graph = cache.get('file.ts');

// Check existence
if (cache.has('file.ts')) {
  // ...
}

// Manual cleanup
cache.evictExpired();
cache.evictLRU(5); // Evict 5 least recently used entries
cache.clear(); // Clear all
```

## 测试

```bash
npm test -- cache-manager
```

测试覆盖率：> 80%
