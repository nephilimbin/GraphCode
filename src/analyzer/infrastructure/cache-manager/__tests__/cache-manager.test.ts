/**
 * Unit tests for CacheManager module.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CacheManager,
  getCacheMetadata,
  DEFAULT_CACHE_POLICY,
  type CachePolicy,
} from '../cache-manager';

describe('CacheManager', () => {
  let cache: CacheManager<string>;

  beforeEach(() => {
    cache = new CacheManager<string>();
  });

  describe('set and get', () => {
    it('should store and retrieve values', () => {
      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');
    });

    it('should return null for non-existent keys', () => {
      expect(cache.get('nonexistent')).toBeNull();
    });

    it('should update existing keys', () => {
      cache.set('key1', 'value1');
      cache.set('key1', 'value2');
      expect(cache.get('key1')).toBe('value2');
    });
  });

  describe('TTL expiration', () => {
    it('should expire entries after TTL', async () => {
      const shortTTLCache = new CacheManager<string>({ defaultTTL: 100 });

      shortTTLCache.set('key1', 'value1');
      expect(shortTTLCache.get('key1')).toBe('value1');

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 150));
      expect(shortTTLCache.get('key1')).toBeNull();
    });

    it('should not expire entries with TTL of 0', async () => {
      cache.set('key1', 'value1', 0);

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(cache.get('key1')).toBe('value1');
    });

    it('should support custom TTL per entry', async () => {
      cache.set('key1', 'value1', 50);
      cache.set('key2', 'value2', 200);

      await new Promise(resolve => setTimeout(resolve, 75));

      expect(cache.get('key1')).toBeNull(); // Expired
      expect(cache.get('key2')).toBe('value2'); // Still valid
    });
  });

  describe('LRU eviction', () => {
    it('should enforce max size', () => {
      const smallCache = new CacheManager<string>({ maxSize: 2 });

      smallCache.set('key1', 'value1');
      smallCache.set('key2', 'value2');
      expect(smallCache.size).toBe(2);

      smallCache.set('key3', 'value3');
      expect(smallCache.size).toBe(2); // Should evict one entry
    });

    it('should track access count for LRU', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      cache.get('key1');
      cache.get('key1');
      cache.get('key2');

      const metadata = getCacheMetadata(cache);
      const key1Meta = metadata.find(m => m.key === 'key1');
      const key2Meta = metadata.find(m => m.key === 'key2');

      expect(key1Meta?.accessCount).toBe(2);
      expect(key2Meta?.accessCount).toBe(1);
    });

    it('should update last access time on get', async () => {
      cache.set('key1', 'value1');

      await new Promise(resolve => setTimeout(resolve, 50));
      cache.get('key1');

      const metadata = getCacheMetadata(cache);
      const key1Meta = metadata.find(m => m.key === 'key1');

      expect(key1Meta?.lastAccess).toBeGreaterThan(key1Meta?.timestamp || 0);
    });
  });

  describe('has', () => {
    it('should return true for existing keys', () => {
      cache.set('key1', 'value1');
      expect(cache.has('key1')).toBe(true);
    });

    it('should return false for non-existent keys', () => {
      expect(cache.has('nonexistent')).toBe(false);
    });

    it('should return false for expired keys', async () => {
      const shortTTLCache = new CacheManager<string>({ defaultTTL: 50 });

      shortTTLCache.set('key1', 'value1');
      await new Promise(resolve => setTimeout(resolve, 75));

      expect(shortTTLCache.has('key1')).toBe(false);
    });

    it('should not update access count', () => {
      cache.set('key1', 'value1');

      cache.has('key1');
      cache.has('key1');

      const metadata = getCacheMetadata(cache);
      const key1Meta = metadata.find(m => m.key === 'key1');

      expect(key1Meta?.accessCount).toBe(0); // has() shouldn't increment
    });
  });

  describe('delete', () => {
    it('should remove specific keys', () => {
      cache.set('key1', 'value1');
      expect(cache.has('key1')).toBe(true);

      expect(cache.delete('key1')).toBe(true);
      expect(cache.has('key1')).toBe(false);
    });

    it('should return false for non-existent keys', () => {
      expect(cache.delete('nonexistent')).toBe(false);
    });
  });

  describe('clear', () => {
    it('should remove all entries', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      expect(cache.size).toBe(2);

      cache.clear();

      expect(cache.size).toBe(0);
      expect(cache.get('key1')).toBeNull();
      expect(cache.get('key2')).toBeNull();
    });
  });

  describe('evictExpired', () => {
    it('should remove expired entries', async () => {
      cache.set('key1', 'value1', 50);
      cache.set('key2', 'value2', 100);
      cache.set('key3', 'value3', 200);

      await new Promise(resolve => setTimeout(resolve, 75));

      const evicted = cache.evictExpired();

      expect(evicted).toBe(1);
      expect(cache.has('key1')).toBe(false);
      expect(cache.has('key2')).toBe(true);
      expect(cache.has('key3')).toBe(true);
    });

    it('should return 0 if no expired entries', () => {
      cache.set('key1', 'value1');

      const evicted = cache.evictExpired();

      expect(evicted).toBe(0);
    });
  });

  describe('evictLRU', () => {
    it('should evict least recently used entries', async () => {
      // Use maxSize of 5 to avoid auto-eviction during set
      const smallCache = new CacheManager<string>({ maxSize: 5 });

      smallCache.set('key1', 'value1');
      smallCache.set('key2', 'value2');
      smallCache.set('key3', 'value3');
      smallCache.set('key4', 'value4');
      smallCache.set('key5', 'value5');

      // Access key4 and key5 to make them more recently used
      smallCache.get('key4');
      smallCache.get('key5');

      // Wait a bit to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));

      // Now manually evict 3 least recently used entries
      const evicted = smallCache.evictLRU(3);

      expect(evicted).toBe(3);
      expect(smallCache.size).toBe(2);
      // The least recently used (key1, key2, key3) should be evicted
      expect(smallCache.has('key1')).toBe(false);
      expect(smallCache.has('key2')).toBe(false);
      expect(smallCache.has('key3')).toBe(false);
      expect(smallCache.has('key4')).toBe(true);
      expect(smallCache.has('key5')).toBe(true);
    });

    it('should evict multiple entries', async () => {
      const cache = new CacheManager<string>({ maxSize: 5 });

      for (let i = 1; i <= 5; i++) {
        cache.set(`key${i}`, `value${i}`);
      }

      // Access key4 and key5 to make them more recently used
      cache.get('key4');
      cache.get('key5');

      await new Promise(resolve => setTimeout(resolve, 10));

      const evicted = cache.evictLRU(2);

      expect(evicted).toBe(2);
      expect(cache.size).toBe(3);
    });
  });

  describe('getStats', () => {
    it('should return cache statistics', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      cache.get('key1');
      cache.get('key1');
      cache.get('key2');
      cache.get('nonexistent'); // Should not affect stats

      const stats = cache.getStats();

      expect(stats.size).toBe(2);
      expect(stats.hits).toBeGreaterThan(0);
      expect(stats.hitRate).toBeGreaterThanOrEqual(0);
      expect(stats.hitRate).toBeLessThanOrEqual(1);
    });

    it('should handle empty cache', () => {
      const stats = cache.getStats();

      expect(stats.size).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.hitRate).toBe(0);
    });
  });

  describe('size', () => {
    it('should return current cache size', () => {
      expect(cache.size).toBe(0);

      cache.set('key1', 'value1');
      expect(cache.size).toBe(1);

      cache.set('key2', 'value2');
      expect(cache.size).toBe(2);

      cache.delete('key1');
      expect(cache.size).toBe(1);
    });
  });
});

describe('getCacheMetadata', () => {
  it('should return metadata for all cache entries', () => {
    const cache = new CacheManager<string>({ defaultTTL: 5000 });

    cache.set('key1', 'value1');
    cache.set('key2', 'value2', 100);

    const metadata = getCacheMetadata(cache);

    expect(metadata).toHaveLength(2);

    const key1Meta = metadata.find(m => m.key === 'key1');
    expect(key1Meta).toBeDefined();
    expect(key1Meta?.key).toBe('key1');
    expect(key1Meta?.accessCount).toBeGreaterThanOrEqual(0);
    expect(key1Meta?.isExpired).toBe(false);

    const key2Meta = metadata.find(m => m.key === 'key2');
    expect(key2Meta?.ttl).toBe(100);
  });

  it('should correctly identify expired entries', async () => {
    const cache = new CacheManager<string>();

    cache.set('key1', 'value1', 50);

    await new Promise(resolve => setTimeout(resolve, 75));

    const metadata = getCacheMetadata(cache);
    const key1Meta = metadata.find(m => m.key === 'key1');

    expect(key1Meta?.isExpired).toBe(true);
  });
});

describe('DEFAULT_CACHE_POLICY', () => {
  it('should have sensible defaults', () => {
    expect(DEFAULT_CACHE_POLICY.maxSize).toBe(100);
    expect(DEFAULT_CACHE_POLICY.defaultTTL).toBe(10 * 60 * 1000); // 10 minutes
    expect(DEFAULT_CACHE_POLICY.useLRU).toBe(true);
  });
});
