/**
 * Unit tests for EventPublisher module.
 */

import { describe, it, expect, vi } from 'vitest';
import { EventPublisher, globalEventPublisher } from '../event-publisher';

describe('EventPublisher', () => {
  let publisher: EventPublisher;

  beforeEach(() => {
    publisher = new EventPublisher();
  });

  describe('on and emit', () => {
    it('should notify subscribers on emit', async () => {
      const listener = vi.fn();
      publisher.on('test', listener);

      await publisher.emit('test', 'data');

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith('data');
    });

    it('should support multiple subscribers', async () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      publisher.on('test', listener1);
      publisher.on('test', listener2);

      await publisher.emit('test', 'data');

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
    });

    it('should pass data to listeners', async () => {
      const listener = vi.fn();
      const data = { key: 'value' };

      publisher.on('test', listener);
      await publisher.emit('test', data);

      expect(listener).toHaveBeenCalledWith(data);
    });
  });

  describe('once', () => {
    it('should only call listener once', async () => {
      const listener = vi.fn();
      publisher.once('test', listener);

      await publisher.emit('test', 'data1');
      await publisher.emit('test', 'data2');

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith('data1');
    });

    it('should remove one-time listener after execution', async () => {
      const listener = vi.fn();
      publisher.once('test', listener);

      await publisher.emit('test', 'data');

      expect(publisher.listenerCount('test')).toBe(0);
    });
  });

  describe('unsubscribe', () => {
    it('should remove subscription when unsubscribe function is called', async () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      const unsubscribe1 = publisher.on('test', listener1);
      publisher.on('test', listener2);

      unsubscribe1();

      await publisher.emit('test', 'data');

      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple unsubscribe calls', async () => {
      const listener = vi.fn();
      const unsubscribe = publisher.on('test', listener);

      unsubscribe();
      unsubscribe(); // Should not throw

      await publisher.emit('test');

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('off', () => {
    it('should remove all subscribers for an event', () => {
      publisher.on('test', vi.fn());
      publisher.on('test', vi.fn());

      expect(publisher.listenerCount('test')).toBe(2);

      publisher.off('test');

      expect(publisher.listenerCount('test')).toBe(0);
    });

    it('should not notify after off', async () => {
      const listener = vi.fn();
      publisher.on('test', listener);
      publisher.off('test');

      await publisher.emit('test');

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('dispose', () => {
    it('should clear all subscriptions', () => {
      publisher.on('event1', vi.fn());
      publisher.on('event2', vi.fn());
      publisher.on('event3', vi.fn());

      publisher.dispose();

      expect(publisher.listenerCount('event1')).toBe(0);
      expect(publisher.listenerCount('event2')).toBe(0);
      expect(publisher.listenerCount('event3')).toBe(0);
    });
  });

  describe('listenerCount', () => {
    it('should return subscriber count', () => {
      expect(publisher.listenerCount('test')).toBe(0);

      publisher.on('test', vi.fn());
      expect(publisher.listenerCount('test')).toBe(1);

      publisher.on('test', vi.fn());
      expect(publisher.listenerCount('test')).toBe(2);
    });
  });

  describe('hasListeners', () => {
    it('should return true when there are subscribers', () => {
      publisher.on('test', vi.fn());
      expect(publisher.hasListeners('test')).toBe(true);
    });

    it('should return false when there are no subscribers', () => {
      expect(publisher.hasListeners('test')).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should continue notifying other listeners if one throws', async () => {
      const errorListener = vi.fn(() => {
        throw new Error('Test error');
      });
      const normalListener = vi.fn();

      publisher.on('test', errorListener);
      publisher.on('test', normalListener);

      await publisher.emit('test', 'data');

      expect(normalListener).toHaveBeenCalledTimes(1);
    });

    it('should remove one-time listener even if it throws', async () => {
      const errorListener = vi.fn(() => {
        throw new Error('Test error');
      });
      publisher.once('test', errorListener);

      await publisher.emit('test', 'data');

      expect(publisher.listenerCount('test')).toBe(0);
    });
  });
});

describe('globalEventPublisher', () => {
  it('should be a singleton instance', () => {
    expect(globalEventPublisher).toBeInstanceOf(EventPublisher);
  });
});
