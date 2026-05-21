import { describe, expect, it } from 'vitest';
import { Audit } from '../../src/audit.js';

describe('Audit URL helper', () => {
  it('builds proof and attestation URLs against the configured dashboard', () => {
    const audit = new Audit({ dashboardUrl: 'https://dash.aperture.test/' });
    expect(audit.proofUrl('abc-123')).toBe('https://dash.aperture.test/audit/abc-123');
    expect(audit.attestationUrl('att-9')).toBe('https://dash.aperture.test/audit/att-9');
  });

  it('returns null for dashboard URLs when no dashboardUrl is provided', () => {
    const audit = new Audit({});
    expect(audit.proofUrl('abc-123')).toBeNull();
    expect(audit.attestationUrl('att-9')).toBeNull();
  });

  it('uses ?cluster=devnet by default on explorer links', () => {
    const audit = new Audit({});
    expect(audit.explorerTx('sig')).toBe(
      'https://explorer.solana.com/tx/sig?cluster=devnet',
    );
    expect(audit.explorerAccount('addr')).toBe(
      'https://explorer.solana.com/address/addr?cluster=devnet',
    );
  });

  it('omits the cluster query on mainnet-beta', () => {
    const audit = new Audit({ cluster: 'mainnet-beta' });
    expect(audit.explorerTx('sig')).toBe('https://explorer.solana.com/tx/sig');
  });

  it('supports custom RPC clusters via customUrl', () => {
    const audit = new Audit({
      cluster: 'custom',
      customRpc: 'http://localhost:8899',
    });
    expect(audit.explorerTx('sig')).toContain('cluster=custom');
    expect(audit.explorerTx('sig')).toContain(encodeURIComponent('http://localhost:8899'));
  });
});
