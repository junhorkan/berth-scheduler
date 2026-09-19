/**
 * Vessel-fits-berth checking.
 *
 * This is the SOFT rule, and the asymmetry with conflicts.ts is deliberate.
 *
 * A conflict is made impossible by the database. A size mismatch CANNOT be, because
 * the length data to check it mostly does not exist: only 19 of 418 vessels in the
 * source schedule have a recorded length, so 97.5% of bookings are unverifiable.
 * Blocking on unverifiable data would make the tool unusable, so fit WARNS and
 * never blocks — and the warning is what motivates someone to fill the gap in.
 */

import type { Berth, Booking, Vessel } from './types';

export type FitVerdict = 'fits' | 'too_long' | 'unverified';

export type FitResult = {
  verdict: FitVerdict;
  /** Feet by which the vessel exceeds the berth. Only set when 'too_long'. */
  overByFt?: number;
  /** Short human explanation, shown verbatim in the booking panel. */
  reason: string;
};

/**
 * Compare a vessel length against a berth length.
 *
 * Either length being unknown yields 'unverified' — we say "we cannot tell",
 * never "it fits". Silence would be indistinguishable from a confirmed fit,
 * which is exactly the failure this project exists to remove.
 */
export function checkFit(vesselLengthFt: number | null, berthLengthFt: number | null): FitResult {
  if (vesselLengthFt == null) {
    return { verdict: 'unverified', reason: 'No recorded length for this vessel.' };
  }
  if (berthLengthFt == null) {
    return { verdict: 'unverified', reason: 'No recorded length for this berth.' };
  }
  if (vesselLengthFt > berthLengthFt) {
    return {
      verdict: 'too_long',
      overByFt: vesselLengthFt - berthLengthFt,
      reason: `Vessel is ${vesselLengthFt}' but the berth is ${berthLengthFt}' — over by ${
        vesselLengthFt - berthLengthFt
      }'.`,
    };
  }
  return {
    verdict: 'fits',
    reason: `Vessel is ${vesselLengthFt}' in a ${berthLengthFt}' berth.`,
  };
}

/**
 * How tall to draw the bar, as a multiple of its lane height.
 *
 * This is the whole visual idea: the ratio IS the geometry, so a 145' vessel in a
 * 90' berth returns 1.61 and overflows its lane as a consequence of arithmetic
 * rather than as a special case. Unknown lengths get a fixed modest height because
 * we must not imply a size we do not know.
 */
export function barHeightRatio(vesselLengthFt: number | null, berthLengthFt: number | null): number {
  const UNKNOWN_HEIGHT = 0.55;
  if (vesselLengthFt == null || berthLengthFt == null || berthLengthFt <= 0) return UNKNOWN_HEIGHT;
  return vesselLengthFt / berthLengthFt;
}

/**
 * Booking-level wrapper. Events and closures have no vessel, so fit does not apply
 * to them at all — distinct from 'unverified', which means "a vessel whose size we
 * don't know".
 */
export function fitForBooking(
  booking: Pick<Booking, 'kind'>,
  vessel: Pick<Vessel, 'lengthFt'> | null,
  berth: Pick<Berth, 'lengthFt'>,
): FitResult | 'not_applicable' {
  if (booking.kind !== 'vessel') return 'not_applicable';
  return checkFit(vessel?.lengthFt ?? null, berth.lengthFt);
}
