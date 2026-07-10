# Security policy

OASP is a specification, schema, and conformance-kit repository: a Zod
schema source of truth, generated JSON Schema/OpenAPI artifacts, and a
deterministic conformance test kit. There is no hosted service and no
runtime here that handles user data or secrets.

## Reporting a vulnerability

Please report suspected vulnerabilities privately using
[GitHub's private vulnerability reporting](https://github.com/oasp-dev/oasp-standard/security/advisories/new)
(repository **Security** tab → **Report a vulnerability**), rather than
opening a public issue. This applies to things like a schema or
generator flaw that could mislead a conformant implementation about a
security-relevant behaviour (e.g. auth/permission fields), or a supply
chain issue in this repo's own tooling.

We don't yet have a fixed response-time SLA — this is a single-maintainer,
pre-1.0 project — but reports will be acknowledged and triaged in good
faith.

## Supported versions

The standard is at **v1alpha1**, an early draft. It is the only
supported line; there are no prior versions to patch and no LTS
guarantee. Breaking changes are expected before v1.
