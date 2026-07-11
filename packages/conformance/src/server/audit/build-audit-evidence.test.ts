import { describe, expect, it } from 'vitest';
import { buildAuditEvidence } from './build-audit-evidence';

describe('buildAuditEvidence', () => {
  it('returns undefined (never {}) when neither value is present', () => {
    expect(buildAuditEvidence({})).toBeUndefined();
  });

  it('includes only contentDigest when agentVersionRef is absent', () => {
    const evidence = buildAuditEvidence({ contentDigest: 'sha256:abc' });
    expect(evidence).toEqual({ contentDigest: 'sha256:abc' });
    expect(evidence && 'agentVersionRef' in evidence).toBe(false);
  });

  it('includes only agentVersionRef when contentDigest is absent', () => {
    const evidence = buildAuditEvidence({ agentVersionRef: { agentDefinitionId: 'agentdef_1', version: 2 } });
    expect(evidence).toEqual({ agentVersionRef: { agentDefinitionId: 'agentdef_1', version: 2 } });
    expect(evidence && 'contentDigest' in evidence).toBe(false);
  });

  it('includes both when both are present', () => {
    const evidence = buildAuditEvidence({ contentDigest: 'sha256:abc', agentVersionRef: { agentDefinitionId: 'agentdef_1', version: 2 } });
    expect(evidence).toEqual({ contentDigest: 'sha256:abc', agentVersionRef: { agentDefinitionId: 'agentdef_1', version: 2 } });
  });
});
