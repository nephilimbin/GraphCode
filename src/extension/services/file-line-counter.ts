import * as fs from 'node:fs/promises';
import { getExtensionLogger } from '../extensionLogger';

const log = getExtensionLogger('FileLineCounter');

interface LineCountCacheEntry {
  mtimeMs: number;
  count: number;
}

/**
 * 计算文件总行数（物理行数），供文件依赖图节点显示（如 app.py:800）。
 *
 * 设计要点：
 * - 独立于依赖分析：行数是「文件属性」，其变化频率远高于依赖关系，
 *   故由 file watcher 按文件内容变化独立触发刷新，不随依赖图（GraphData）回传。
 * - mtime 缓存：同一 mtime 直接复用结果，避免重复 IO。
 * - 行数语义与编辑器一致：末尾换行符不额外计为空行（"a\nb\n" → 2 行）。
 * - 读失败/文件不存在/外部包 → 返回 undefined，调用方跳过该节点。
 */
export class FileLineCounter {
  private readonly cache = new Map<string, LineCountCacheEntry>();

  async countLines(filePath: string): Promise<number | undefined> {
    try {
      const stat = await fs.stat(filePath);
      const mtimeMs = stat.mtimeMs;

      const cached = this.cache.get(filePath);
      if (cached && cached.mtimeMs === mtimeMs) {
        return cached.count;
      }

      const content = await fs.readFile(filePath, 'utf-8');
      const count = this.computeLineCount(content);

      this.cache.set(filePath, { mtimeMs, count });
      return count;
    } catch (error) {
      log.debug(`countLines failed for ${filePath}:`, error);
      return undefined;
    }
  }

  /** 并行批量计算；读失败的文件被跳过（不出现在结果中）。 */
  async countLinesBatch(filePaths: string[]): Promise<Record<string, number>> {
    const entries = await Promise.all(
      filePaths.map(async (p) => [p, await this.countLines(p)] as const),
    );

    const counts: Record<string, number> = {};
    for (const [path, count] of entries) {
      if (typeof count === 'number') {
        counts[path] = count;
      }
    }
    return counts;
  }

  /**
   * 末尾换行不额外计为空行：
   * - "" → 0
   * - "abc" → 1
   * - "abc\ndef\n" → 2
   * - "abc\n\n" → 2（abc + 一个空行）
   */
  private computeLineCount(content: string): number {
    if (content === '') return 0;
    const lines = content.split(/\r?\n/);
    let count = lines.length;
    if (lines[count - 1] === '') {
      count -= 1;
    }
    return count;
  }

  dispose(): void {
    this.cache.clear();
  }
}
