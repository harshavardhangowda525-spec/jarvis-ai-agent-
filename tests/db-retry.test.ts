import { describe, it, expect, vi, afterAll } from "vitest";
import net from "node:net";
import { tuneDatabaseUrl, isConnectError, dbHost } from "@/lib/db-url";

describe("database connection settings", () => {
  it("gives a sleeping database time to wake, keeping anything already set", () => {
    const u = new URL(tuneDatabaseUrl("postgresql://u:p@ep-x-pooler.neon.tech/db?sslmode=require"));
    expect(u.searchParams.get("connect_timeout")).toBe("30");
    expect(u.searchParams.get("pool_timeout")).toBe("30");
    expect(u.searchParams.get("sslmode")).toBe("require");
    expect(new URL(tuneDatabaseUrl("postgresql://u:p@h/db?connect_timeout=60")).searchParams.get("connect_timeout")).toBe("60");
    expect(tuneDatabaseUrl("not a url")).toBe("not a url");
  });

  it("only 'couldn't connect' errors are retried (the query never ran)", () => {
    expect(isConnectError({ code: "P1001" })).toBe(true);
    expect(isConnectError(new Error("Invalid `prisma.session.findUnique()` invocation:\n\nCan't reach database server at `ep-x.neon.tech:5432`"))).toBe(true);
    expect(isConnectError({ code: "P2024", message: "Timed out fetching a new connection from the connection pool." })).toBe(true);
    expect(isConnectError({ code: "P2002", message: "Unique constraint failed" })).toBe(false);
    expect(isConnectError(new Error("relation does not exist"))).toBe(false);
    expect(dbHost("postgresql://u:secret@ep-x.neon.tech/db")).toBe("ep-x.neon.tech:5432");
  });
});

// A database that is "asleep" for ~2 s: nothing listens, then a proxy to the real one appears.
const REAL = process.env.DATABASE_URL ?? "";
const tcp = /^postgres(ql)?:\/\//.test(REAL) ? REAL : "";
const PORT = 55_000 + Math.floor(Math.random() * 400);

const d = tcp ? describe : describe.skip;
d("a database that's still waking up", () => {
  let proxy: net.Server | null = null;
  afterAll(() => { proxy?.close(); });

  it("the query waits and succeeds instead of failing with \"Can't reach database server\"", async () => {
    const real = new URL(tcp);
    const target = { host: real.searchParams.get("host") ? "127.0.0.1" : real.hostname, port: Number(real.port || 5432) };
    real.searchParams.delete("host");
    real.hostname = "127.0.0.1"; real.port = String(PORT);
    vi.resetModules();
    process.env.DATABASE_URL = real.toString();
    const { getDb } = await import("@/lib/db");
    setTimeout(() => {
      proxy = net.createServer((c) => { const s = net.connect(target); c.pipe(s).pipe(c); c.on("error", () => s.destroy()); s.on("error", () => c.destroy()); }).listen(PORT, "127.0.0.1");
    }, 2_000);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t0 = Date.now();
    const rows = await getDb().$queryRaw<{ n: number }[]>`SELECT 1::int AS n`;
    expect(rows[0].n).toBe(1);
    expect(Date.now() - t0).toBeGreaterThan(1_500); // it really had to wait
    expect(warn.mock.calls.map((c) => String(c[0])).join(" ")).toMatch(/it may be waking up; retrying/);
    await getDb().$disconnect();
    process.env.DATABASE_URL = REAL;
  }, 30_000);
});
