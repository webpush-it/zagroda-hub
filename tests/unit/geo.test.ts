import { describe, expect, it } from "vitest";
import { formatApproxDistance, haversineKm } from "@/lib/geo";

// Locks the Haversine distance against known city pairs and the approximate
// formatting thresholds. Both are pure functions used by the catalog client.

describe("haversineKm", () => {
  it("returns 0 for identical points", () => {
    expect(haversineKm({ lat: 52.2297, lng: 21.0122 }, { lat: 52.2297, lng: 21.0122 })).toBe(0);
  });

  it("Warszawa → Kraków is ~250 km", () => {
    const km = haversineKm({ lat: 52.2297, lng: 21.0122 }, { lat: 50.0647, lng: 19.945 });
    expect(km).toBeGreaterThan(240);
    expect(km).toBeLessThan(260);
  });

  it("Gdańsk → Kraków is ~490 km", () => {
    const km = haversineKm({ lat: 54.352, lng: 18.6466 }, { lat: 50.0647, lng: 19.945 });
    expect(km).toBeGreaterThan(475);
    expect(km).toBeLessThan(505);
  });

  it("is symmetric", () => {
    const a = { lat: 52.2297, lng: 21.0122 };
    const b = { lat: 50.0647, lng: 19.945 };
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 9);
  });
});

describe("formatApproxDistance", () => {
  it("shows '<1 km' below one kilometre", () => {
    expect(formatApproxDistance(0)).toBe("<1 km");
    expect(formatApproxDistance(0.4)).toBe("<1 km");
    expect(formatApproxDistance(0.999)).toBe("<1 km");
  });

  it("rounds to whole km with a '~' prefix at and above 1 km", () => {
    expect(formatApproxDistance(1)).toBe("~1 km");
    expect(formatApproxDistance(1.4)).toBe("~1 km");
    expect(formatApproxDistance(1.5)).toBe("~2 km");
    expect(formatApproxDistance(249.6)).toBe("~250 km");
  });
});
