import { describe, expect, it } from 'vitest';
import { buildAuditWho } from './build-audit-who';

describe('buildAuditWho', () => {
  it('includes only principal when onBehalfOf is absent', () => {
    const who = buildAuditWho({ principal: { kind: 'service', id: 'svc_1' } });
    expect(who).toEqual({ principal: { kind: 'service', id: 'svc_1' } });
    expect('onBehalfOf' in who).toBe(false);
  });

  it('includes onBehalfOf when present', () => {
    const who = buildAuditWho({ principal: { kind: 'agent', id: 'agentdef_1' }, onBehalfOf: { kind: 'user', id: 'user_1' } });
    expect(who).toEqual({ principal: { kind: 'agent', id: 'agentdef_1' }, onBehalfOf: { kind: 'user', id: 'user_1' } });
  });
});
