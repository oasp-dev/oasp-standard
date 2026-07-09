import type { PrincipalRef } from '@oasp/schemas';

/** Builds a `PrincipalRef` for test scenarios, with sensible defaults overridable per call — never a shared fixture instance. */
export function principalRefFactory(overrides: Partial<PrincipalRef> = {}): PrincipalRef {
  return { kind: 'user', id: 'user_1', ...overrides };
}
