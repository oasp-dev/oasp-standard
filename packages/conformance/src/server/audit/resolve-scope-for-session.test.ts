import { describe, expect, it } from 'vitest';
import type { AgentDefinition, Conversation, Session } from '@oasp/schemas';
import { createServerState } from '../store/server-state';
import { resolveScopeForSession } from './resolve-scope-for-session';

function buildDefinition(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    resourceType: 'AgentDefinition',
    id: 'agentdef_1',
    name: 'Test',
    instructions: 'x',
    provider: 'anthropic',
    model: 'claude-mock',
    tools: [],
    guardrails: [],
    draftVersion: 1,
    publishedVersion: 1,
    scope: { level: 'tenant', id: 'tenant_definition_scope' },
    ...overrides,
  };
}

function buildSession(overrides: Partial<Session> = {}): Session {
  return {
    resourceType: 'Session',
    id: 'session_1',
    pinnedAgentVersion: { agentDefinitionId: 'agentdef_1', version: 1 },
    resources: [],
    vaultIds: [],
    ...overrides,
  };
}

function buildConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    resourceType: 'Conversation',
    id: 'conv_1',
    scope: { level: 'workspace', id: 'workspace_conversation_scope' },
    initiatingPrincipal: { kind: 'user', id: 'user_1' },
    currentSessionId: 'session_1',
    pinnedAgentVersion: { agentDefinitionId: 'agentdef_1', version: 1 },
    previousSessionIds: [],
    ...overrides,
  };
}

describe('resolveScopeForSession', () => {
  it('resolves to the bound Conversation scope for a Session with a Conversation', () => {
    const state = createServerState();
    const definition = buildDefinition();
    const conversation = buildConversation();
    const session = buildSession();
    state.agentDefinitions.set(definition.id, definition);
    state.conversations.set(conversation.id, conversation);
    state.sessionConversation.set(session.id, conversation.id);

    expect(resolveScopeForSession(state, session)).toEqual({ level: 'workspace', id: 'workspace_conversation_scope' });
  });

  it('resolves to the pinned AgentDefinition scope for a Session with no Conversation (builder/test-session)', () => {
    const state = createServerState();
    const definition = buildDefinition();
    const session = buildSession();
    state.agentDefinitions.set(definition.id, definition);
    // deliberately no sessionConversation entry — this is the builder/test-session case.

    expect(resolveScopeForSession(state, session)).toEqual({ level: 'tenant', id: 'tenant_definition_scope' });
  });

  it('throws (invariant violation) if the pinned AgentDefinition cannot be found', () => {
    const state = createServerState();
    const session = buildSession({ pinnedAgentVersion: { agentDefinitionId: 'does_not_exist', version: 1 } });
    expect(() => resolveScopeForSession(state, session)).toThrow(/Invariant violated/);
  });
});
