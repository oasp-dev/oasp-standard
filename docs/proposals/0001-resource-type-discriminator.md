# Proposal 0001 — FHIR-style `resourceType` discriminator on resources

**Status:** Proposal (non-normative until ratified)
**Raised by:** `oasp-java-sdk` — the first external consumer of the standard
**Traces to:** spec-feedback issue (`oasp-java-sdk` #2)

> This is a **proposal**, not yet-normative text. It records a gap surfaced by
> building the first external consumer and the direction its maintainers have
> chosen, for ratification here. The concrete schema / OpenAPI changes follow
> acceptance — see *Follow-up* below.

## Motivation

Building the OASP Java SDK (the first external consumer of this standard)
surfaced that **OASP resources are not self-describing on the wire.** Today only
the `AuditEvent` hierarchy carries a discriminator (its `what` enum); every other
resource — `Conversation`, `Session`, `AgentDefinition`, `Credential`,
`Deployment`, `Event`, … — is identifiable only from the caller's expected type
or the endpoint that returned it. There is no `resourceType` field anywhere in
the schemas today.

For a protocol explicitly designed **FHIR-shaped**, this is a gap. FHIR tags
every *resource* with a `resourceType` discriminator (but not embedded
datatypes), which makes any representation self-describing: a deserializer can
dispatch on the tag and **validate that a payload is the type the caller
expected**, and a hierarchy can carry a catch-all for types a reader's version
does not yet know.

Concretely, the SDK already had to hand-build exactly this pattern for
`AuditEvent` — a discriminator plus an `UnknownAuditEvent` fallback so a newer
server's event types don't hard-fail an older client. Generalising that to all
resources is the natural, FHIR-consistent move, and it lets the SDK (and any
consumer) dispatch and validate uniformly instead of per-type.

## Proposal

Adopt a FHIR-style **`resourceType`** discriminator.

1. **Every OASP *resource* representation MUST carry a `resourceType` string**
   whose value is the resource's type name (e.g. `"Conversation"`,
   `"Session"`, `"AuditEvent"`).
2. **Embedded *datatypes* MUST NOT carry `resourceType`.** These are values that
   only ever appear nested inside a resource (e.g. the `Principal` claims
   contract, scope claims) — they are dispatched by position, exactly as in
   FHIR's resource-vs-datatype distinction.
3. **Consumers MUST tolerate an unrecognised `resourceType`** rather than
   failing to deserialize — a reader SHOULD surface it as an opaque
   "unknown resource" that preserves the raw payload, preserving
   forward-compatibility when a newer server introduces a resource type the
   reader's version predates. (This is the general form of the SDK's existing
   `UnknownAuditEvent` behaviour.)
4. **`AuditEvent` composes cleanly:** it becomes a resource like any other
   (`resourceType: "AuditEvent"`), and its existing `what` value continues to
   discriminate the *audit sub-kind* underneath that. `resourceType` identifies
   the resource; `what` identifies which audit event it is. No existing audit
   field changes.

## Open questions (for maintainers to pin before the schema change)

1. **Field name** — `resourceType` (FHIR-identical, recommended) vs `type` vs
   `kind`. Note `type`/`what` collision risk with the audit vocabulary;
   `resourceType` avoids it.
2. **Value casing** — PascalCase (`"Conversation"`, FHIR-style) vs lowercase
   (`"conversation"`).
3. **The resource / datatype partition** — proposed *resources*:
   `Conversation`, `Session`, `AgentDefinition`, `AgentDefinitionVersion`,
   `AuditEvent`, `Credential`, `Deployment`, `Event`. Proposed *datatypes*
   (no discriminator): `Principal` and the scope/claim values it carries.
   `Principal` is the main judgement call — confirm whether it is ever returned
   as a standalone resource or only ever embedded.
4. **Unknown-resource contract strength** — MUST-tolerate + SHOULD-surface (as
   proposed), or stricter.

## Follow-up (after ratification)

Once the above are pinned, the normative change lands as:

- Add `resourceType` to the resource schema sources under
  `packages/schemas/src/resources/` (and regenerate `schemas/v1alpha1/` +
  `openapi/`), with a shared base/mixin so it is declared once.
- A normative section (new `docs/spec/resources.md` or an addition to an existing
  document) specifying (1)–(4) above in RFC 2119 terms.
- A conformance check under `packages/conformance` asserting every resource
  response carries a correct `resourceType` and that an unknown value is
  tolerated.

## References

- **FHIR** — `resourceType` on resources (not datatypes): the canonical precedent.
- **`oasp-java-sdk`** — `UnknownAuditEvent` fallback (the pattern this generalises),
  and the recorded decision **D2 — Resource discriminator & self-describing types**
  (`docs/decisions/d2-resource-discriminator.decision.yaml`), decided in favour of a
  self-describing resource model.
