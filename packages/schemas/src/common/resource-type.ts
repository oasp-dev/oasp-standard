import { z } from 'zod';

/**
 * Builds the FHIR-style `resourceType` discriminator every OASP
 * *resource* carries as the first property of its schema — never a
 * datatype: `Scope`, `PrincipalRef`, `PrincipalKind`,
 * `AgentVersionRef`, `AgentDefinitionContent`, and `Provider` are all
 * values that only ever appear embedded inside a resource, so none of
 * them call this helper.
 *
 * `name` **MUST** be exactly the resource's own registered
 * `.meta({ id })` value (e.g. `resourceType('Conversation')` inside
 * `conversationSchema`, whose `.meta({ id: 'Conversation' })` matches)
 * — the two are meant to be read together, and
 * `resource-type-guard.test.ts` in `src/generate/` enforces they never
 * drift apart. A single, shared literal-builder keeps every resource's
 * discriminator declared identically instead of eight/nine hand-rolled
 * `z.literal(...)` calls.
 *
 * @see docs/spec/resources.md
 * @see docs/proposals/0001-resource-type-discriminator.md
 */
export function resourceType<const Name extends string>(name: Name) {
  return z.literal(name).describe('FHIR-style discriminator naming this resource type; MUST equal the resource type name.');
}
