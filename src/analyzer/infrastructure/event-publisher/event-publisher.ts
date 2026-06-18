/**
 * Event Publisher Module
 *
 * Provides a publish-subscribe event system for decoupled communication.
 * Foundation layer - VS Code agnostic.
 */

/**
 * Event listener function
 */
export type EventListener<T = unknown> = (data: T) => void | Promise<void>;

/**
 * Event subscription with metadata
 */
interface EventSubscription<T> {
  listener: EventListener<T>;
  once: boolean;
  id: string;
}

/**
 * Generic event publisher for pub-sub communication
 */
export class EventPublisher {
  private events: Map<string, EventSubscription<unknown>[]> = new Map();
  private nextId = 0;

  /**
   * Subscribe to an event
   */
  on<T = unknown>(event: string, listener: EventListener<T>): () => void {
    return this.addSubscription(event, listener, false);
  }

  /**
   * Subscribe to an event for one-time execution
   */
  once<T = unknown>(event: string, listener: EventListener<T>): () => void {
    return this.addSubscription(event, listener, true);
  }

  /**
   * Publish an event to all subscribers
   */
  async emit<T = unknown>(event: string, data?: T): Promise<void> {
    const subscriptions = this.events.get(event) || [];
    const remaining: EventSubscription<unknown>[] = [];

    for (const subscription of subscriptions) {
      try {
        await subscription.listener(data);

        if (subscription.once) {
          // Remove one-time listener
          continue;
        }

        remaining.push(subscription);
      } catch (error) {
        // Log error but continue notifying other listeners
        console.error(`Error in event listener for "${event}":`, error);
      }
    }

    this.events.set(event, remaining);
  }

  /**
   * Remove all subscribers for an event
   */
  off(event: string): void {
    this.events.delete(event);
  }

  /**
   * Remove all subscriptions (cleanup)
   */
  dispose(): void {
    this.events.clear();
  }

  /**
   * Get subscriber count for an event
   */
  listenerCount(event: string): number {
    return (this.events.get(event) || []).length;
  }

  /**
   * Check if there are any subscribers for an event
   */
  hasListeners(event: string): boolean {
    return this.listenerCount(event) > 0;
  }

  private addSubscription<T>(
    event: string,
    listener: EventListener<T>,
    once: boolean
  ): () => void {
    const id = `sub_${this.nextId++}`;
    const subscription: EventSubscription<T> = { listener, once, id };

    if (!this.events.has(event)) {
      this.events.set(event, []);
    }

    this.events.get(event)!.push(subscription as EventSubscription<unknown>);

    // Return unsubscribe function
    return () => {
      const subscriptions = this.events.get(event);
      if (subscriptions) {
        const index = subscriptions.findIndex(s => s.id === id);
        if (index !== -1) {
          subscriptions.splice(index, 1);
        }
      }
    };
  }
}

/**
 * Global event publisher instance
 */
export const globalEventPublisher = new EventPublisher();
