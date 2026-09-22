/**
 * A workbook that cannot be imported, with a message a person can act on.
 *
 * Thrown instead of returning an empty result. The parser used to report success with
 * zero bookings on an empty file, a PDF, random bytes and a CSV alike — which, for any
 * input except the one known workbook, broke "nothing vanishes silently".
 */
export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}
