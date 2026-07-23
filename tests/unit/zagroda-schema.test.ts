import { describe, expect, it } from "vitest";
import { zagrodaProfileSchema } from "@/lib/zagroda";

// Locks the coordinate validation on zagrodaProfileSchema (zagroda-map-location
// Phase 2): range bounds plus the "both-or-neither" refine that keeps a lone
// latitude/longitude from reaching the write path.

const base = {
  name: "Zagroda pod Lipami",
  description: "",
  voivodeship: null,
  city: "",
  daily_limit: 40,
  turnusy: [],
};

describe("zagrodaProfileSchema coordinates", () => {
  it("accepts both coords null (auto)", () => {
    const r = zagrodaProfileSchema.safeParse({ ...base, latitude: null, longitude: null });
    expect(r.success).toBe(true);
  });

  it("accepts an in-range pin (manual)", () => {
    const r = zagrodaProfileSchema.safeParse({ ...base, latitude: 52.23, longitude: 21.01 });
    expect(r.success).toBe(true);
  });

  it("accepts pins at the Poland bounding-box edges", () => {
    expect(zagrodaProfileSchema.safeParse({ ...base, latitude: 49.0, longitude: 14.5 }).success).toBe(true);
    expect(zagrodaProfileSchema.safeParse({ ...base, latitude: 54.9, longitude: 24.0 }).success).toBe(true);
  });

  it("rejects latitude outside Poland", () => {
    // North of the box (Baltic), south of the box (Slovakia), and far off-planet.
    expect(zagrodaProfileSchema.safeParse({ ...base, latitude: 56, longitude: 21 }).success).toBe(false);
    expect(zagrodaProfileSchema.safeParse({ ...base, latitude: 48, longitude: 21 }).success).toBe(false);
    expect(zagrodaProfileSchema.safeParse({ ...base, latitude: 91, longitude: 21 }).success).toBe(false);
  });

  it("rejects longitude outside Poland", () => {
    // East of the box (Belarus/Ukraine), west of the box (Germany), and far off-planet.
    expect(zagrodaProfileSchema.safeParse({ ...base, latitude: 52, longitude: 25 }).success).toBe(false);
    expect(zagrodaProfileSchema.safeParse({ ...base, latitude: 52, longitude: 13 }).success).toBe(false);
    expect(zagrodaProfileSchema.safeParse({ ...base, latitude: 52, longitude: 181 }).success).toBe(false);
  });

  it("rejects only latitude set", () => {
    expect(zagrodaProfileSchema.safeParse({ ...base, latitude: 52.23, longitude: null }).success).toBe(false);
  });

  it("rejects only longitude set", () => {
    expect(zagrodaProfileSchema.safeParse({ ...base, latitude: null, longitude: 21.01 }).success).toBe(false);
  });
});
