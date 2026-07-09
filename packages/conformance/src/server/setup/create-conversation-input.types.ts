import type { PrincipalRef, Scope, Session } from '@oasp/schemas';

/** Input to {@link import('./create-conversation').createConversationSetup}. */
export interface CreateConversationInput {
  readonly agentDefinitionId: string;
  readonly scope: Scope;
  readonly initiatingPrincipal: PrincipalRef;
  readonly resources?: Session['resources'];
}
