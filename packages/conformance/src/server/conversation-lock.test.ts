import { describe, expect, it } from 'vitest';
import { createServerState } from './store/server-state';
import { withConversationLock } from './conversation-lock';

describe('withConversationLock', () => {
  it('runs a single call normally', async () => {
    const state = createServerState();
    const result = await withConversationLock(state, 'conv_1', async () => 42);
    expect(result).toBe(42);
  });

  it('serializes concurrent calls on the same conversation id: no interleaving of critical sections', async () => {
    const state = createServerState();
    const order: string[] = [];

    async function criticalSection(label: string, delayMs: number): Promise<void> {
      await withConversationLock(state, 'conv_1', async () => {
        order.push(`${label}-start`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        order.push(`${label}-end`);
      });
    }

    await Promise.all([criticalSection('a', 20), criticalSection('b', 0)]);

    // 'a' acquired the lock first; 'b' must wait for 'a' to fully finish
    // before starting — never interleaved as a-start, b-start, a-end, b-end.
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });

  it('does not serialize calls on different conversation ids', async () => {
    const state = createServerState();
    const order: string[] = [];

    async function criticalSection(conversationId: string, label: string, delayMs: number): Promise<void> {
      await withConversationLock(state, conversationId, async () => {
        order.push(`${label}-start`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        order.push(`${label}-end`);
      });
    }

    await Promise.all([criticalSection('conv_a', 'a', 20), criticalSection('conv_b', 'b', 0)]);

    // Independent conversations run concurrently: 'b' (no delay) finishes
    // before 'a' (delayed) even though 'a' started first.
    expect(order).toEqual(['a-start', 'b-start', 'b-end', 'a-end']);
  });

  it('releases the lock even when the critical section throws', async () => {
    const state = createServerState();
    await expect(
      withConversationLock(state, 'conv_1', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const result = await withConversationLock(state, 'conv_1', async () => 'recovered');
    expect(result).toBe('recovered');
  });
});
