import type { AgentDefinition, Credential, Scope } from '@oasp/schemas';
import type { AuthenticatedActor } from '../auth/authenticated-actor.types';

/**
 * Input to {@link import('./resolve-credential-bindings').resolveCredentialBindings}
 * — the complete security context a `Credential` binding must be
 * checked against (issue #8). Every field here is something the
 * PRE-#8 `resolveVaultIds` either ignored (`effectiveScope`, `actor`)
 * or never received as a distinct concept at all (`definitionVersion`
 * carried only `tools`, never `provider`).
 */
export interface ResolveCredentialBindingsInput {
  /**
   * The pinned `AgentDefinition` version's own tool grants and
   * provider — always an immutable per-version snapshot at every real
   * call site (`docs/spec/interactions.md` § Stage 1, issue #10), never
   * the live, still-editable `AgentDefinition`. `provider` is read from
   * here (not from a per-grant field — `mcpToolSchema` has none) because
   * v0 has exactly one `provider` per `AgentDefinition`/version: every
   * MCP grant under it runs under that same provider, so this is the
   * only provider "in effect" a grant can be checked against with the
   * context resolution actually has today.
   */
  readonly definitionVersion: Pick<AgentDefinition, 'tools' | 'provider'>;
  /** Every `Credential` currently registered on the server, keyed by id. */
  readonly credentials: ReadonlyMap<string, Credential>;
  /**
   * The scope this interaction actually resolves within: the
   * Conversation's own validated `scope` at `createConversation`/
   * `migrate`, or — for an unbound builder/test session, which has no
   * Conversation to source one from — the pinned `AgentDefinition`'s
   * own `scope` (mirroring `docs/spec/audit.md` § Scope provenance's
   * fallback row for the same session shape). A `Credential` is only
   * ever eligible when its own `scope` equals this value exactly
   * (`scopes-equal.ts`) — never a nesting/containment check.
   */
  readonly effectiveScope: Scope;
  /**
   * The actor this interaction is running as, when one exists.
   * Undefined only at the builder/test-session call site
   * (`create-unbound-session.ts`), which — like the rest of issue #7
   * Tranche A — has no `AuthenticatedActor` threaded to it; that call
   * site can therefore never be "delegated," and a `Credential` scoped
   * with `onBehalfOf` set can never attach there (see the resolver's
   * doc comment for why that is the correct, not merely incidental,
   * outcome).
   */
  readonly actor?: AuthenticatedActor;
}
