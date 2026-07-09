import { describe, expect, expectTypeOf, it } from 'vitest';
import { type Deployment, deploymentSchema } from './deployment';

const validDeployment = {
  id: 'deploy_1',
  agentDefinitionId: 'agentdef_1',
  provider: 'anthropic',
  providerAgentId: 'agent_abc123',
  environmentId: 'env_production',
  providerVersion: '2026-05-01',
  canonicalHash: 'sha256:abc123',
};

describe('deploymentSchema', () => {
  it('parses a valid Deployment', () => {
    expect(deploymentSchema.safeParse(validDeployment).success).toBe(true);
  });

  it('rejects a missing canonicalHash (the idempotency key)', () => {
    const { canonicalHash: _canonicalHash, ...withoutHash } = validDeployment;
    const result = deploymentSchema.safeParse(withoutHash);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(['canonicalHash']);
  });

  it('infers the expected shape', () => {
    expectTypeOf<Deployment>().toEqualTypeOf<{
      id: string;
      agentDefinitionId: string;
      provider: 'anthropic' | 'openai' | 'google';
      providerAgentId: string;
      environmentId: string;
      providerVersion: string;
      canonicalHash: string;
    }>();
  });
});
