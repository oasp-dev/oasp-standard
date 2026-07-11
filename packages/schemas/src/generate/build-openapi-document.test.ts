import { describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from './build-openapi-document';

describe('buildOpenApiDocument', () => {
  it('targets OpenAPI 3.1 and names the v1alpha1 draft stage', () => {
    const doc = buildOpenApiDocument();
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.version).toBe('v1alpha1');
  });

  it('registers a component for every v0 resource', () => {
    const doc = buildOpenApiDocument();
    for (const name of [
      'AgentDefinition',
      'AgentDefinitionVersion',
      'Deployment',
      'Conversation',
      'Session',
      'Event',
      'Principal',
      'Credential',
      'AuditEvent',
    ]) {
      expect(doc.components.schemas).toHaveProperty(name);
    }
  });

  it('de-duplicates shared sub-schemas into single top-level components, $ref-ed rather than inlined', () => {
    const doc = buildOpenApiDocument();

    // Scope is used by AgentDefinition, Conversation, Principal, Credential, and AuditEvent —
    // it must appear exactly once, as its own component.
    expect(doc.components.schemas).toHaveProperty('Scope');
    expect(doc.components.schemas).toHaveProperty('Provider');
    expect(doc.components.schemas).toHaveProperty('PrincipalRef');
    expect(doc.components.schemas).toHaveProperty('PrincipalKind');
    expect(doc.components.schemas).toHaveProperty('AgentVersionRef');

    const agentDefinition = doc.components.schemas['AgentDefinition'];
    expect(agentDefinition).toBeDefined();
    const serialized = JSON.stringify(agentDefinition);
    // A resource's own component body should reference shared schemas by
    // pointer, not re-embed their full body.
    expect(serialized).toContain('#/components/schemas/Scope');
    expect(serialized).not.toContain('#/$defs/');
  });

  it('includes a path for every v0 interaction named in the concept draft', () => {
    const doc = buildOpenApiDocument();
    for (const p of [
      '/agent-definitions/{id}/publish',
      '/conversations/{id}/migrate',
      '/sessions/{id}/drain',
      '/sessions/{id}/events',
      '/sessions/{id}/messages',
      '/sessions/{id}/tool-results',
    ]) {
      expect(doc.paths).toHaveProperty(p);
    }
  });

  it('is deterministic: components.schemas key order is stable across calls', () => {
    const first = Object.keys(buildOpenApiDocument().components.schemas);
    const second = Object.keys(buildOpenApiDocument().components.schemas);
    expect(second).toEqual(first);
  });
});
