import { describe, expect, expectTypeOf, it } from 'vitest';
import { type Conversation, conversationSchema } from './conversation';

const validConversation = {
  id: 'conv_1',
  scope: { level: 'workspace', id: 'workspace_1' },
  initiatingPrincipal: { kind: 'user', id: 'user_1' },
  currentSessionId: 'sess_2',
  pinnedAgentVersion: { agentDefinitionId: 'agentdef_1', version: 4 },
  previousSessionIds: ['sess_0', 'sess_1'],
};

describe('conversationSchema', () => {
  it('parses a valid Conversation', () => {
    expect(conversationSchema.safeParse(validConversation).success).toBe(true);
  });

  it('accepts an empty session lineage for a brand-new Conversation', () => {
    expect(conversationSchema.safeParse({ ...validConversation, previousSessionIds: [] }).success).toBe(true);
  });

  it('rejects an initiatingPrincipal with an invalid kind', () => {
    const result = conversationSchema.safeParse({
      ...validConversation,
      initiatingPrincipal: { kind: 'robot', id: 'user_1' },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(['initiatingPrincipal', 'kind']);
  });

  it('infers the expected shape', () => {
    expectTypeOf<Conversation>().toMatchTypeOf<{
      id: string;
      currentSessionId: string;
      previousSessionIds: string[];
    }>();
  });
});
