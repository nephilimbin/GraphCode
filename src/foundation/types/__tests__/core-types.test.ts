/**
 * Unit tests for core utility types.
 */

import { describe, it, expect } from 'vitest';
import { ok, err, some, none, isSome, unwrapOr, type Result, type Option } from '../core-types';

describe('Result Type', () => {
  describe('ok', () => {
    it('should create a successful result', () => {
      const result = ok(42);
      expect(result).toEqual({ success: true, data: 42 });
    });

    it('should have success property set to true', () => {
      const result = ok('test');
      expect(result.success).toBe(true);
    });
  });

  describe('err', () => {
    it('should create a failed result', () => {
      const error = new Error('Test error');
      const result = err(error);
      expect(result).toEqual({ success: false, error });
    });

    it('should have success property set to false', () => {
      const result = err(new Error('Test'));
      expect(result.success).toBe(false);
    });
  });

  describe('Result type pattern', () => {
    it('should allow type narrowing with success property', () => {
      const result: Result<number, Error> = ok(100);

      if (result.success) {
        // TypeScript should know result.data exists here
        expect(result.data).toBe(100);
        expect(result.data).toBeGreaterThan(0);
      }
    });

    it('should handle error case with type narrowing', () => {
      const result: Result<number, Error> = err(new Error('Failed'));

      if (!result.success) {
        // TypeScript should know result.error exists here
        expect(result.error.message).toBe('Failed');
      }
    });
  });
});

describe('Option Type', () => {
  describe('some', () => {
    it('should create an option with a value', () => {
      const option = some(42);
      expect(option).toEqual({ isSome: true, value: 42 });
    });

    it('should have isSome property set to true', () => {
      const option = some('test');
      expect(option.isSome).toBe(true);
    });

    it('should preserve the value', () => {
      const option = some({ name: 'test' });
      if (isSome(option)) {
        expect(option.value.name).toBe('test');
      }
    });
  });

  describe('none', () => {
    it('should represent no value', () => {
      expect(none).toEqual({ isSome: false });
    });

    it('should have isSome property set to false', () => {
      expect(none.isSome).toBe(false);
    });
  });

  describe('isSome', () => {
    it('should return true for some values', () => {
      const option = some(10);
      expect(isSome(option)).toBe(true);
    });

    it('should return false for none', () => {
      expect(isSome(none)).toBe(false);
    });

    it('should narrow type correctly', () => {
      const option: Option<number> = some(42);
      if (isSome(option)) {
        // TypeScript should know option.value exists here
        expect(option.value).toBe(42);
      }
    });
  });

  describe('unwrapOr', () => {
    it('should return the value when option is some', () => {
      const option = some(10);
      expect(unwrapOr(option, 0)).toBe(10);
    });

    it('should return default when option is none', () => {
      expect(unwrapOr(none, 42)).toBe(42);
    });

    it('should work with complex types', () => {
      const option = some({ count: 5 });
      const result = unwrapOr(option, { count: 0 });
      expect(result.count).toBe(5);
    });
  });
});

describe('Type Guards', () => {
  it('should correctly narrow Result types', () => {
    const successResult: Result<string, Error> = ok('success');
    const failureResult: Result<string, Error> = err(new Error('failure'));

    if (successResult.success) {
      expect(successResult.data).toBe('success');
    }

    if (!failureResult.success) {
      expect(failureResult.error.message).toBe('failure');
    }
  });

  it('should correctly narrow Option types', () => {
    const someValue: Option<number> = some(1);
    const noneValue: Option<number> = none;

    if (isSome(someValue)) {
      expect(someValue.value).toBe(1);
    }

    if (isSome(noneValue)) {
      // This branch should never execute
      expect(true).toBe(false);
    } else {
      expect(true).toBe(true);
    }
  });
});
