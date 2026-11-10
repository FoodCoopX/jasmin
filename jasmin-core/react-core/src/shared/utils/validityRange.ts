/** A time-bound record's validity, as the API sends it (YYYY-MM-DD). */
export interface Validity {
  valid_from: string;
  valid_until?: string | null;
}

/**
 * The last day of `start`…`end` (YYYY-MM-DD, both included) that `record`
 * runs on, or null when it runs on none of them. ISO dates compare as strings.
 */
export function lastDayInRange(
  record: Validity,
  start: string,
  end: string,
): string | null {
  if (record.valid_from > end) return null;
  if (record.valid_until && record.valid_until < start) return null;
  return record.valid_until && record.valid_until < end ? record.valid_until : end;
}
