import { describe, expect, expectTypeOf, it } from 'vitest';
import { type Credential, credentialSchema } from './credential';

const validCredential = {
  resourceType: 'Credential',
  id: 'cred_1',
  provider: 'anthropic',
  vaultId: 'vault_ref_1',
  mcpServerUrl: 'https://mcp.example.com/workspace',
  scope: { level: 'workspace', id: 'workspace_1' },
  onBehalfOf: { kind: 'user', id: 'user_1' },
};

describe('credentialSchema', () => {
  it('parses a valid Credential', () => {
    expect(credentialSchema.safeParse(validCredential).success).toBe(true);
  });

  it('accepts a Credential with no onBehalfOf pin', () => {
    const { onBehalfOf: _onBehalfOf, ...withoutOnBehalfOf } = validCredential;
    expect(credentialSchema.safeParse(withoutOnBehalfOf).success).toBe(true);
  });

  it('rejects a non-URL mcpServerUrl', () => {
    const result = credentialSchema.safeParse({ ...validCredential, mcpServerUrl: 'not-a-url' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(['mcpServerUrl']);
  });

  it('infers the expected shape', () => {
    expectTypeOf<Credential>().toMatchTypeOf<{
      id: string;
      provider: 'anthropic' | 'openai' | 'google';
      mcpServerUrl: string;
    }>();
  });
});
