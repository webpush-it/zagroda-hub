import { describe, expect, it } from "vitest";
import {
  bookingRequestSchema,
  buildAcceptanceEmail,
  buildBookingEmails,
  buildRejectionEmail,
  buildWithdrawalEmail,
  dayBlockSchema,
  isValidPlPhone,
  manualBookingSchema,
  normalizePhone,
} from "@/lib/booking";

// Locks the validation edges (phone, date, participant bounds) and proves
// guest-supplied data is HTML-escaped in both email bodies.

const VALID = {
  zagroda_id: "11111111-1111-4111-8111-111111111111",
  turnus_id: "22222222-2222-4222-8222-222222222222",
  trip_date: "2999-12-31",
  participants_count: 5,
  guest_name: "Jan Kowalski",
  guest_email: "jan@example.com",
  guest_phone: "600700800",
};

describe("isValidPlPhone / normalizePhone", () => {
  it("accepts spaced, +48, 0048 and dashed national forms", () => {
    expect(isValidPlPhone("600 700 800")).toBe(true);
    expect(isValidPlPhone("+48 600700800")).toBe(true);
    expect(isValidPlPhone("0048-600-700-800")).toBe(true);
    expect(isValidPlPhone("(48) 600 700 800")).toBe(true);
    expect(isValidPlPhone("600700800")).toBe(true);
  });

  it("rejects too-short, too-long and alphabetic input", () => {
    expect(isValidPlPhone("12345")).toBe(false);
    expect(isValidPlPhone("6007008001234")).toBe(false);
    expect(isValidPlPhone("600 700 80a")).toBe(false);
    expect(isValidPlPhone("abcdefghi")).toBe(false);
  });

  it("strips spaces, dashes and parens", () => {
    expect(normalizePhone("(48) 600-700 800")).toBe("48600700800");
  });
});

describe("bookingRequestSchema — trip_date", () => {
  it("accepts a future date", () => {
    expect(bookingRequestSchema.safeParse(VALID).success).toBe(true);
  });

  it("rejects a past date", () => {
    expect(bookingRequestSchema.safeParse({ ...VALID, trip_date: "2000-01-01" }).success).toBe(false);
  });

  it("rejects a malformed date", () => {
    expect(bookingRequestSchema.safeParse({ ...VALID, trip_date: "31-12-2999" }).success).toBe(false);
    expect(bookingRequestSchema.safeParse({ ...VALID, trip_date: "2999-13-40" }).success).toBe(false);
  });
});

describe("bookingRequestSchema — participants_count", () => {
  it("accepts 1 and 1000", () => {
    expect(bookingRequestSchema.safeParse({ ...VALID, participants_count: 1 }).success).toBe(true);
    expect(bookingRequestSchema.safeParse({ ...VALID, participants_count: 1000 }).success).toBe(true);
  });

  it("rejects 0, 1001 and non-integers", () => {
    expect(bookingRequestSchema.safeParse({ ...VALID, participants_count: 0 }).success).toBe(false);
    expect(bookingRequestSchema.safeParse({ ...VALID, participants_count: 1001 }).success).toBe(false);
    expect(bookingRequestSchema.safeParse({ ...VALID, participants_count: 2.5 }).success).toBe(false);
  });

  it("coerces a numeric string", () => {
    const result = bookingRequestSchema.safeParse({ ...VALID, participants_count: "7" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.participants_count).toBe(7);
  });
});

describe("bookingRequestSchema — other fields", () => {
  it("rejects a bad email and a bad phone", () => {
    expect(bookingRequestSchema.safeParse({ ...VALID, guest_email: "not-an-email" }).success).toBe(false);
    expect(bookingRequestSchema.safeParse({ ...VALID, guest_phone: "123" }).success).toBe(false);
  });

  it("rejects an empty name and a non-uuid turnus", () => {
    expect(bookingRequestSchema.safeParse({ ...VALID, guest_name: "   " }).success).toBe(false);
    expect(bookingRequestSchema.safeParse({ ...VALID, turnus_id: "nope" }).success).toBe(false);
  });
});

describe("manualBookingSchema (S-08)", () => {
  const VALID_MANUAL = {
    zagroda_id: "11111111-1111-4111-8111-111111111111",
    turnus_id: "22222222-2222-4222-8222-222222222222",
    trip_date: "2999-12-31",
    participants_count: 5,
  };

  it("accepts a valid payload without a note (note optional)", () => {
    expect(manualBookingSchema.safeParse(VALID_MANUAL).success).toBe(true);
  });

  it("accepts a note up to 500 chars, rejects 501", () => {
    expect(manualBookingSchema.safeParse({ ...VALID_MANUAL, note: "x".repeat(500) }).success).toBe(true);
    expect(manualBookingSchema.safeParse({ ...VALID_MANUAL, note: "x".repeat(501) }).success).toBe(false);
  });

  it("rejects a past and a malformed date", () => {
    expect(manualBookingSchema.safeParse({ ...VALID_MANUAL, trip_date: "2000-01-01" }).success).toBe(false);
    expect(manualBookingSchema.safeParse({ ...VALID_MANUAL, trip_date: "31-12-2999" }).success).toBe(false);
  });

  it("rejects participants 0 and 1001, accepts boundary 1 and 1000", () => {
    expect(manualBookingSchema.safeParse({ ...VALID_MANUAL, participants_count: 0 }).success).toBe(false);
    expect(manualBookingSchema.safeParse({ ...VALID_MANUAL, participants_count: 1001 }).success).toBe(false);
    expect(manualBookingSchema.safeParse({ ...VALID_MANUAL, participants_count: 1 }).success).toBe(true);
    expect(manualBookingSchema.safeParse({ ...VALID_MANUAL, participants_count: 1000 }).success).toBe(true);
  });

  it("rejects a non-uuid zagroda or turnus", () => {
    expect(manualBookingSchema.safeParse({ ...VALID_MANUAL, zagroda_id: "nope" }).success).toBe(false);
    expect(manualBookingSchema.safeParse({ ...VALID_MANUAL, turnus_id: "nope" }).success).toBe(false);
  });
});

describe("dayBlockSchema (S-08)", () => {
  const VALID_BLOCK = {
    zagroda_id: "11111111-1111-4111-8111-111111111111",
    blocked_date: "2999-12-31",
  };

  it("accepts a valid future date", () => {
    expect(dayBlockSchema.safeParse(VALID_BLOCK).success).toBe(true);
  });

  it("rejects a past and a malformed date", () => {
    expect(dayBlockSchema.safeParse({ ...VALID_BLOCK, blocked_date: "2000-01-01" }).success).toBe(false);
    expect(dayBlockSchema.safeParse({ ...VALID_BLOCK, blocked_date: "2999-13-40" }).success).toBe(false);
  });

  it("rejects a non-uuid zagroda", () => {
    expect(dayBlockSchema.safeParse({ ...VALID_BLOCK, zagroda_id: "nope" }).success).toBe(false);
  });
});

describe("buildBookingEmails", () => {
  const ctx = {
    origin: "https://zagroda.test",
    requestId: "44444444-4444-4444-4444-444444444444",
    cancelToken: "33333333-3333-3333-3333-333333333333",
    zagrodaName: "Zagroda u Jana",
    ownerEmail: "owner@example.com",
    turnusLabel: "Poranny",
    guest_name: 'Ala <script>alert("x")</script> & Ola',
    guest_email: "ala@example.com",
    guest_phone: "600700800",
    trip_date: "2999-12-31",
    participants_count: 12,
  };

  it("escapes guest-supplied data in the owner email", () => {
    const { owner } = buildBookingEmails(ctx);
    expect(owner).not.toBeNull();
    if (!owner) return;
    expect(owner.html).not.toContain("<script>");
    expect(owner.html).toContain("&lt;script&gt;");
    expect(owner.html).toContain("&amp;");
    expect(owner.replyTo).toBe("ala@example.com");
  });

  it("embeds the cancel link in the guest email and sets the recipient", () => {
    const { guest } = buildBookingEmails(ctx);
    expect(guest.to).toBe("ala@example.com");
    expect(guest.html).toContain("https://zagroda.test/anuluj?token=33333333-3333-3333-3333-333333333333");
  });

  it("returns owner: null when no owner address resolved", () => {
    const { guest, owner } = buildBookingEmails({ ...ctx, ownerEmail: null });
    expect(owner).toBeNull();
    expect(guest).not.toBeNull();
  });

  it("embeds the detail-page deep link in the owner email", () => {
    const { owner } = buildBookingEmails(ctx);
    expect(owner).not.toBeNull();
    if (!owner) return;
    expect(owner.html).toContain("https://zagroda.test/dashboard/zapytania/44444444-4444-4444-4444-444444444444");
    expect(owner.html).toContain("Zobacz zapytanie");
  });
});

describe("buildAcceptanceEmail / buildRejectionEmail / buildWithdrawalEmail", () => {
  const ctx = {
    guest_name: 'Ala <script>alert("x")</script> & Ola',
    guest_email: "ala@example.com",
    zagroda_name: "Zagroda <u>Jana</u> & spółki",
    trip_date: "2999-12-31",
    turnus_label: "Poranny",
    participants_count: 12,
  };

  it("acceptance: recipient, Polish subject, summary fields", () => {
    const msg = buildAcceptanceEmail(ctx);
    expect(msg.to).toBe("ala@example.com");
    expect(msg.subject).toBe("Rezerwacja potwierdzona — Zagroda <u>Jana</u> & spółki");
    expect(msg.html).toContain("2999-12-31");
    expect(msg.html).toContain("Poranny");
    expect(msg.html).toContain("12");
  });

  it("rejection: recipient and Polish subject", () => {
    const msg = buildRejectionEmail(ctx);
    expect(msg.to).toBe("ala@example.com");
    expect(msg.subject).toBe("Zapytanie odrzucone — Zagroda <u>Jana</u> & spółki");
    expect(msg.html).toContain("odrzucił");
  });

  it("withdrawal: recipient, Polish subject, summary fields", () => {
    const msg = buildWithdrawalEmail(ctx);
    expect(msg.to).toBe("ala@example.com");
    expect(msg.subject).toBe("Rezerwacja wycofana — Zagroda <u>Jana</u> & spółki");
    expect(msg.html).toContain("wycofał");
    expect(msg.html).toContain("2999-12-31");
    expect(msg.html).toContain("Poranny");
    expect(msg.html).toContain("12");
  });

  it("escapes guest and zagroda fields in all bodies", () => {
    for (const msg of [buildAcceptanceEmail(ctx), buildRejectionEmail(ctx), buildWithdrawalEmail(ctx)]) {
      expect(msg.html).not.toContain("<script>");
      expect(msg.html).not.toContain("<u>");
      expect(msg.html).toContain("&lt;script&gt;");
      expect(msg.html).toContain("&lt;u&gt;");
    }
  });

  it("decision emails are final-state: no cancel link, no reply-to", () => {
    for (const msg of [buildAcceptanceEmail(ctx), buildRejectionEmail(ctx), buildWithdrawalEmail(ctx)]) {
      expect(msg.html).not.toContain("/anuluj");
      expect(msg.replyTo).toBeUndefined();
      expect(msg.html).not.toContain("<a ");
    }
  });

  it("omits the turnus row when no label is known", () => {
    const msg = buildAcceptanceEmail({ ...ctx, turnus_label: null });
    expect(msg.html).not.toContain("Turnus:");
  });
});
