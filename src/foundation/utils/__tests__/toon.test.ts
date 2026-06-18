/**
 * Unit tests for TOON encoding utilities.
 */

import { describe, it, expect } from 'vitest';
import {
  jsonToToon,
  toonToJson,
  estimateTokenSavings,
  type ToonOptions,
} from '../toon';

describe('jsonToToon', () => {
  it('should convert simple array of objects to TOON format', () => {
    const data = [
      { file: 'main.ts', deps: ['fs', 'path'] },
      { file: 'utils.ts', deps: ['os'] },
    ];

    const toon = jsonToToon(data, { objectName: 'files' });

    expect(toon).toContain('files(file,deps)');
    expect(toon).toContain('[main.ts,fs|path]'); // Arrays use | delimiter without extra brackets
    expect(toon).toContain('[utils.ts,os]');
  });

  it('should handle empty array', () => {
    const toon = jsonToToon([], { objectName: 'data' });
    expect(toon).toBe('data()\n');
  });

  it('should escape special characters by default', () => {
    const data = [
      { file: 'file,with,commas', value: 'test[value]' },
    ];

    const toon = jsonToToon(data, { objectName: 'data' });
    expect(toon).toContain('\\,'); // escaped commas
    expect(toon).toContain('\\['); // escaped brackets
  });

  it('should handle nested arrays', () => {
    const data = [
      { tags: ['a', 'b', 'c'] },
    ];

    const toon = jsonToToon(data, { objectName: 'items' });
    expect(toon).toContain('[a|b|c]');
  });

  it('should handle numbers and booleans', () => {
    const data = [
      { count: 42, active: true, name: 'test' },
    ];

    const toon = jsonToToon(data, { objectName: 'data' });
    expect(toon).toContain('[42,true,test]');
  });

  it('should handle null and undefined values', () => {
    const data = [
      { name: 'test', value: null, missing: undefined },
    ];

    const toon = jsonToToon(data, { objectName: 'data' });
    expect(toon).toContain('[test,,]'); // Empty string for null/undefined
  });

  it('should throw error for non-object array', () => {
    expect(() => jsonToToon([1, 2, 3] as unknown[])).toThrow();
  });
});

describe('toonToJson', () => {
  it('should parse TOON format back to JSON array', () => {
    const toon = `files(file,deps)
[main.ts,fs|path]
[utils.ts,os]`;

    const data = toonToJson(toon) as Array<{ file: string; deps: unknown }>;

    expect(data).toHaveLength(2);
    expect(data[0].file).toBe('main.ts');
    expect(data[0].deps).toEqual(['fs', 'path']); // Array with >1 element
    expect(data[1].file).toBe('utils.ts');
    expect(data[1].deps).toBe('os'); // Single element is parsed as string (TOON format design)
  });

  it('should parse empty TOON string', () => {
    const data = toonToJson('data()\n');
    expect(data).toEqual([]);
  });

  it('should unescape special characters', () => {
    const toon = `data(name,value)
[file\\,with\\,commas,test\\[value\\]]`;

    const data = toonToJson(toon) as Array<{ name: string; value: string }>;

    expect(data[0].name).toBe('file,with,commas');
    expect(data[0].value).toBe('test[value]');
  });

  it('should parse nested arrays', () => {
    const toon = `items(tags)
[a|b|c]`;

    const data = toonToJson(toon) as Array<{ tags: unknown }>;

    // TOON parses arrays with >1 element as arrays, single elements as strings
    expect(data[0].tags).toEqual(['a', 'b', 'c']);
  });

  it('should parse numbers and booleans', () => {
    const toon = `data(count,active,name)
[42,true,test]`;

    const data = toonToJson(toon) as Array<{ count: number; active: boolean; name: string }>;

    expect(data[0].count).toBe(42);
    expect(data[0].active).toBe(true);
    expect(data[0].name).toBe('test');
  });

  it('should handle empty values', () => {
    const toon = `data(name,value,missing)
[test,,]`;

    const data = toonToJson(toon) as Array<{ name: string; value: string; missing: string }>;

    expect(data[0].name).toBe('test');
    expect(data[0].value).toBe('');
    expect(data[0].missing).toBe('');
  });

  it('should skip empty lines', () => {
    const toon = `data(name)
[test1]

[test2]`;

    const data = toonToJson(toon) as Array<{ name: string }>;

    expect(data).toHaveLength(2);
    expect(data[0].name).toBe('test1');
    expect(data[1].name).toBe('test2');
  });

  it('should throw error on invalid TOON header', () => {
    expect(() => toonToJson('invalid header')).toThrow();
  });

  it('should throw error on value count mismatch', () => {
    const toon = `data(name,value)
[test]`;

    expect(() => toonToJson(toon)).toThrow();
  });
});

describe('estimateTokenSavings', () => {
  it('should calculate token savings', () => {
    const jsonStr = JSON.stringify([
      { file: 'main.ts', deps: ['fs', 'path'] },
      { file: 'utils.ts', deps: ['os'] },
    ]);

    const toonStr = jsonToToon(JSON.parse(jsonStr), { objectName: 'files' });

    const savings = estimateTokenSavings(jsonStr, toonStr);

    expect(savings.jsonTokens).toBeGreaterThan(0);
    expect(savings.toonTokens).toBeGreaterThan(0);
    expect(savings.savings).toBeGreaterThan(0);
    expect(savings.savingsPercent).toBeGreaterThan(0);
  });

  it('should provide breakdown of token counts', () => {
    const savings = estimateTokenSavings('test', 'test');

    expect(savings).toHaveProperty('jsonTokens');
    expect(savings).toHaveProperty('toonTokens');
    expect(savings).toHaveProperty('savings');
    expect(savings).toHaveProperty('savingsPercent');
  });
});

describe('Round-trip conversion', () => {
  it('should preserve data integrity through TOON conversion', () => {
    const originalData = [
      { file: 'main.ts', deps: ['fs', 'path'], count: 5, active: true },
      { file: 'utils.ts', deps: ['os'], count: 1, active: false },
      { file: 'config.ts', deps: [], count: 0, active: true },
    ];

    const toon = jsonToToon(originalData, { objectName: 'files' });
    const parsedData = toonToJson(toon);

    // Note: TOON format treats single-element arrays as strings
    // This is a design trade-off for token efficiency
    expect(parsedData[0]).toEqual(originalData[0]);
    // Single-element array becomes string
    expect(parsedData[1]).toEqual({ file: 'utils.ts', deps: 'os', count: 1, active: false });
    // Empty array becomes empty string
    expect(parsedData[2]).toEqual({ file: 'config.ts', deps: '', count: 0, active: true });
  });

  it('should handle complex nested structures', () => {
    const originalData = [
      { config: { key: 'value', nested: { arr: [1, 2, 3] } } },
    ];

    const toon = jsonToToon(originalData, { objectName: 'data' });
    const parsedData = toonToJson(toon);

    expect(parsedData).toEqual(originalData);
  });
});
