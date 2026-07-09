import { agentDefinitionSchema } from '../resources/agent-definition';
import { conversationSchema } from '../resources/conversation';
import { eventSchema } from '../resources/event';
import { getSchemaId } from './get-schema-id';
import type { JsonObject } from './json-object.types';
import { sessionSchema } from '../resources/session';

function componentRef(schema: Parameters<typeof getSchemaId>[0]): JsonObject {
  return { $ref: `#/components/schemas/${getSchemaId(schema)}` };
}

function idPathParam(description: string): JsonObject {
  return { name: 'id', in: 'path', required: true, description, schema: { type: 'string' } };
}

/**
 * A minimal, explicitly-placeholder `paths` object covering the seven
 * v0 interactions (`publish`, `createConversation`, `migrate`, `drain`,
 * `stream`, `send`, `sendToolResult`) named in the concept draft's
 * Interactions table, as extended by `createConversation`
 * (`docs/spec/interactions.md` § `createConversation`, Issue #5 / S4).
 *
 * Full request/response contracts for these interactions are Issue
 * #2 (S1)'s scope, not this bootstrap issue's — each operation here
 * exists only so the OpenAPI document has *some* paths alongside its
 * component schemas, per the issue's "a minimal set of paths … is
 * acceptable but the resource components are the core deliverable."
 *
 * @see docs/oasp-v0-concept.md § Interactions (v0)
 */
export const INTERACTION_PATHS: JsonObject = {
  '/agent-definitions/{id}/publish': {
    post: {
      operationId: 'publishAgentDefinition',
      summary: 'publish — snap published_version forward to the current draft head. Placeholder; full contract is Issue #2 (S1).',
      parameters: [idPathParam('Identifier of the AgentDefinition to publish.')],
      responses: {
        '200': {
          description: 'The AgentDefinition with published_version advanced.',
          content: { 'application/json': { schema: componentRef(agentDefinitionSchema) } },
        },
      },
    },
  },
  '/conversations': {
    post: {
      operationId: 'createConversation',
      summary: 'createConversation — mint the first Session for a new Conversation: mount resources, resolve+attach vaultIds, pin to publishedVersion. Placeholder; full contract is docs/spec/interactions.md § createConversation (Issue #5 / S4).',
      responses: {
        '201': {
          description: 'The newly created Conversation, riding on its freshly minted initial Session.',
          content: { 'application/json': { schema: componentRef(conversationSchema) } },
        },
      },
    },
  },
  '/conversations/{id}/migrate': {
    post: {
      operationId: 'migrateConversation',
      summary: 'migrate — session upgrade: mint a session at a target agent version and swap it in. Placeholder; full contract is Issue #2 (S1).',
      parameters: [idPathParam('Identifier of the Conversation to migrate.')],
      responses: {
        '200': {
          description: 'The Conversation, now riding on the newly minted session.',
          content: { 'application/json': { schema: componentRef(conversationSchema) } },
        },
      },
    },
  },
  '/sessions/{id}/drain': {
    post: {
      operationId: 'drainSession',
      summary: 'drain — recover a session parked on pending tool calls. Placeholder; full contract is Issue #2 (S1).',
      parameters: [idPathParam('Identifier of the Session to drain.')],
      responses: {
        '200': {
          description: 'The Session, returned to idle.',
          content: { 'application/json': { schema: componentRef(sessionSchema) } },
        },
      },
    },
  },
  '/sessions/{id}/events': {
    get: {
      operationId: 'streamSessionEvents',
      summary: 'stream — SSE of normalised events until idle/unrecoverable. Placeholder; full contract is Issue #2 (S1).',
      parameters: [idPathParam('Identifier of the Session to stream events from.')],
      responses: {
        '200': {
          description: 'A stream of normalised session events.',
          content: { 'text/event-stream': { schema: { type: 'array', items: componentRef(eventSchema) } } },
        },
      },
    },
  },
  '/sessions/{id}/messages': {
    post: {
      operationId: 'sendMessage',
      summary: 'send — post a message to the session. Placeholder; full contract is Issue #2 (S1).',
      parameters: [idPathParam('Identifier of the Session to send the message to.')],
      responses: {
        '202': { description: 'The message was accepted for processing.' },
      },
    },
  },
  '/sessions/{id}/tool-results': {
    post: {
      operationId: 'sendToolResult',
      summary: 'sendToolResult — post a custom tool result to the session. Placeholder; full contract is Issue #2 (S1).',
      parameters: [idPathParam('Identifier of the Session to post the tool result to.')],
      responses: {
        '202': { description: 'The tool result was accepted for processing.' },
      },
    },
  },
};
