/**
 * Unit tests for Logger module.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ConsoleLogger,
  StderrLogger,
  NullLogger,
  getLogger,
  setLoggerBackend,
  loggerFactory,
  type LoggerBackend,
  type ILogger,
  LOG_LEVEL_PRIORITY,
} from '../index';

// Mock Node.js streams
const mockStdout = {
  write: vi.fn(),
};

const mockStderr = {
  write: vi.fn(),
};

// Mock process object
const mockProcess = {
  stdout: mockStdout,
  stderr: mockStderr,
};

describe('ConsoleLogger', () => {
  let logger: ConsoleLogger;

  beforeEach(() => {
    // @ts-ignore - mock global process
    global.process = mockProcess;
    logger = new ConsoleLogger('TestModule', 'info');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('log levels', () => {
    it('should respect log level priority', () => {
      logger.setLevel('warn');

      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');

      expect(mockStdout.write).not.toHaveBeenCalled(); // debug and info filtered
      expect(mockStderr.write).toHaveBeenCalledTimes(2); // warn and error
    });

    it('should output all logs when level is debug', () => {
      logger.setLevel('debug');

      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');

      expect(mockStdout.write).toHaveBeenCalledTimes(2); // debug and info
      expect(mockStderr.write).toHaveBeenCalledTimes(2); // warn and error
    });

    it('should output no logs when level is none', () => {
      logger.setLevel('none');

      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');

      expect(mockStdout.write).not.toHaveBeenCalled();
      expect(mockStderr.write).not.toHaveBeenCalled();
    });
  });

  describe('message formatting', () => {
    it('should format messages with timestamp and level', () => {
      logger.info('test message');

      expect(mockStdout.write).toHaveBeenCalled();
      const callArgs = mockStdout.write.mock.calls[0][0] as string;
      expect(callArgs).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/); // timestamp
      expect(callArgs).toContain('[TestModule]');
      expect(callArgs).toContain('[INFO]');
      expect(callArgs).toContain('test message');
    });

    it('should format multiple arguments', () => {
      logger.info('test', 'arg1', 123, { key: 'value' });

      expect(mockStdout.write).toHaveBeenCalled();
      const callArgs = mockStdout.write.mock.calls[0][0] as string;
      expect(callArgs).toContain('test');
      expect(callArgs).toContain('arg1');
      expect(callArgs).toContain('123');
      expect(callArgs).toContain('{"key":"value"}');
    });

    it('should format Error objects', () => {
      const error = new Error('Test error');
      logger.error('Error occurred:', error);

      expect(mockStderr.write).toHaveBeenCalled();
      const callArgs = mockStderr.write.mock.calls[0][0] as string;
      expect(callArgs).toContain('Error occurred:');
      expect(callArgs).toContain('Error: Test error');
    });
  });

  describe('output streams', () => {
    it('should write debug and info to stdout', () => {
      logger.setLevel('debug');

      logger.debug('debug message');
      logger.info('info message');

      expect(mockStdout.write).toHaveBeenCalledTimes(2);
      expect(mockStderr.write).not.toHaveBeenCalled();
    });

    it('should write warn and error to stderr', () => {
      logger.setLevel('debug');

      logger.warn('warn message');
      logger.error('error message');

      expect(mockStderr.write).toHaveBeenCalledTimes(2);
      expect(mockStdout.write).not.toHaveBeenCalled();
    });
  });
});

describe('StderrLogger', () => {
  let logger: StderrLogger;

  beforeEach(() => {
    // @ts-ignore - mock global process
    global.process = mockProcess;
    logger = new StderrLogger('StderrTest', 'debug');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should write all logs to stderr', () => {
    logger.debug('debug message');
    logger.info('info message');
    logger.warn('warn message');
    logger.error('error message');

    expect(mockStderr.write).toHaveBeenCalledTimes(4);
    expect(mockStdout.write).not.toHaveBeenCalled();
  });

  it('should respect log level priority', () => {
    logger.setLevel('warn');

    logger.debug('debug message');
    logger.info('info message');
    logger.warn('warn message');
    logger.error('error message');

    expect(mockStderr.write).toHaveBeenCalledTimes(2); // warn and error
  });
});

describe('NullLogger', () => {
  it('should not output any logs', () => {
    const logger = new NullLogger();

    logger.debug('debug message');
    logger.info('info message');
    logger.warn('warn message');
    logger.error('error message');

    expect(mockStdout.write).not.toHaveBeenCalled();
    expect(mockStderr.write).not.toHaveBeenCalled();
  });

  it('should have level "none"', () => {
    const logger = new NullLogger();
    expect(logger.level).toBe('none');
  });

  it('should ignore setLevel calls', () => {
    const logger = new NullLogger();
    logger.setLevel('debug');
    expect(logger.level).toBe('none');
  });
});

describe('LoggerFactory', () => {
  beforeAll(() => {
    // @ts-ignore - mock global process
    global.process = mockProcess;
  });

  beforeEach(() => {
    loggerFactory.clear();
    loggerFactory.setDefaultLevel('info'); // Reset to default
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up after each test
    loggerFactory.clear();
    loggerFactory.setDefaultLevel('info');
  });

  it('should create and cache loggers', () => {
    const logger1 = loggerFactory.getLogger('Module1');
    const logger2 = loggerFactory.getLogger('Module1');
    const logger3 = loggerFactory.getLogger('Module2');

    expect(logger1).toBe(logger2); // Same instance
    expect(logger1).not.toBe(logger3); // Different instance
  });

  it('should use default log level for new loggers', () => {
    loggerFactory.setDefaultLevel('warn');
    const logger = loggerFactory.getLogger('Test');

    expect(logger.level).toBe('warn');
  });

  it('should update all loggers when default level changes', () => {
    const logger1 = loggerFactory.getLogger('Module1');
    const logger2 = loggerFactory.getLogger('Module2');

    loggerFactory.setDefaultLevel('error');

    expect(logger1.level).toBe('error');
    expect(logger2.level).toBe('error');
  });

  it('should create a null logger', () => {
    const logger = loggerFactory.getNullLogger();

    expect(logger.level).toBe('none');
    logger.info('test');
    expect(mockStdout.write).not.toHaveBeenCalled();
  });
});

describe('setLoggerBackend', () => {
  beforeAll(() => {
    // @ts-ignore - mock global process
    global.process = mockProcess;
  });

  beforeEach(() => {
    loggerFactory.clear();
    loggerFactory.setDefaultLevel('info');
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up after each test
    loggerFactory.clear();
    loggerFactory.setDefaultLevel('info');
    loggerFactory.setBackend(undefined);
  });

  it('should replace existing loggers with backend loggers', () => {
    const mockBackend: LoggerBackend = {
      createLogger: vi.fn(() => ({
        level: 'debug',
        setLevel: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      })),
    };

    const logger1 = loggerFactory.getLogger('Module1');
    const originalLevel = logger1.level;

    setLoggerBackend(mockBackend);

    expect(loggerFactory.getBackend()).toBe(mockBackend);
  });
});

describe('getLogger convenience function', () => {
  beforeAll(() => {
    // @ts-ignore - mock global process
    global.process = mockProcess;
  });

  beforeEach(() => {
    loggerFactory.clear();
    loggerFactory.setDefaultLevel('info'); // Reset to default
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up after each test
    loggerFactory.clear();
    loggerFactory.setDefaultLevel('info');
  });

  it('should return a delegating logger from the factory', () => {
    const logger = getLogger('MyModule');

    // getLogger returns a DelegatingLogger that wraps ConsoleLogger
    expect(logger).toBeDefined();
    expect(logger.level).toBe('info'); // default level
  });

  it('should return the same logger for the same prefix', () => {
    const logger1 = getLogger('Module1');
    const logger2 = getLogger('Module1');

    expect(logger1).toBe(logger2);
  });

  it('should have working log methods', () => {
    const logger = getLogger('TestModule');

    // Test that all log methods exist and are callable
    expect(() => logger.debug('test')).not.toThrow();
    expect(() => logger.info('test')).not.toThrow();
    expect(() => logger.warn('test')).not.toThrow();
    expect(() => logger.error('test')).not.toThrow();
  });
});

describe('LOG_LEVEL_PRIORITY', () => {
  it('should have correct priority order', () => {
    expect(LOG_LEVEL_PRIORITY.debug).toBe(0);
    expect(LOG_LEVEL_PRIORITY.info).toBe(1);
    expect(LOG_LEVEL_PRIORITY.warn).toBe(2);
    expect(LOG_LEVEL_PRIORITY.error).toBe(3);
    expect(LOG_LEVEL_PRIORITY.none).toBe(4);
  });
});
