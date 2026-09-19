/**
 * Vessel identity.
 *
 * The register fills itself as vessels are booked, and people type names
 * inconsistently, so the same hull must not become two entries.
 */

/**
 * Collapse spelling variants of one vessel into a single identity.
 *
 * Returns both forms: `normalized` is the join key, `display` is what to show.
 * The first-seen casing is kept rather than title-casing it, so the system never
 * invents a spelling the facility does not use.
 */
export function canonicalVesselName(raw: string): { display: string; normalized: string } {
  const display = raw
    .trim()
    .replace(/\s+/g, ' ')
    // Fold the OS/V typo into OSV so the two spellings become one vessel.
    .replace(/^OS\/V\b/i, 'OSV');
  return { display, normalized: display.toUpperCase() };
}
