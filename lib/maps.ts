// Must stay in sync with the places.maps_url check constraint in the migration.
const MAPS_RE =
  /^https:\/\/((www\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl\/maps)(\/|\?|$)/i;

export function isGoogleMapsUrl(url: string): boolean {
  return MAPS_RE.test(url.trim());
}
