import { describe, expect, it } from "vitest";
import { timeline } from "@/components/island/crm-dashboard";
import type { IslandLeadFull } from "@/lib/robin/island-types";

const lead = (over: Partial<IslandLeadFull> = {}): IslandLeadFull => ({
  id: "l1", number: 1, name: "Iron Temple Gym", category: "Gym", city: "Bengaluru", stage: "interested", stageLabel: "Interested",
  phone: null, lastContact: null, nextFollowUp: null, email: null, whatsapp: null, instagram: null, website: null, address: null,
  priority: "medium", score: 50, notes: null, recent: [], followUps: [], mapsUrl: null, potentialValue: null, serviceInterest: null,
  interactions: [], followUpsAll: [], stageHistory: [], demos: [], quotations: [], client: null,
  createdAt: "2026-10-01T09:00:00.000Z", stageSince: "2026-10-05T09:00:00.000Z", ...over,
});

describe("RUBEN CRM timeline", () => {
  it("merges the lead's real records, newest first", () => {
    const ev = timeline(lead({
      interactions: [{ id: "i1", at: "2026-10-10T10:00:00.000Z", when: "10 Oct", channel: "call", direction: "outbound", outcome: "no_answer", notes: null }],
      stageHistory: [{ at: "2026-10-05T09:00:00.000Z", when: "5 Oct", from: "New", to: "Interested" }],
      followUpsAll: [
        { id: "f1", at: "2026-10-08T09:00:00.000Z", when: "8 Oct", action: "call", status: "completed", overdue: false, notes: null, doneAt: "2026-10-09T09:00:00.000Z" },
        { id: "f2", at: "2026-10-20T09:00:00.000Z", when: "20 Oct", action: "visit", status: "pending", overdue: false, notes: "bring brochure", doneAt: null },
      ],
      notes: "2026-10-07: Asked for pricing\nfree text without a date",
    }));
    expect(ev.map((e) => e.id)).toEqual(["ff2", "ii1", "ff1", "n0", "s2026-10-05T09:00:00.000ZInterested", "n1", "created"]);
    expect(ev.find((e) => e.id === "ii1")).toMatchObject({ kind: "call", tag: "no answer" });
    expect(ev.find((e) => e.id === "ff1")?.at).toBe("2026-10-09T09:00:00.000Z"); // shown when it was done
    expect(ev.find((e) => e.id === "n0")).toMatchObject({ kind: "note", body: "Asked for pricing" });
  });

  it("shows only that the lead was added when nothing else is recorded", () => {
    expect(timeline(lead()).map((e) => e.kind)).toEqual(["stage"]);
  });
});
