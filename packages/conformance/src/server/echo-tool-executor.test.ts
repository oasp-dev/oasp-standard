import { describe, expect, it } from 'vitest';
import { createEchoToolExecutor } from './echo-tool-executor';

describe('createEchoToolExecutor', () => {
  it('echoes back the tool name and input, always succeeding', async () => {
    const executor = createEchoToolExecutor();
    const result = await executor.execute({ toolUseId: 'tooluse_1', name: 'lookup', input: { query: 'x' } });
    expect(result).toEqual({ ok: true, value: { tool: 'lookup', echoedInput: { query: 'x' } } });
  });
});
