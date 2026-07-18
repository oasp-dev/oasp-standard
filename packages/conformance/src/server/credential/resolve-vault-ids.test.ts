import { describe, expect, it } from 'vitest';
import type { AgentDefinition, Credential } from '@oasp/schemas';
import { resolveVaultIds } from './resolve-vault-ids';

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

function buildCredential(overrides: Partial<Credential> = {}): Credential {
  return {
    resourceType: 'Credential',
    id: 'credential_1',
    provider: 'anthropic',
    vaultId: 'vault_1',
    mcpServerUrl: 'https://mcp.example.com/a',
    scope: { level: 'workspace', id: 'workspace_1' },
    ...overrides,
  };
}

describe('resolveVaultIds', () => {
  it('matches an mcp/credential tool grant to a Credential by serverUrl', () => {
    const definition = buildDefinition({
      tools: [{ type: 'mcp', serverUrl: 'https://mcp.example.com/a', label: 'A', auth: 'credential', permissionPolicy: 'always_allow' }],
    });
    const credentials = new Map([['credential_1', buildCredential()]]);
    expect(resolveVaultIds(definition, credentials)).toEqual(['credential_1']);
  });

  it('skips a tool grant whose auth is "none"', () => {
    const definition = buildDefinition({
      tools: [{ type: 'mcp', serverUrl: 'https://mcp.example.com/a', label: 'A', auth: 'none', permissionPolicy: 'always_allow' }],
    });
    const credentials = new Map([['credential_1', buildCredential()]]);
    expect(resolveVaultIds(definition, credentials)).toEqual([]);
  });

  it('skips a credential-requiring grant with no matching Credential', () => {
    const definition = buildDefinition({
      tools: [{ type: 'mcp', serverUrl: 'https://mcp.example.com/unmatched', label: 'A', auth: 'credential', permissionPolicy: 'always_allow' }],
    });
    const credentials = new Map([['credential_1', buildCredential()]]);
    expect(resolveVaultIds(definition, credentials)).toEqual([]);
  });

  it('ignores non-mcp tool grants entirely', () => {
    const definition = buildDefinition({ tools: [{ type: 'builtin_toolset', toolset: 'search' }] });
    expect(resolveVaultIds(definition, new Map())).toEqual([]);
  });

  it('resolves multiple grants against multiple credentials', () => {
    const definition = buildDefinition({
      tools: [
        { type: 'mcp', serverUrl: 'https://mcp.example.com/a', label: 'A', auth: 'credential', permissionPolicy: 'always_allow' },
        { type: 'mcp', serverUrl: 'https://mcp.example.com/b', label: 'B', auth: 'credential', permissionPolicy: 'always_ask' },
      ],
    });
    const credentials = new Map([
      ['credential_1', buildCredential({ id: 'credential_1', mcpServerUrl: 'https://mcp.example.com/a' })],
      ['credential_2', buildCredential({ id: 'credential_2', mcpServerUrl: 'https://mcp.example.com/b' })],
    ]);
    expect(resolveVaultIds(definition, credentials)).toEqual(['credential_1', 'credential_2']);
  });
});
