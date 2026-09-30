import { describe, it, expect, afterEach, vi } from "vitest";
vi.hoisted(() => { process.env.SEARCH_API_KEY = "tvly-test"; process.env.FOURSQUARE_API_KEY = "fsq-test"; });
import { phonesInText, phoneFromResults } from "@/lib/darwin/daily/verify";
import { webSearchSignal, foursquarePhone } from "@/lib/darwin/daily/checks";

describe("phone numbers from public pages", () => {
  it("reads Indian numbers in every common format, and skips what isn't a business line", () => {
    expect(phonesInText("Call 098450 12345 now")).toEqual(["+91 98450 12345"]);
    expect(phonesInText("+91 98450-12345 · tel:+919845012345")).toEqual(["+91 98450 12345"]); // once
    expect(phonesInText("Ph: 080-2345 6789")).toEqual(["+91 8023456789"]);
    expect(phonesInText("Customer care 1800 123 4567 · Justdial 088888 88888 · pin 560038 · ₹4,999")).toEqual([]);
  });

  it("only takes a number from results that name the business; one mention needs a listing page or the locality", () => {
    const name = "Iron Temple Fitness", place = "Indiranagar, Bengaluru";
    // a directory page naming the business → yes
    expect(phoneFromResults([{ url: "https://www.justdial.com/Bangalore/Iron-Temple", title: "Iron Temple Fitness, Indiranagar", content: "Call 098450 12345" }], name, place))
      .toEqual({ phone: "+91 98450 12345", source: "www.justdial.com" });
    // a page about another business → never
    expect(phoneFromResults([{ url: "https://www.justdial.com/x", title: "Gold's Gym Koramangala", content: "Call 098450 55555" }], name, place)).toBeNull();
    // one random page, no locality → not enough
    expect(phoneFromResults([{ url: "https://blog.example.com/best-gyms", title: "Iron Temple Fitness review", content: "Phone 098450 66666" }], name, place)).toBeNull();
    // the same number on two pages naming it → yes
    expect(phoneFromResults([
      { url: "https://blog.example.com/a", title: "Iron Temple Fitness review", content: "Phone 098450 66666" },
      { url: "https://news.example.com/b", title: "Iron Temple Fitness opens", content: "Contact 98450 66666" },
    ], name, place)?.phone).toBe("+91 98450 66666");
  });
});

describe("the sources DARWIN asks (stubbed)", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  it("web search: asks for the contact number when the listing has none, and returns it", async () => {
    let query = "";
    globalThis.fetch = (async (_u: RequestInfo | URL, init?: RequestInit) => {
      query = JSON.parse(String(init?.body)).query;
      return Response.json({ results: [
        { url: "https://www.justdial.com/Bangalore/Iron-Temple-Fitness", title: "Iron Temple Fitness in Indiranagar, Bangalore", content: "Iron Temple Fitness · Contact 098450 12345 · Gym" },
        { url: "https://www.instagram.com/irontemplefitness/", title: "Iron Temple Fitness (@irontemplefitness)", content: "" },
      ] });
    }) as typeof fetch;
    const s = await webSearchSignal("Iron Temple Fitness", "Indiranagar, Bengaluru", true);
    expect(query).toBe('"Iron Temple Fitness" Indiranagar, Bengaluru contact number');
    expect(s.phone).toEqual({ phone: "+91 98450 12345", source: "www.justdial.com" });
    expect(s.social).toHaveLength(1);
  });

  it("Foursquare: the nearby place with the same name, via either key generation", async () => {
    const hits: string[] = [];
    globalThis.fetch = (async (u: RequestInfo | URL) => {
      const url = String(u); hits.push(new URL(url).host);
      if (url.includes("places-api.foursquare.com")) return new Response("{}", { status: 401 }); // an older key
      return Response.json({ results: [{ name: "Some Other Gym", tel: "080 1111 2222" }, { name: "Iron Temple Fitness", tel: "+91 98450 33333", distance: 40 }] });
    }) as typeof fetch;
    expect(await foursquarePhone("Iron Temple Fitness", 12.97, 77.64)).toEqual({ phone: "+91 98450 33333", source: "Foursquare" });
    expect(hits).toEqual(["places-api.foursquare.com", "api.foursquare.com"]);
  });
});
