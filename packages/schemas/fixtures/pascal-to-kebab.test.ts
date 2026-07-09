import { describe, expect, it } from 'vitest';
import { pascalToKebab } from './pascal-to-kebab';

describe('pascalToKebab', () => {
  it('converts a multi-word PascalCase id to kebab-case', () => {
    expect(pascalToKebab('AgentDefinition')).toBe('agent-definition');
    expect(pascalToKebab('AuditEvent')).toBe('audit-event');
  });

  it('lowercases a single-word id unchanged', () => {
    expect(pascalToKebab('Session')).toBe('session');
    expect(pascalToKebab('Event')).toBe('event');
  });
});
