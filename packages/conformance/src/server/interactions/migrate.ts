import type { Conversation } from '@oasp/schemas';
import type { AgentProvider } from '../../adapter/agent-provider.types';
import type { Clock } from '../../shared/clock.types';
import type { DomainError } from '../../shared/domain-error.types';
import { err, ok, type Result } from '../../shared/result';
import type { AuthenticatedActor } from '../auth/authenticated-actor.types';
import { authorize } from '../auth/authorize';
import { buildAuditEvidence } from '../audit/build-audit-evidence';
import { buildAuditWho } from '../audit/build-audit-who';
import { emitAuditEvent } from '../audit/emit-audit-event';
import { withConversationLock } from '../conversation-lock';
import { resolveVaultIds } from '../credential/resolve-vault-ids';
import { serverErrors } from '../server-errors';
import { getAgentDefinitionVersion } from '../store/agent-definition-version-store';
import type { ServerState } from '../store/server-state';
import { resolveTargetVersion } from '../target-version/resolve-target-version';
import type { ToolExecutor } from '../tool-executor.types';
import { runDrainToIdle } from './run-drain-to-idle';

/**
 * `migrate` — `docs/spec/interactions.md` § `migrate (session upgrade)`.
 * The crown-jewel interaction: mint a session at the target version,
 * seed its transcript, drain it to idle, then atomically swap it in.
 *
 * **Resolved (was flagged for the dev lead's sign-off; closed by issue
 * #10): vaultIds re-resolution source.** Stage 1 re-resolves `vaultIds`
 * against "the target version's `mcp` tool grants." Before issue #10,
 * the S0 schemas snapshotted no `AgentDefinition`'s tool grants per
 * historical version — only the *current* `tools` array existed — so
 * this re-resolved against the current `AgentDefinition.tools`, which
 * only happened to be correct when the target version *was* the
 * current draft/published content, and would silently resolve the
 * WRONG grants for any migrate where a later draft edit had since
 * changed `tools`. This now re-resolves against `target`'s immutable
 * `AgentDefinitionVersion` snapshot (`versionSnapshot` below,
 * `store/agent-definition-version-store.ts`) instead — correct
 * regardless of what the live `AgentDefinition` has been edited to
 * since `target` was minted.
 *
 * **Interpretation, flagged for the dev lead's sign-off (internal
 * drain is not separately audited):** Stage 3 runs `drain`'s normative
 * recovery logic (`runDrainToIdle`) against the newly minted session,
 * but this implementation does **not** emit a second `what: 'drain'`
 * AuditEvent for it — only the top-level `what: 'migrate'` event is
 * emitted for one client-facing `migrate` call. This mirrors how
 * `drain`'s own internal `sendToolResult` calls are not separately
 * audited as `what: 'sendToolResult'` events (`docs/spec/interactions.md`
 * § `sendToolResult`: "the same primitive `drain` uses internally... A
 * client posting a tool result directly, and `drain` posting one on a
 * client's behalf, are the same operation from the server's point of
 * view" — read here as: internal primitive use by a MUST-run
 * sub-step is not itself a separately-audited client-facing
 * invocation). A stricter reading of "MUST emit... for every
 * invocation of each of the seven interactions" could conclude the
 * opposite; this is a genuine ambiguity the spec text does not close.
 *
 * **Not-found preconditions (issue #11):** both `conversationNotFound`
 * checks below — before `withConversationLock` is even entered, and
 * again just inside it (a defensive re-check; nothing in v0 deletes a
 * `Conversation` between the two, so the second is unreachable through
 * this reference server's own public contract, but is not provably so
 * for a third-party implementation) — now emit an `AuditEvent` with
 * `outcome: 'not_found'` before returning, instead of returning
 * silently. `scope` is omitted on both: no `Conversation` was ever
 * identified to source one from. See `docs/spec/audit.md` § Not-found
 * preconditions.
 */
export async function migrateInteraction(
  state: ServerState,
  provider: AgentProvider,
  toolExecutor: ToolExecutor,
  clock: Clock,
  conversationId: string,
  actor: AuthenticatedActor,
): Promise<Result<Conversation, DomainError>> {
  if (!state.conversations.has(conversationId)) {
    emitAuditEvent(state, clock, { who: buildAuditWho(state, actor), what: 'migrate', outcome: 'not_found', refs: { conversationId } });
    return err(serverErrors.conversationNotFound(conversationId));
  }

  return withConversationLock(state, conversationId, async () => {
    const conversation = state.conversations.get(conversationId);
    if (!conversation) {
      emitAuditEvent(state, clock, { who: buildAuditWho(state, actor), what: 'migrate', outcome: 'not_found', refs: { conversationId } });
      return err(serverErrors.conversationNotFound(conversationId));
    }

    // Issue #7 Tranche A: authorize before any of the four migrate stages
    // run — a rejected actor never mints a new Session, never touches the
    // provider, and never advances the lineage.
    const authorization = authorize(actor, conversation.scope);
    if (!authorization.ok) {
      emitAuditEvent(state, clock, {
        who: buildAuditWho(state, actor),
        what: 'migrate',
        scope: conversation.scope,
        outcome: 'failure',
        refs: { conversationId, sessionId: conversation.currentSessionId },
      });
      return err(authorization.error);
    }

    const definition = state.agentDefinitions.get(conversation.pinnedAgentVersion.agentDefinitionId);
    if (!definition) {
      throw new Error(`Invariant violated: conversation "${conversationId}" is pinned to an unknown AgentDefinition.`);
    }

    const noOp = (): Result<Conversation, DomainError> => {
      emitAuditEvent(state, clock, {
        who: buildAuditWho(state, actor),
        what: 'migrate',
        scope: conversation.scope,
        outcome: 'success',
        refs: { conversationId, sessionId: conversation.currentSessionId },
        evidence: buildAuditEvidence({ agentVersionRef: conversation.pinnedAgentVersion }),
      });
      return ok(conversation);
    };

    // Preconditions: "leave in place" (never-published definition) and
    // "already at target" both resolve as successful no-ops, never errors.
    const target = resolveTargetVersion('real', definition);
    if (target === null) return noOp();
    if (target.version === conversation.pinnedAgentVersion.version) return noOp();

    const outgoingSessionId = conversation.currentSessionId;
    const outgoingSession = state.sessions.get(outgoingSessionId);
    if (!outgoingSession) {
      throw new Error(`Invariant violated: conversation "${conversationId}"'s currentSessionId "${outgoingSessionId}" has no Session record.`);
    }

    const deployment = state.deployments.get(definition.id);
    if (!deployment) {
      emitAuditEvent(state, clock, {
        who: buildAuditWho(state, actor),
        what: 'migrate',
        scope: conversation.scope,
        outcome: 'failure',
        refs: { conversationId, sessionId: outgoingSessionId },
        evidence: buildAuditEvidence({ agentVersionRef: target }),
      });
      return err(serverErrors.notDeployed(definition.id));
    }

    // The target version's immutable content snapshot (issue #10) — every
    // version number `resolveTargetVersion` can ever produce was already
    // frozen the instant it was minted (`createAgentDefinitionSetup` /
    // `editAgentDefinitionDraftSetup`), so this should never be missing;
    // treated as an invariant violation, not a legitimate failure outcome,
    // if it somehow is.
    const versionSnapshot = getAgentDefinitionVersion(state, target);
    if (!versionSnapshot) {
      throw new Error(`Invariant violated: AgentDefinition "${definition.id}" version ${target.version} has no recorded content snapshot.`);
    }

    // Stage 1 — mint session at target version. Resources re-attached fresh
    // (new array + new object per entry, never aliased); vaultIds re-resolved
    // against the target version's immutable content snapshot, never copied
    // from outgoing and never read off the live, still-editable
    // `AgentDefinition` (issue #10).
    const resources = outgoingSession.resources.map((resource) => ({ ...resource }));
    const vaultIds = resolveVaultIds(versionSnapshot, state.credentials);

    // Stage 2 — transcript-seed. Degrade to an empty seed on fetch failure;
    // migrate MUST NOT fail because of it. The seed is always the literal,
    // freshly-fetched transcript, re-stamped once by the adapter into the new
    // session's id space (see adapter/create-session-options.types.ts's `seed`
    // and docs/spec/adapters.md's `seed` transport section) — never wrapped in
    // additional marker structure, which is what keeps repeated migrations
    // non-compounding in this implementation (see the mock provider's
    // `reseedTranscript`, and the migrate conformance check that drives several
    // migrates in a row and asserts the seeded event count stays constant).
    //
    // `degraded` records whether this fallback fired, so the Stage-4 success
    // emission below can make it distinguishable from a normal migrate in the
    // audit trail — docs/spec/interactions.md § Degrade-to-fresh-start on
    // transcript-fetch failure now requires exactly that (issue #12: a bare
    // `outcome: 'success'` alone cannot tell the two apart).
    const transcriptResult = await provider.listSessionEvents(outgoingSessionId);
    const degraded = !transcriptResult.ok;
    const seedEvents = transcriptResult.ok ? transcriptResult.value.events : [];

    const createSessionResult = await provider.createSession({
      agentDefinitionId: definition.id,
      providerAgentId: deployment.providerAgentId,
      pinnedAgentVersion: target,
      resources,
      vaultIds,
      seed: { events: seedEvents },
    });
    if (!createSessionResult.ok) {
      emitAuditEvent(state, clock, {
        who: buildAuditWho(state, actor),
        what: 'migrate',
        scope: conversation.scope,
        outcome: 'failure',
        refs: { conversationId, sessionId: outgoingSessionId },
        evidence: buildAuditEvidence({ agentVersionRef: target }),
      });
      return err(serverErrors.adapterFailure('createSession', createSessionResult.error.message));
    }

    const newSession = createSessionResult.value;
    state.sessions.set(newSession.id, newSession);
    state.sessionKind.set(newSession.id, 'real');
    state.sessionConversation.set(newSession.id, conversationId);

    // Stage 3 — drain to idle before the new session is exposed as currentSessionId.
    // `runDrainToIdle` fails for ANY non-idle terminal status (not just `'error'`), so
    // a still-`'running'` newly minted session — e.g. a chained tool call re-parking it
    // right after its enumerated pending calls resolve — is rejected here, before the
    // unconditional Stage-4 swap below ever runs. `versionSnapshot` (already resolved
    // above, for Stage 1's vaultIds re-resolution) is reused here too, so a pending tool
    // call carried onto the newly minted session is authorized against the SAME target
    // version's grants (issue #9) — from its immutable snapshot, not the live
    // `AgentDefinition` (issue #10), so a draft edit racing this migrate can't change
    // what the newly minted session is authorized against mid-flight.
    const drainResult = await runDrainToIdle(provider, toolExecutor, versionSnapshot, newSession.id);
    if (!drainResult.ok) {
      // The new Session — and its vaultIds — genuinely exist at this point
      // (createSession above already succeeded); only drain failed
      // afterward. refs.credentialIds therefore still names what was
      // actually re-attached, unlike the createSession-failure branch
      // above, where no Session (and so no attachment) exists at all.
      emitAuditEvent(state, clock, {
        who: buildAuditWho(state, actor),
        what: 'migrate',
        scope: conversation.scope,
        outcome: 'failure',
        refs: { conversationId, sessionId: newSession.id, credentialIds: [...vaultIds] },
        evidence: buildAuditEvidence({ agentVersionRef: target }),
      });
      return err(drainResult.error);
    }

    // Stage 4 — atomic swap + lineage append (readers never observe an
    // intermediate state: this Map.set is the single point external reads go
    // through, and everything above ran before it).
    const updatedConversation: Conversation = {
      ...conversation,
      currentSessionId: newSession.id,
      previousSessionIds: [...conversation.previousSessionIds, outgoingSessionId],
      pinnedAgentVersion: target,
    };
    state.conversations.set(conversationId, updatedConversation);

    // refs.credentialIds names which Credentials were re-attached at Stage 1
    // — docs/spec/audit.md § Credential attachment is audited
    // (`createConversation` and `migrate`): the migrate case previously
    // recorded THAT credentials were re-attached (an emission point
    // existed); this now also names WHICH.
    //
    // `degraded` names WHETHER Stage 2's transcript fetch failed and this
    // migrate proceeded with an empty seed instead of the outgoing Session's
    // real transcript — docs/spec/interactions.md § Degrade-to-fresh-start on
    // transcript-fetch failure. Set only when `true`; omitted (never `false`)
    // on a normal, full-seed migrate, per the schema's absence-is-the-sentinel
    // convention (see audit-event.ts's `degraded` field doc comment).
    emitAuditEvent(state, clock, {
      who: buildAuditWho(state, actor),
      what: 'migrate',
      scope: updatedConversation.scope,
      outcome: 'success',
      refs: { conversationId, sessionId: newSession.id, credentialIds: [...vaultIds] },
      degraded,
      evidence: buildAuditEvidence({ agentVersionRef: target }),
    });

    return ok(updatedConversation);
  });
}
