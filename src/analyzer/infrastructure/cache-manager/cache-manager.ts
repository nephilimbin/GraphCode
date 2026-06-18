/**
 * Cache Manager Module
 *
 * Provides a generic caching system with configurable policies (LRU, TTL).
 * Designed for caching analysis results, symbol graphs, and other computed data.
 */

/**
 * Cache entry with metadata
 */
interface CacheEntry<T> {
  /** Cached value */
  value: T;
  /** Timestamp when entry was created */
  timestamp: number;
  /** Time-to-live in milliseconds (0 = no expiration) */
  ttl: number;
  /** Access count for LRU eviction */
  accessCount: number;
  /** Last access timestamp */
  lastAccess: number;
}

/**
 * Cache policy configuration
 */
export interface CachePolicy {
  /** Maximum number of entries (0 = unlimited) */
  maxSize: number;
  /** Default time-to-live in milliseconds (0 = no expiration) */
  defaultTTL: number;
  /** Whether to use LRU eviction when full */
  useLRU: boolean;
}

/**
 * Default cache policy
 */
export const DEFAULT_CACHE_POLICY: CachePolicy = {
  maxSize: 100,
  defaultTTL: 10 * 60 * 1000, // 10 minutes
  useLRU: true,
};

/**
 * Generic cache manager with LRU and TTL support
 */
export class CacheManager<T> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private policy: CachePolicy;

  constructor(policy: Partial<CachePolicy> = {}) {
    this.policy = { ...DEFAULT_CACHE_POLICY, ...policy };
  }

  /**
   * Set a value in the cache
   */
  set(key: string, value: T, ttl?: number): void {
    const entry: CacheEntry<T> = {
      value,
      timestamp: Date.now(),
      ttl: ttl ?? this.policy.defaultTTL,
      accessCount: 0,
      lastAccess: Date.now(),
    };

    this.cache.set(key, entry);

    // Enforce max size by evicting oldest entries (FIFO)
    if (this.policy.maxSize > 0 && this.cache.size > this.policy.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }
  }

  /**
   * Get a value from the cache
   * Returns null if key doesn't exist or entry has expired
   */
  get(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Check TTL expiration
    if (entry.ttl > 0) {
      const age = Date.now() - entry.timestamp;
      if (age > entry.ttl) {
        this.cache.delete(key);
        return null;
      }
    }

    // Update access metadata for LRU
    entry.accessCount++;
    entry.lastAccess = Date.now();

    return entry.value;
  }

  /**
   * Check if a key exists in the cache (without updating access metadata)
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }

    // Check TTL expiration
    if (entry.ttl > 0) {
      const age = Date.now() - entry.timestamp;
      if (age > entry.ttl) {
        this.cache.delete(key);
        return false;
      }
    }

    return true;
  }

  /**
   * Delete a specific key from the cache
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all entries from the cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get the current number of entries in the cache
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Remove all expired entries from the cache
   */
  evictExpired(): number {
    let evicted = 0;
    const now = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      if (entry.ttl > 0) {
        const age = now - entry.timestamp;
        if (age > entry.ttl) {
          this.cache.delete(key);
          evicted++;
        }
      }
    }

    return evicted;
  }

  /**
   * Evict least recently used entries if cache is full
   */
  evictLRU(count: number = 1): number {
    if (this.policy.maxSize === 0) {
      return 0;
    }

    let evicted = 0;
    const entries = Array.from(this.cache.entries());

    // Sort by last access time (oldest first)
    entries.sort((a, b) => a[1].lastAccess - b[1].lastAccess);

    for (let i = 0; i < Math.min(count, entries.length); i++) {
      const [key] = entries[i];
      if (this.cache.delete(key)) {
        evicted++;
      }
    }

    return evicted;
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    maxSize: number;
    hits: number;
    misses: number;
    hitRate: number;
  } {
    let hits = 0;
    let misses = 0;

    for (const entry of this.cache.values()) {
      hits += entry.accessCount;
    }

    const total = hits + misses;
    const hitRate = total > 0 ? hits / total : 0;

    return {
      size: this.cache.size,
      maxSize: this.policy.maxSize,
      hits,
      misses,
      hitRate,
    };
  }
}

/**
 * Cache entry metadata (for inspection)
 */
export interface CacheEntryMetadata {
  key: string;
  timestamp: number;
  ttl: number;
  accessCount: number;
  lastAccess: number;
  age: number;
  isExpired: boolean;
}

/**
 * Get detailed metadata for all cache entries
 */
export function getCacheMetadata<T>(manager: CacheManager<T>): CacheEntryMetadata[] {
  const metadata: CacheEntryMetadata[] = [];
  const now = Date.now();

  for (const [key, entry] of (manager as any).cache.entries()) {
    const age = now - entry.timestamp;
    const isExpired = entry.ttl > 0 && age > entry.ttl;

    metadata.push({
      key,
      timestamp: entry.timestamp,
      ttl: entry.ttl,
      accessCount: entry.accessCount,
      lastAccess: entry.lastAccess,
      age,
      isExpired,
    });
  }

  return metadata;
}
