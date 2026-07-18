import { describe, expect, it } from 'vitest';
import type { AgentDefinition } from '@oasp/schemas';
import type { PendingToolCall } from '../../adapter/pending-tool-call.types';
import { authorizePendingToolCall } from './authorize-pending-tool-call';

function buildDefinition(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    resourceType: 'AgentDefinition',
    id: 'agentdef_1',
    name: 'Test',
    instructions: 'x',
    provider: 'anthropic',
    model: 'claude-mock',
    tools: [],
    guardrails: [],
    draftVersion: 1,
    publishedVersion: null,
    scope: { level: 'workspace', id: 'workspace_1' },
    ...overrides,
  };
}

function buildToolCall(overrides: Partial<PendingToolCall> = {}): PendingToolCall {
  return { toolUseId: 'tooluse_1', name: 'search', input: {}, ...overrides };
}

describe('authorizePendingToolCall', () => {
  it('rejects a call for a tool not present anywhere in the pinned AgentDefinition (nothing granted)', () => {
    const definition = buildDefinition({ tools: [] });
    const result = authorizePendingToolCall(definition, 'session_1', buildToolCall({ name: 'delete_everything' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('Server.UnauthorizedToolCall');
  });

  it('authorizes an exact custom-tool name match', () => {
    const definition = buildDefinition({
      tools: [{ type: 'custom', name: 'lookup', description: 'Looks something up.', inputSchema: {} }],
    });
    const result = authorizePendingToolCall(definition, 'session_1', buildToolCall({ name: 'lookup' }));
    expect(result).toEqual({ ok: true, value: undefined });
  });

  it('rejects a custom-tool call whose name does not match any granted custom tool', () => {
    const definition = buildDefinition({
      tools: [{ type: 'custom', name: 'lookup', description: 'Looks something up.', inputSchema: {} }],
    });
    const result = authorizePendingToolCall(definition, 'session_1', buildToolCall({ name: 'delete_everything' }));
    expect(result.ok).toBe(false);
  });

  it('authorizes an MCP call whose reported serverUrl matches a granted server with no toolAllowlist', () => {
    const definition = buildDefinition({
      tools: [{ type: 'mcp', serverUrl: 'https://mcp.example.com/a', label: 'A', auth: 'none', permissionPolicy: 'always_allow' }],
    });
    const result = authorizePendingToolCall(
      definition,
      'session_1',
      buildToolCall({ name: 'anything', mcpServerUrl: 'https://mcp.example.com/a' }),
    );
    expect(result).toEqual({ ok: true, value: undefined });
  });

  it('authorizes an MCP call whose name is present in the matching grant\'s toolAllowlist', () => {
    const definition = buildDefinition({
      tools: [
        {
          type: 'mcp',
          serverUrl: 'https://mcp.example.com/a',
          label: 'A',
          auth: 'none',
          permissionPolicy: 'always_allow',
          toolAllowlist: ['search'],
        },
      ],
    });
    const result = authorizePendingToolCall(definition, 'session_1', buildToolCall({ name: 'search', mcpServerUrl: 'https://mcp.example.com/a' }));
    expect(result).toEqual({ ok: true, value: undefined });
  });

  it('rejects an MCP call excluded by the matching grant\'s toolAllowlist', () => {
    const definition = buildDefinition({
      tools: [
        {
          type: 'mcp',
          serverUrl: 'https://mcp.example.com/a',
          label: 'A',
          auth: 'none',
          permissionPolicy: 'always_allow',
          toolAllowlist: ['search'],
        },
      ],
    });
    const result = authorizePendingToolCall(
      definition,
      'session_1',
      buildToolCall({ name: 'delete_repo', mcpServerUrl: 'https://mcp.example.com/a' }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('Server.UnauthorizedToolCall');
    expect(result.error.message).toContain('toolAllowlist');
  });

  it('rejects an MCP call whose reported serverUrl does not match any granted server (wrong server / spoofed origin)', () => {
    const definition = buildDefinition({
      tools: [{ type: 'mcp', serverUrl: 'https://mcp.example.com/a', label: 'A', auth: 'none', permissionPolicy: 'always_allow' }],
    });
    const result = authorizePendingToolCall(
      definition,
      'session_1',
      buildToolCall({ name: 'search', mcpServerUrl: 'https://attacker.example.com/evil' }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('Server.UnauthorizedToolCall');
    expect(result.error.message).toContain('no granted MCP server');
  });

  it('authorizes an unprovenanced call (no mcpServerUrl) when a builtin_toolset is granted — OASP does not enumerate builtin tool names', () => {
    const definition = buildDefinition({ tools: [{ type: 'builtin_toolset', toolset: 'coding' }] });
    const result = authorizePendingToolCall(definition, 'session_1', buildToolCall({ name: 'read_file' }));
    expect(result).toEqual({ ok: true, value: undefined });
  });

  it('rejects an unprovenanced call when only mcp grants exist (an mcp grant alone cannot authorize a call with no reported server origin)', () => {
    const definition = buildDefinition({
      tools: [{ type: 'mcp', serverUrl: 'https://mcp.example.com/a', label: 'A', auth: 'none', permissionPolicy: 'always_allow' }],
    });
    const result = authorizePendingToolCall(definition, 'session_1', buildToolCall({ name: 'search' }));
    expect(result.ok).toBe(false);
  });

  it('rejects a call reporting a spoofed mcpServerUrl even when its name collides with a granted custom tool of the same name (mcpServerUrl is checked before any name-only match)', () => {
    const definition = buildDefinition({
      tools: [
        { type: 'custom', name: 'lookup', description: 'Looks something up.', inputSchema: {} },
        { type: 'mcp', serverUrl: 'https://mcp.example.com/a', label: 'A', auth: 'none', permissionPolicy: 'always_allow' },
      ],
    });
    const result = authorizePendingToolCall(
      definition,
      'session_1',
      buildToolCall({ name: 'lookup', mcpServerUrl: 'https://attacker.example.com/evil' }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('no granted MCP server');
  });
});
