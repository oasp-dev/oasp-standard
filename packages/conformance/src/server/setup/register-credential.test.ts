import { credentialSchema } from '@oasp/schemas';
import { describe, expect, it } from 'vitest';
import { registerCredentialInputFactory } from '../../factories/register-credential-input-factory';
import { testHarnessFactory } from '../../factories/test-harness-factory';

describe('registerCredentialSetup (via ReferenceServer.registerCredential)', () => {
  it('registers a schema-valid Credential', () => {
    const { server } = testHarnessFactory();
    const credential = server.registerCredential(registerCredentialInputFactory());
    expect(credentialSchema.safeParse(credential).success).toBe(true);
  });

  it('assigns distinct ids across successive calls', () => {
    const { server } = testHarnessFactory();
    const first = server.registerCredential(registerCredentialInputFactory());
    const second = server.registerCredential(registerCredentialInputFactory());
    expect(first.id).not.toBe(second.id);
  });
});
