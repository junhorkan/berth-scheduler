import { describe, it, expect } from 'vitest';
import {
  classifyEntry,
  canonicalVesselName,
  extractLengthFromVesselName,
  stripLengthFromVesselName,
  parseBerthLabel,
  capacityModeFor,
} from './normalize';

/**
 * Every string in this file is a VERBATIM cell value from
 * data/Dock Schedule - Synthetic Sample.xlsx.
 */

describe('classifyEntry — vessels', () => {
  const vessels = [
    'R/V Long Ketch',
    'R/V GOLDEN COMPASS',
    'OSV AMBER REEF',
    'OS/V Golden Osprey',
    'M/Y GREEN LANTERN',
    'M/V NORTHERN HARBOR',
    'Barge SALT DORY',
    'Barge Salt Dory',
    'F/V SALT FATHOM',
    'S/V FAR HORIZON',
    'S/Y High Gannet',
    'Tug BLUE FATHOM',
    'Tug Salt Tide',
  ];
  it.each(vessels)('classifies %s as vessel', (s) => {
    expect(classifyEntry(s)).toBe('vessel');
  });
});

describe('classifyEntry — non-vessel events that still occupy a berth', () => {
  const events = [
    'Community sail day',
    'Public open house',
    'Student tour',
    'Science stroll',
    'Donor reception',
    'Campus event',
    'Film crew on dock',
    'Rescue drill',
    'Safety training (RIBs)',
    'Bunker barge',
    'Bunkering',
    'Bunkering 1000',
    'Fueling',
    'Fueling @0800',
    'Fuel truck',
    'Provisioning',
    'Load equipment',
    'Emergency port call',
  ];
  it.each(events)('classifies %s as event', (s) => {
    expect(classifyEntry(s)).toBe('event');
  });

  it('does not mistake "Bunker barge" for a Barge-prefixed vessel', () => {
    expect(classifyEntry('Bunker barge')).toBe('event');
  });

  it('keeps an operational event that carries a time as an event, not an annotation', () => {
    expect(classifyEntry('Bunkering 1000')).toBe('event');
    expect(classifyEntry('Fueling @0800')).toBe('event');
  });
});

describe('classifyEntry — closures that take a berth out of service', () => {
  const closures = [
    'Dock maintenance - restricted access',
    'Float rebuild - no usage permitted',
    'Pier repair - no docking',
    'Bollard replacement, west face',
    'Paving near dock entrance',
    'Road race - access limited',
    'Utility work on pier face',
  ];
  it.each(closures)('classifies %s as closure', (s) => {
    expect(classifyEntry(s)).toBe('closure');
  });

  it('prefers closure over event when a label contains both senses', () => {
    // 'Road race - access limited' contains race (event-ish) AND access limited (closure).
    expect(classifyEntry('Road race - access limited')).toBe('closure');
  });
});

describe('classifyEntry — annotations that occupy nothing', () => {
  const annotations = ['ETA 1200', 'ETD PM', 'Arrival 1400', 'Arrives AM', 'Departs 0600', 'Departure 0800', 'Delayed due to weather', '1400'];
  it.each(annotations)('classifies %s as annotation', (s) => {
    expect(classifyEntry(s)).toBe('annotation');
  });
});

describe('classifyEntry — anything uncertain becomes a review item, never a guess', () => {
  it('marks an empty cell unclassified', () => {
    expect(classifyEntry('   ')).toBe('unclassified');
  });
  it('marks unrecognised free text unclassified rather than inventing a kind', () => {
    expect(classifyEntry('see Dave re: crane')).toBe('unclassified');
  });
});

describe('canonicalVesselName', () => {
  it('folds case variants of the same hull to one key', () => {
    expect(canonicalVesselName('Barge SALT DORY').normalized).toBe(canonicalVesselName('Barge Salt Dory').normalized);
  });

  it('folds the OS/V typo into OSV', () => {
    expect(canonicalVesselName('OS/V Golden Osprey').normalized).toBe(canonicalVesselName('OSV Golden Osprey').normalized);
  });

  it('collapses runs of whitespace', () => {
    expect(canonicalVesselName('R/V   Long    Ketch').display).toBe('R/V Long Ketch');
  });

  it('preserves the source spelling for display rather than title-casing it', () => {
    expect(canonicalVesselName('R/V GOLDEN COMPASS').display).toBe('R/V GOLDEN COMPASS');
  });
});

describe('vessel name lengths', () => {
  it('extracts a trailing length', () => {
    expect(extractLengthFromVesselName("R/V High Drift 120'")).toBe(120);
  });
  it('returns null when there is no trailing length', () => {
    expect(extractLengthFromVesselName('R/V Long Ketch')).toBeNull();
  });
  it('strips the length to leave a clean name', () => {
    expect(stripLengthFromVesselName("R/V High Drift 120'")).toBe('R/V High Drift');
  });
});

describe('parseBerthLabel', () => {
  it.each([
    ["North Pier West - 410'", 'North Pier West', 410],
    ["North Pier East - 240'", 'North Pier East', 240],
    ["North Pier Face - 75'", 'North Pier Face', 75],
    ["Inner Channel - 55'", 'Inner Channel', 55],
    ["South Float West - 90'", 'South Float West', 90],
    ["South Float East - 90'", 'South Float East', 90],
  ])('parses %s', (label, name, lengthFt) => {
    expect(parseBerthLabel(label)).toEqual({ name, lengthFt });
  });

  it('returns null for the "North Finger Piers:" SECTION HEADER, which is not a berth', () => {
    expect(parseBerthLabel('North Finger Piers:')).toBeNull();
  });

  it('accepts a real berth that has no stated length', () => {
    expect(parseBerthLabel('Small craft slips (institution boats)')).toEqual({
      name: 'Small craft slips (institution boats)',
      lengthFt: null,
    });
  });
});

describe('capacityModeFor', () => {
  it('marks Small craft slips as pooled so it never reports a false conflict', () => {
    expect(capacityModeFor('Small craft slips (institution boats)')).toBe('pooled');
  });
  it.each(['North Pier West', 'South Float East', 'Inner Channel'])('marks %s exclusive', (n) => {
    expect(capacityModeFor(n)).toBe('exclusive');
  });
});
