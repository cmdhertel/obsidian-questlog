/** `toLocaleDateString` with the given locale; an unknown locale tag falls back to the system one instead of throwing. Pure. */
export function formatDate(date: Date, locale: string, opts: Intl.DateTimeFormatOptions): string {
  try {
    return date.toLocaleDateString(locale, opts);
  } catch (e) {
    if (e instanceof RangeError) return date.toLocaleDateString(undefined, opts);
    throw e;
  }
}
