/**
 * Public barrel for OASP's v0 resource schemas. Each resource's Zod
 * schema is the single source of truth — JSON Schema and OpenAPI are
 * generated from these, never hand-maintained (see `src/generate/`).
 */
export { agentDefinitionSchema, type AgentDefinition } from './agent-definition';
export { deploymentSchema, type Deployment } from './deployment';
export { conversationSchema, type Conversation } from './conversation';
export { sessionSchema, type Session } from './session';
export { eventSchema, type Event } from './event';
export { principalSchema, type Principal } from './principal';
export { credentialSchema, type Credential } from './credential';
export { auditEventSchema, type AuditEvent } from './audit-event';
