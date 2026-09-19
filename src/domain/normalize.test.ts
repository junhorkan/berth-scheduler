import { describe, it, expect } from 'vitest';
import { canonicalVesselName } from './normalize';

describe('canonicalVesselName', () => {
  it('treats case variants of one hull as the same vessel', () => {
    expect(canonicalVesselName('Barge SALT DORY').normalized)
      .toBe(canonicalVesselName('Barge Salt Dory').normalized);
  });

  it('keeps the spelling the user typed for display', () => {
    expect(canonicalVesselName('Barge Salt Dory').display).toBe('Barge Salt Dory');
  });

  it('folds the OS/V variant into OSV, in both forms', () => {
    const a = canonicalVesselName('OS/V AMBER REEF');
    const b = canonicalVesselName('OSV Amber Reef');
    expect(a.display).toBe('OSV AMBER REEF');
    expect(a.normalized).toBe(b.normalized);
  });

  it('only folds the prefix, never OS/V inside a name', () => {
    expect(canonicalVesselName('R/V OS/V Decoy').display).toBe('R/V OS/V Decoy');
  });

  it('collapses runs of whitespace so spacing slips do not split a vessel', () => {
    expect(canonicalVesselName('  R/V   Long   Ketch ').display).toBe('R/V Long Ketch');
  });

  it('returns an empty normalized form for an empty name, so it can be rejected', () => {
    expect(canonicalVesselName('   ').normalized).toBe('');
  });
});
