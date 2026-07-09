import type { Scope } from '@oasp/schemas';

/** Builds a `Scope` for test scenarios, with sensible defaults overridable per call. */
export function scopeFactory(overrides: Partial<Scope> = {}): Scope {
  return { level: 'workspace', id: 'workspace_1', ...overrides };
}
