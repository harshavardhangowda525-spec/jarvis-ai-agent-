import { describe, it, expect, afterEach } from "vitest";
import { requestOrigin, callbackUrl } from "@/lib/integrations/providers";

const req = (headers: Record<string, string>) => new Request("http://internal/api", { headers });

describe("OAuth redirect URL follows the domain the user is on", () => {
  afterEach(() => { delete process.env.OAUTH_REDIRECT_BASE; });

  it("uses the forwarded host/proto from Vercel", () => {
    const o = requestOrigin(req({ "x-forwarded-host": "jarvis-ai-agent-self.vercel.app", "x-forwarded-proto": "https" }));
    expect(callbackUrl("google", o)).toBe("https://jarvis-ai-agent-self.vercel.app/api/integrations/google/callback");
  });
  it("defaults to https for real domains and http for localhost", () => {
    expect(requestOrigin(req({ host: "jarvis.example.com" }))).toBe("https://jarvis.example.com");
    expect(requestOrigin(req({ host: "localhost:3000" }))).toBe("http://localhost:3000");
  });
  it("OAUTH_REDIRECT_BASE pins it when set", () => {
    process.env.OAUTH_REDIRECT_BASE = "https://my.domain.com/";
    expect(requestOrigin(req({ host: "other.vercel.app" }))).toBe("https://my.domain.com");
  });
});
