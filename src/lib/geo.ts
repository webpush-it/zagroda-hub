// Pure geo helpers — no DOM dependency, so both the catalog client `<script>`
// and vitest can import them. Distance is presented as explicitly approximate
// because coordinates are resolved only at locality granularity.

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6371;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

// Great-circle distance in kilometres between two points (Haversine formula).
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Formats a distance as explicitly approximate. Below 1 km we avoid a bogus
// "~0 km" and show "<1 km"; otherwise "~{rounded} km".
export function formatApproxDistance(km: number): string {
  if (km < 1) return "<1 km";
  return `~${Math.round(km)} km`;
}
