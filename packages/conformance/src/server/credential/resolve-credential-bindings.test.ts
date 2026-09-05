import type { AgentDefinition, Credential, PrincipalRef, Scope } from '@oasp/schemas';
import { describe, expect, it } from 'vitest';
import type { AuthenticatedActor } from '../auth/authenticated-actor.types';
import { resolveCredentialBindings } from './resolve-credential-bindings';

const WORKSPACE_1: Scope = { level: 'workspace', id: 'workspace_1' };
const WORKSPACE_2: Scope = { level: 'workspace', id: 'workspace_2' };
const MEMBER_A: PrincipalRef = { kind: 'user', id: 'user_a' };
const MEMBER_B: PrincipalRef = { kind: 'user', id: 'user_b' };

function buildDefinitionVersion(overrides: Partial<Pick<AgentDefinition, 'tools' | 'provider'>> = {}): Pick<AgentDefinition, 'tools' | 'provider'> {
  return {
    provider: 'anthropic',
    tools: [{ type: 'mcp', serverUrl: 'https://mcp.example.com/a', label: 'A', auth: 'credential', permissionPolicy: 'always_allow' }],
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
    scope: WORKSPACE_1,
    ...overrides,
  };
}

function buildActor(overrides: Partial<AuthenticatedActor> = {}): AuthenticatedActor {
  return {
    principalId: 'principal_1',
    subject: 'subject_1',
    scopeMemberships: [WORKSPACE_1],
    roles: [],
    authenticationMethod: 'reference',
    ...overrides,
  };
}

describe('resolveCredentialBindings', () => {
  it('attaches the single Credential that matches serverUrl, scope, and provider', () => {
    const result = resolveCredentialBindings({
      definitionVersion: buildDefinitionVersion(),
      credentials: new Map([['credential_1', buildCredential()]]),
      effectiveScope: WORKSPACE_1,
    });
    expect(result).toEqual({ ok: true, value: ['credential_1'] });
  });

  it('skips a tool grant whose auth is "none"', () => {
    const result = resolveCredentialBindings({
      definitionVersion: buildDefinitionVersion({
        tools: [{ type: 'mcp', serverUrl: 'https://mcp.example.com/a', label: 'A', auth: 'none', permissionPolicy: 'always_allow' }],
      }),
      credentials: new Map([['credential_1', buildCredential()]]),
      effectiveScope: WORKSPACE_1,
    });
    expect(result).toEqual({ ok: true, value: [] });
  });

  it('ignores non-mcp tool grants entirely', () => {
    const result = resolveCredentialBindings({
      definitionVersion: buildDefinitionVersion({ tools: [{ type: 'builtin_toolset', toolset: 'search' }] }),
      credentials: new Map(),
      effectiveScope: WORKSPACE_1,
    });
    expect(result).toEqual({ ok: true, value: [] });
  });

  it('resolves multiple grants against multiple credentials, in grant order', () => {
    const result = resolveCredentialBindings({
      definitionVersion: buildDefinitionVersion({
        tools: [
          { type: 'mcp', serverUrl: 'https://mcp.example.com/a', label: 'A', auth: 'credential', permissionPolicy: 'always_allow' },
          { type: 'mcp', serverUrl: 'https://mcp.example.com/b', label: 'B', auth: 'credential', permissionPolicy: 'always_ask' },
        ],
      }),
      credentials: new Map([
        ['credential_1', buildCredential({ id: 'credential_1', mcpServerUrl: 'https://mcp.example.com/a' })],
        ['credential_2', buildCredential({ id: 'credential_2', mcpServerUrl: 'https://mcp.example.com/b' })],
      ]),
      effectiveScope: WORKSPACE_1,
    });
    expect(result).toEqual({ ok: true, value: ['credential_1', 'credential_2'] });
  });

  // Issue #8 teeth: cross-tenant/cross-scope Credential MUST NOT attach —
  // the exact defect the pre-#8 URL-only match let through.
  it('rejects a Credential pinned to a different scope than the effective interaction scope', () => {
    const result = resolveCredentialBindings({
      definitionVersion: buildDefinitionVersion(),
      credentials: new Map([['credential_1', buildCredential({ scope: WORKSPACE_2 })]]),
      effectiveScope: WORKSPACE_1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('Server.UnresolvedCredential');
  });

  it('rejects a Credential whose provider does not match the pinned version\'s provider', () => {
    const result = resolveCredentialBindings({
      definitionVersion: buildDefinitionVersion({ provider: 'anthropic' }),
      credentials: new Map([['credential_1', buildCredential({ provider: 'openai' })]]),
      effectiveScope: WORKSPACE_1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('Server.UnresolvedCredential');
  });

  // Delegation-pin compatibility (mirrors auth/authorize.ts's containment rule):
  // a delegated actor's Credential eligibility is bounded by scopePin alone.
  it('rejects a Credential whose scope equals effectiveScope but not the delegated actor\'s scopePin', () => {
    const result = resolveCredentialBindings({
      definitionVersion: buildDefinitionVersion(),
      credentials: new Map([['credential_1', buildCredential({ scope: WORKSPACE_1 })]]),
      effectiveScope: WORKSPACE_1,
      actor: buildActor({ delegation: { onBehalfOf: MEMBER_A, scopePin: WORKSPACE_2 } }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('Server.UnresolvedCredential');
  });

  it('attaches a Credential with no onBehalfOf restriction under a delegated actor whose scopePin matches', () => {
    const result = resolveCredentialBindings({
      definitionVersion: buildDefinitionVersion(),
      credentials: new Map([['credential_1', buildCredential({ scope: WORKSPACE_1 })]]),
      effectiveScope: WORKSPACE_1,
      actor: buildActor({ delegation: { onBehalfOf: MEMBER_A, scopePin: WORKSPACE_1 } }),
    });
    expect(result).toEqual({ ok: true, value: ['credential_1'] });
  });

  // onBehalfOf compatibility.
  it('rejects a Credential restricted to onBehalfOf under an un-delegated actor', () => {
    const result = resolveCredentialBindings({
      definitionVersion: buildDefinitionVersion(),
      credentials: new Map([['credential_1', buildCredential({ scope: WORKSPACE_1, onBehalfOf: MEMBER_A })]]),
      effectiveScope: WORKSPACE_1,
      actor: buildActor(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('Server.UnresolvedCredential');
  });

  it('rejects a Credential restricted to onBehalfOf under a delegation naming a DIFFERENT delegate', () => {
    const result = resolveCredentialBindings({
      definitionVersion: buildDefinitionVersion(),
      credentials: new Map([['credential_1', buildCredential({ scope: WORKSPACE_1, onBehalfOf: MEMBER_A })]]),
      effectiveScope: WORKSPACE_1,
      actor: buildActor({ delegation: { onBehalfOf: MEMBER_B, scopePin: WORKSPACE_1 } }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('Server.UnresolvedCredential');
  });

  it('attaches a Credential restricted to onBehalfOf under a delegation naming exactly that Principal', () => {
    const result = resolveCredentialBindings({
      definitionVersion: buildDefinitionVersion(),
      credentials: new Map([['credential_1', buildCredential({ scope: WORKSPACE_1, onBehalfOf: MEMBER_A })]]),
      effectiveScope: WORKSPACE_1,
      actor: buildActor({ delegation: { onBehalfOf: MEMBER_A, scopePin: WORKSPACE_1 } }),
    });
    expect(result).toEqual({ ok: true, value: ['credential_1'] });
  });

  // Ambiguity — fail closed, never pick by insertion order.
  it('rejects with Server.AmbiguousCredentialBinding when more than one Credential is eligible for the same grant', () => {
    const result = resolveCredentialBindings({
      definitionVersion: buildDefinitionVersion(),
      credentials: new Map([
        ['credential_1', buildCredential({ id: 'credential_1' })],
        ['credential_2', buildCredential({ id: 'credential_2' })],
      ]),
      effectiveScope: WORKSPACE_1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('Server.AmbiguousCredentialBinding');
    expect(result.error.message).toContain('credential_1');
    expect(result.error.message).toContain('credential_2');
  });

  // Unresolved — fail closed, never silently skip.
  it('rejects with Server.UnresolvedCredential when an auth: "credential" grant matches no registered Credential at all', () => {
    const result = resolveCredentialBindings({
      definitionVersion: buildDefinitionVersion({
        tools: [{ type: 'mcp', serverUrl: 'https://mcp.example.com/unmatched', label: 'A', auth: 'credential', permissionPolicy: 'always_allow' }],
      }),
      credentials: new Map([['credential_1', buildCredential()]]),
      effectiveScope: WORKSPACE_1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('Server.UnresolvedCredential');
  });
});
