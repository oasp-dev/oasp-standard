import { z } from 'zod';
import { agentVersionRefSchema } from '../common/agent-version-ref';
import { resourceType } from '../common/resource-type';

/**
 * A single mounted file. Not exported: a private building block of
 * {@link sessionSchema}'s `resources` discriminated union.
 */
const fileResourceSchema = z
  .object({
    type: z.literal('file').describe('Discriminant identifying this as a mounted file.'),
    fileId: z.string().min(1).describe('Identifier of the file mounted into this session.'),
  })
  .describe('A single file mounted into the session at create.');

/**
 * An opaque mounted memory store. Per the v0 concept draft's decisions,
 * Memory is deliberately opaque in v0 — a first-class Memory resource
 * with defined internals is a v1 candidate once two implementations
 * interoperate on it. Not exported: a private building block of
 * {@link sessionSchema}'s `resources` discriminated union.
 */
const memoryStoreResourceSchema = z
  .object({
    type: z.literal('memory_store').describe('Discriminant identifying this as a mounted memory store.'),
    storeId: z.string().min(1).describe('Opaque identifier of the memory store mounted into this session.'),
  })
  .describe('An opaque mounted memory store. v0 treats memory as an opaque resource; see Decisions taken.');

/**
 * A mounted GitHub repository. Not exported: a private building block
 * of {@link sessionSchema}'s `resources` discriminated union.
 */
const githubRepositoryResourceSchema = z
  .object({
    type: z.literal('github_repository').describe('Discriminant identifying this as a mounted GitHub repository.'),
    owner: z.string().min(1).describe('Owner (user or organization) of the mounted repository.'),
    repo: z.string().min(1).describe('Name of the mounted repository.'),
    ref: z
      .string()
      .min(1)
      .optional()
      .describe('Branch, tag, or commit SHA to mount; if absent, the provider mounts the default branch.'),
  })
  .describe('A GitHub repository mounted into the session at create.');

/**
 * The session-mountable resource vocabulary: a file, a memory store,
 * or a GitHub repository, discriminated on `type`. Not exported: a
 * private building block of {@link sessionSchema}.
 */
const sessionResourceSchema = z.discriminatedUnion('type', [
  fileResourceSchema,
  memoryStoreResourceSchema,
  githubRepositoryResourceSchema,
]);

/**
 * A provider execution context: the disposable "weft" that rides
 * across the durable Conversation "warp". A Session is created pinned
 * to one agent version, with its `resources` mounted and its
 * `vaultIds` attached — and carries nothing forward from there.
 * Remounting resources/vaults for a new version is the `migrate`
 * interaction's job, not something a Session does on its own.
 *
 * `vaultIds` point at Credentials, which are matched to MCP servers by
 * URL and attached at session creation — never baked into the
 * AgentDefinition itself.
 *
 * @see docs/oasp-v0-concept.md § Session
 * @see docs/oasp-v0-concept.md § Credential
 */
export const sessionSchema = z
  .object({
    resourceType: resourceType('Session'),
    id: z.string().min(1).describe('Unique identifier of this Session.'),
    pinnedAgentVersion: agentVersionRefSchema.describe('The immutable AgentDefinition version this Session was created against.'),
    resources: z
      .array(sessionResourceSchema)
      .describe('Resources mounted into the session at create: files, memory stores, and/or GitHub repositories.'),
    vaultIds: z
      .array(z.string().min(1))
      .describe('Identifiers of the Credentials attached to this session, matched to MCP servers by URL at creation.'),
  })
  .describe('A provider execution context, pinned to one agent version, disposable and replaceable.')
  .meta({ id: 'Session' });

/** Inferred Session shape. Always derive from `sessionSchema` — never hand-write. */
export type Session = z.infer<typeof sessionSchema>;
