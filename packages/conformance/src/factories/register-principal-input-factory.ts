import type { RegisterPrincipalInput } from '../server/setup/register-principal-input.types';
import { scopeFactory } from './scope-factory';

/**
 * Builds a `RegisterPrincipalInput` for test scenarios, with sensible
 * defaults overridable per call — never a shared fixture instance.
 * `scopeMemberships` defaults to exactly `[scopeFactory()]` so a
 * principal registered with no overrides is, by default, authorized
 * (`auth/authorize.ts`) against every other factory's default `scope`
 * (`scopeFactory()`, `agentDefinitionInputFactory()`,
 * `createConversationInputFactory()` all share that same default) —
 * existing scenarios that don't care about authorization keep passing
 * without each one having to wire up a matching membership by hand.
 */
export function registerPrincipalInputFactory(overrides: Partial<RegisterPrincipalInput> = {}): RegisterPrincipalInput {
  return {
    kind: 'user',
    subject: 'user_1',
    scopeMemberships: [scopeFactory()],
    roles: [],
    ...overrides,
  };
}
