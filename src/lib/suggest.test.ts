import { describe, it, expect } from 'vitest';
import { describeChoices, suggestBerth } from './suggest';
import type { BerthLike, Occupancy } from './suggest';

const BERTHS: BerthLike[] = [
  { id: 'nw', name: 'North Pier West', lengthFt: 410, capacityMode: 'exclusive' },
  { id: 'ne', name: 'North Pier East', lengthFt: 240, capacityMode: 'exclusive' },
  { id: 'nf', name: 'North Pier Face', lengthFt: 75, capacityMode: 'exclusive' },
  { id: 'ic', name: 'Inner Channel', lengthFt: 55, capacityMode: 'exclusive' },
  { id: 'sf', name: 'South Float East', lengthFt: 90, capacityMode: 'exclusive' },
  { id: 'sc', name: 'Small craft slips', lengthFt: null, capacityMode: 'pooled' },
];

const free = () => new Map<string, Occupancy[]>();
const busy = (id: string, o: Occupancy) => new Map([[id, [o]]]);
const STAY: Occupancy = { label: 'R/V Long Ketch', startDate: '2026-10-14', endDate: '2026-10-17' };

const choicesFor = (occ: Map<string, Occupancy[]>, len: number | null, isVessel = true) =>
  describeChoices(BERTHS, occ, len, isVessel);
const byId = (cs: ReturnType<typeof choicesFor>, id: string) => cs.find((c) => c.berthId === id)!;

describe('describeChoices', () => {
  it('says what each berth is doing, in the option text and not by colour', () => {
    const cs = choicesFor(busy('nf', STAY), 60);
    expect(byId(cs, 'nf').optionLabel).toBe('North Pier Face — 75ft · taken Oct 14 – 17');
    expect(byId(cs, 'sf').optionLabel).toBe('South Float East — 90ft · free, fits');
  });

  it('states how far short a berth is, rather than just "no"', () => {
    const cs = choicesFor(free(), 95);
    expect(byId(cs, 'ic').optionLabel).toBe('Inner Channel — 55ft · free, 40ft too short');
  });

  it('never claims a fit it cannot check', () => {
    const cs = choicesFor(free(), null);
    expect(byId(cs, 'sf').optionLabel).toContain('fit unchecked');
    expect(byId(cs, 'sf').fit).toBe('unverified');
  });

  it('treats a pooled berth as never taken, because it holds several boats', () => {
    const cs = choicesFor(busy('sc', STAY), 60);
    expect(byId(cs, 'sc').free).toBe(true);
    expect(byId(cs, 'sc').optionLabel).toContain('shared, no fit check');
  });

  it('counts further clashes instead of listing them all', () => {
    const two = new Map([['nw', [STAY, { ...STAY, label: 'Other' }]]]);
    expect(byId(choicesFor(two, 60), 'nw').optionLabel).toContain('+1 more');
  });

  it('has no fit opinion about an event or a closure', () => {
    const cs = choicesFor(free(), null, false);
    expect(byId(cs, 'sf').fit).toBeNull();
    expect(byId(cs, 'sf').optionLabel).toBe('South Float East — 90ft · free');
  });
});

describe('suggestBerth', () => {
  it('picks the SMALLEST berth that fits, so the long ones stay open', () => {
    const s = suggestBerth(choicesFor(free(), 60), 60);
    // 60ft fits 75, 90, 240 and 410. The 75 is the one to use.
    expect(s.berthId).toBe('nf');
    expect(s.reason).toContain('Smallest free berth');
  });

  it('skips a berth that fits but is taken', () => {
    const s = suggestBerth(choicesFor(busy('nf', STAY), 60), 60);
    expect(s.berthId).toBe('sf');   // next smallest that fits
  });

  it('refuses rather than proposing something too short, and says how short', () => {
    const s = suggestBerth(choicesFor(busy('nw', STAY), 300), 300);
    expect(s.berthId).toBeNull();
    expect(s.reason).toContain('No free berth is long enough for 300ft');
    expect(s.reason).toContain('240ft');
  });

  it('falls back to availability alone when no length is on record', () => {
    const s = suggestBerth(choicesFor(free(), null), null);
    expect(s.berthId).toBe('nw');
    expect(s.reason).toContain('fit is not checked');
  });

  it('never suggests the pooled berth, which would always win and mean nothing', () => {
    const allBusy = new Map<string, Occupancy[]>(
      BERTHS.filter((b) => b.capacityMode === 'exclusive').map((b) => [b.id, [STAY]]),
    );
    const s = suggestBerth(choicesFor(allBusy, 60), 60);
    expect(s.berthId).toBeNull();
    expect(s.reason).toContain('Every berth is taken');
  });
});
