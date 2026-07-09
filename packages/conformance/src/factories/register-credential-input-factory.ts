import type { RegisterCredentialInput } from '../server/setup/register-credential-input.types';
import { scopeFactory } from './scope-factory';

/** Builds a `RegisterCredentialInput` for test scenarios, with sensible defaults overridable per call. */
export function registerCredentialInputFactory(overrides: Partial<RegisterCredentialInput> = {}): RegisterCredentialInput {
  return {
    provider: 'anthropic',
    vaultId: 'vault_1',
    mcpServerUrl: 'https://mcp.example.com/server',
    scope: scopeFactory(),
    ...overrides,
  };
}
