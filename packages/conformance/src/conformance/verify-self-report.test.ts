import { describe, expect, it } from 'vitest';
import { testHarnessFactory } from '../factories/test-harness-factory';
import { runAdapterChecks } from './checks/adapter/run-adapter-checks';
import { runServerChecks } from './checks/server/run-server-checks';
import { verifySelfReport } from './verify-self-report';

describe('verifySelfReport', () => {
  it('confirms a true self-report from the conformant reference server', async () => {
    const { server, provider, controls } = testHarnessFactory();

    const result = await verifySelfReport(server.selfReport(), {
      server: () => runServerChecks(server, controls),
      adapter: () => runAdapterChecks(provider),
    });

    expect(result.claimedLevels).toEqual(['server']);
    expect(result.allClaimsVerified).toBe(true);
  });

  it('catches a false self-report: a server claiming "server" conformance while its migrate is broken', async () => {
    const { server: realServer, provider, controls } = testHarnessFactory();
    const brokenServer: typeof realServer = {
      ...realServer,
      migrate: async (conversationId) => {
        const conversation = realServer.getConversation(conversationId);
        return conversation ? { ok: true, value: conversation } : { ok: false, error: { code: 'x', message: 'not found' } };
      },
      selfReport: () => ({ levels: ['server'] }), // the false claim: this server does NOT actually satisfy it
    };

    const result = await verifySelfReport(brokenServer.selfReport(), {
      server: () => runServerChecks(brokenServer, controls),
      adapter: () => runAdapterChecks(provider),
    });

    expect(result.allClaimsVerified).toBe(false);
    expect(result.results.server?.some((r) => !r.passed)).toBe(true);
  });

  it('treats a claimed level with no supplied runner as an unverifiable, failing claim', async () => {
    const result = await verifySelfReport({ levels: ['adapter'] }, {}); // no adapter runner supplied

    expect(result.allClaimsVerified).toBe(false);
    expect(result.results.adapter?.[0]?.passed).toBe(false);
  });
});
