import { agentDefinitionSchema } from '../resources/agent-definition';
import { auditEventSchema } from '../resources/audit-event';
import { conversationSchema } from '../resources/conversation';
import { credentialSchema } from '../resources/credential';
import { deploymentSchema } from '../resources/deployment';
import { eventSchema } from '../resources/event';
import { principalSchema } from '../resources/principal';
import { sessionSchema } from '../resources/session';

/**
 * Every v0 resource's Zod schema, in the fixed order JSON Schema and
 * OpenAPI artifacts enumerate them. This is the single list the
 * generator walks — add a resource here and it picks up a JSON Schema
 * file, an OpenAPI component, and drift-test coverage automatically.
 *
 * Each schema is registered with `.meta({ id })`; that id (read via
 * `getSchemaId`) is the resource's PascalCase name, reused verbatim
 * for both its JSON Schema `$id` and its OpenAPI
 * `components.schemas` key.
 */
export const RESOURCE_SCHEMAS = [
  agentDefinitionSchema,
  deploymentSchema,
  conversationSchema,
  sessionSchema,
  eventSchema,
  principalSchema,
  credentialSchema,
  auditEventSchema,
] as const;
