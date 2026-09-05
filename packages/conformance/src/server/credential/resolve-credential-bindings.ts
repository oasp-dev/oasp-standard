import type { AgentDefinition, Credential } from '@oasp/schemas';
import type { DomainError } from '../../shared/domain-error.types';
import { err, ok, type Result } from '../../shared/result';
import { principalRefsEqual } from '../auth/principal-refs-equal';
import { scopesEqual } from '../auth/scopes-equal';
import { serverErrors } from '../server-errors';
import type { ResolveCredentialBindingsInput } from './resolve-credential-bindings.types';

/** The one `tools` element shape this module ever inspects: a granted MCP server, narrowed from the discriminated union by the `continue` guard in the loop below. */
type McpToolGrant = Extract<AgentDefinition['tools'][number], { type: 'mcp' }>;

/**
 * Whether `credential` is an eligible binding for `tool`'s MCP grant
 * under `input`'s security context. Not exported — private to
 * {@link resolveCredentialBindings} below, which is the only caller and
 * the only place ambiguity/zero-match counting happens.
 *
 * Checks, in order (issue #8's four firm invariants):
 * 1. **URL match** — `credential.mcpServerUrl` names this exact server
 *    (the pre-#8 behaviour's only check).
 * 2. **Provider match** — `credential.provider` equals the pinned
 *    version's own `provider` (see `resolve-credential-bindings.types.ts`'s
 *    `definitionVersion` doc for why that is the only provider a grant
 *    can be checked against today).
 * 3. **Scope match** — `credential.scope` equals `input.effectiveScope`
 *    exactly (`scopes-equal.ts`), and — when `input.actor` is delegated —
 *    ALSO equals `actor.delegation.scopePin`. The second check is
 *    redundant whenever the caller already ran `auth/authorize.ts`
 *    against the same scope first (that gate requires
 *    `effectiveScope === scopePin` under delegation, so the two values
 *    are already identical) — it is kept here anyway as this
 *    resolver's own defense-in-depth, so a future call site that
 *    forgets to authorize first still cannot bind a credential outside
 *    the delegation's ceiling.
 * 4. **onBehalfOf match** — per `credential.ts`'s "containment is the
 *    pin, never membership" intent: a Credential with `onBehalfOf` set
 *    is eligible ONLY under a delegation naming that exact Principal
 *    (`principal-refs-equal.ts`) — never for an un-delegated actor, and
 *    never for a delegation naming someone else. A Credential with NO
 *    `onBehalfOf` carries no such restriction and is eligible either
 *    way, delegated or not — `onBehalfOf` narrows who may use a
 *    Credential; its absence is "unrestricted," not "restricted to the
 *    un-delegated case."
 */
function isCredentialEligible(credential: Credential, tool: McpToolGrant, input: ResolveCredentialBindingsInput): boolean {
  if (credential.mcpServerUrl !== tool.serverUrl) return false;
  if (credential.provider !== input.definitionVersion.provider) return false;
  if (!scopesEqual(credential.scope, input.effectiveScope)) return false;

  const delegation = input.actor?.delegation;
  if (delegation && !scopesEqual(credential.scope, delegation.scopePin)) return false;

  if (credential.onBehalfOf) {
    return delegation !== undefined && principalRefsEqual(credential.onBehalfOf, delegation.onBehalfOf);
  }
  return true;
}

/**
 * Resolves the `vaultIds` an interaction should attach, by binding each
 * `mcp`-type tool grant that requires `auth: 'credential'` against the
 * exactly-one registered `Credential` that satisfies EVERY condition in
 * {@link isCredentialEligible} — issue #8's replacement for the pre-#8
 * `resolveVaultIds`, which matched on `mcpServerUrl` alone, picked the
 * first match by Map insertion order on a tie, and silently skipped a
 * grant with no match. All three of those are security gaps this
 * resolver closes:
 *
 * - **Ambiguous** (more than one eligible Credential for the same
 *   grant) now fails closed with `Server.AmbiguousCredentialBinding`,
 *   never silently picked by insertion order — two tenants' Credentials
 *   that happen to share an `mcpServerUrl` must never collide into "the
 *   first one registered wins."
 * - **Unresolved** (zero eligible Credentials for an `auth: 'credential'`
 *   grant) now fails closed with `Server.UnresolvedCredential`, never
 *   silently skipped — an interaction that would otherwise run with an
 *   incomplete security posture is rejected outright instead.
 * - **Wrong-scope / wrong-delegate / wrong-provider** matches — the
 *   pre-#8 defect this issue is titled for — are excluded from
 *   eligibility entirely, never merely deprioritized against a
 *   "better" match; there is no ranking, only eligible-or-not.
 *
 * `auth: 'none'` grants and non-`mcp` tools are unaffected (skipped,
 * exactly as before) — this resolver only ever gates
 * `auth: 'credential'` grants.
 *
 * **Deferred to issue #16 (credential lifecycle):** this resolver checks
 * binding compatibility only — scope, delegation-pin, `onBehalfOf`, and
 * provider. It does NOT check whether a Credential is active, revoked,
 * or expired; the `Credential` schema carries no such fields yet. A
 * Credential that is a valid BINDING match is treated as usable
 * regardless of any lifecycle state a future profile might add. See
 * `docs/oasp-v0-concept.md` § Credential for the forward-reference.
 */
export function resolveCredentialBindings(input: ResolveCredentialBindingsInput): Result<readonly string[], DomainError> {
  const vaultIds: string[] = [];

  for (const tool of input.definitionVersion.tools) {
    if (tool.type !== 'mcp' || tool.auth !== 'credential') continue;

    const eligible = [...input.credentials.values()].filter((credential) => isCredentialEligible(credential, tool, input));

    if (eligible.length === 0) return err(serverErrors.unresolvedCredential(tool.serverUrl));
    if (eligible.length > 1) return err(serverErrors.ambiguousCredentialBinding(tool.serverUrl, eligible.map((credential) => credential.id)));

    vaultIds.push(eligible[0]!.id); // exactly one eligible candidate confirmed by the two guards above — never undefined.
  }

  return ok(vaultIds);
}
