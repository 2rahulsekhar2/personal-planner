import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  supabaseAdmin: vi.fn(),
  supabaseServer: vi.fn(),
  sendToUser: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  supabaseAdmin: mocks.supabaseAdmin,
  supabaseServer: mocks.supabaseServer,
}));
vi.mock("@/lib/push-server", () => ({ sendToUser: mocks.sendToUser }));

import { GET as cronGET, POST as cronPOST } from "@/app/api/cron/reminders/route";
import { POST as subscribe, DELETE as unsubscribe } from "@/app/api/push/subscribe/route";
import { POST as sendTest } from "@/app/api/push/test/route";

interface WriteCall {
  table: string;
  op: string;
  args: unknown[];
  filters: [string, unknown][];
}

/** Records every write the route makes through the service-role client. */
function fakeAdmin(opts: { rpc?: { data: unknown; error: { message: string } | null }; writeError?: { message: string } } = {}) {
  const calls: WriteCall[] = [];
  const from = (table: string) => {
    const start = (op: string) => (...args: unknown[]) => {
      const call: WriteCall = { table, op, args, filters: [] };
      calls.push(call);
      const chain = {
        eq: (column: string, value: unknown) => {
          call.filters.push([column, value]);
          return chain;
        },
        then: (resolve: (v: { error: { message: string } | null }) => void) => resolve({ error: opts.writeError ?? null }),
      };
      return chain;
    };
    return { update: start("update"), upsert: start("upsert"), delete: start("delete") };
  };
  const admin = { calls, from, rpc: vi.fn(async () => opts.rpc ?? { data: [], error: null }) };
  mocks.supabaseAdmin.mockReturnValue(admin);
  return admin;
}

function signInAs(user: { id: string } | null) {
  mocks.supabaseServer.mockResolvedValue({ auth: { getUser: async () => ({ data: { user } }) } });
}

const req = (method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api", {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });

const SUB = { endpoint: "https://push.example/abc", keys: { p256dh: "p", auth: "a" } };

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/api/cron/reminders", () => {
  const authed = () => req("POST", undefined, { authorization: "Bearer s3cret" });

  it("rejects a missing or wrong secret without claiming reminders", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    const admin = fakeAdmin();
    expect((await cronPOST(req("POST"))).status).toBe(401);
    expect((await cronGET(req("GET", undefined, { authorization: "Bearer nope" }))).status).toBe(401);
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("rejects everything when CRON_SECRET is not configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    fakeAdmin();
    const res = await cronPOST(req("POST", undefined, { authorization: "Bearer undefined" }));
    expect(res.status).toBe(401);
  });

  it("returns 500 when claiming fails", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    fakeAdmin({ rpc: { data: null, error: { message: "db down" } } });
    const res = await cronPOST(authed());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "db down" });
    expect(mocks.sendToUser).not.toHaveBeenCalled();
  });

  it("marks delivered reminders sent and undelivered ones failed, only while still 'sending'", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    const admin = fakeAdmin({
      rpc: {
        data: [
          { id: "r1", user_id: "u1", title: "Cricket", body: "in 30 min" },
          { id: "r2", user_id: "u2", title: "Dentist", body: "in 1 hour" },
        ],
        error: null,
      },
    });
    mocks.sendToUser
      .mockResolvedValueOnce({ devices: 2, delivered: 2, failed: 0 })
      .mockResolvedValueOnce({ devices: 1, delivered: 0, failed: 1 });

    const res = await cronGET(authed());

    expect(await res.json()).toEqual({ claimed: 2, delivered: 2 });
    expect(admin.rpc).toHaveBeenCalledWith("claim_due_reminders", { batch_size: 100 });
    expect(mocks.sendToUser).toHaveBeenNthCalledWith(1, admin, "u1", {
      title: "Cricket", body: "in 30 min", tag: "r1", url: "/",
    });
    expect(admin.calls.map((c) => [c.table, c.op, (c.args[0] as { status: string }).status, c.filters])).toEqual([
      ["reminders", "update", "sent", [["id", "r1"], ["status", "sending"]]],
      ["reminders", "update", "failed", [["id", "r2"], ["status", "sending"]]],
    ]);
  });

  it("leaves a reminder untouched for retry when sending throws", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    const admin = fakeAdmin({ rpc: { data: [{ id: "r1", user_id: "u1", title: "t", body: "b" }], error: null } });
    mocks.sendToUser.mockRejectedValueOnce(new Error("boom"));

    const res = await cronPOST(authed());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ claimed: 1, delivered: 0 });
    expect(admin.calls).toEqual([]);
  });
});

describe("/api/push/subscribe", () => {
  it("POST requires sign-in", async () => {
    signInAs(null);
    const admin = fakeAdmin();
    expect((await subscribe(req("POST", { subscription: SUB }))).status).toBe(401);
    expect(admin.calls).toEqual([]);
  });

  it("POST rejects malformed bodies", async () => {
    signInAs({ id: "u1" });
    const admin = fakeAdmin();
    for (const body of ["not json", {}, { subscription: { endpoint: SUB.endpoint } }, { subscription: { ...SUB, keys: { p256dh: "p" } } }]) {
      expect((await subscribe(req("POST", body))).status).toBe(400);
    }
    expect(admin.calls).toEqual([]);
  });

  it("POST upserts the subscription for the signed-in user, keyed by endpoint", async () => {
    signInAs({ id: "u1" });
    const admin = fakeAdmin();
    const res = await subscribe(req("POST", { subscription: SUB, user_id: "someone-else" }, { "user-agent": "x".repeat(400) }));

    expect(await res.json()).toEqual({ ok: true });
    expect(admin.calls).toHaveLength(1);
    const [call] = admin.calls;
    expect([call.table, call.op]).toEqual(["push_subscriptions", "upsert"]);
    expect(call.args).toEqual([
      { user_id: "u1", endpoint: SUB.endpoint, p256dh: "p", auth: "a", user_agent: "x".repeat(300) },
      { onConflict: "endpoint" },
    ]);
  });

  it("POST returns 500 when the database rejects the write", async () => {
    signInAs({ id: "u1" });
    fakeAdmin({ writeError: { message: "nope" } });
    const res = await subscribe(req("POST", { subscription: SUB }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "nope" });
  });

  it("DELETE requires sign-in and an endpoint", async () => {
    const admin = fakeAdmin();
    signInAs(null);
    expect((await unsubscribe(req("DELETE", { endpoint: SUB.endpoint }))).status).toBe(401);
    signInAs({ id: "u1" });
    expect((await unsubscribe(req("DELETE", {}))).status).toBe(400);
    expect(admin.calls).toEqual([]);
  });

  it("DELETE removes only the signed-in user's subscription", async () => {
    signInAs({ id: "u1" });
    const admin = fakeAdmin();
    const res = await unsubscribe(req("DELETE", { endpoint: SUB.endpoint }));

    expect(await res.json()).toEqual({ ok: true });
    expect(admin.calls).toEqual([
      { table: "push_subscriptions", op: "delete", args: [], filters: [["endpoint", SUB.endpoint], ["user_id", "u1"]] },
    ]);
  });
});

describe("/api/push/test", () => {
  it("requires sign-in", async () => {
    signInAs(null);
    fakeAdmin();
    expect((await sendTest()).status).toBe(401);
    expect(mocks.sendToUser).not.toHaveBeenCalled();
  });

  it("sends to the signed-in user and returns the delivery counts", async () => {
    signInAs({ id: "u1" });
    const admin = fakeAdmin();
    mocks.sendToUser.mockResolvedValueOnce({ devices: 1, delivered: 1, failed: 0 });

    const res = await sendTest();

    expect(await res.json()).toEqual({ devices: 1, delivered: 1, failed: 0 });
    expect(mocks.sendToUser).toHaveBeenCalledWith(admin, "u1", expect.objectContaining({ tag: "test" }));
  });
});

describe("POST /auth/exists", () => {
  const ask = async (email: unknown) => {
    const { POST } = await import("@/app/auth/exists/route");
    const res = await POST(new Request("http://x/auth/exists", { method: "POST", body: JSON.stringify({ email }) }));
    return { status: res.status, body: await res.json() };
  };
  const users = (list: string[]) =>
    mocks.supabaseAdmin.mockReturnValue({
      auth: { admin: { listUsers: async () => ({ data: { users: list.map((email) => ({ email })) }, error: null }) } },
    });

  it("finds a registered email whatever its case", async () => {
    users(["me@example.com"]);
    expect(await ask(" Me@Example.com ")).toEqual({ status: 200, body: { exists: true } });
  });

  it("reports an unknown email as not registered", async () => {
    users(["me@example.com"]);
    expect(await ask("new@example.com")).toEqual({ status: 200, body: { exists: false } });
  });

  it("rejects a request without an email", async () => {
    users([]);
    expect((await ask(undefined)).status).toBe(400);
  });
});
