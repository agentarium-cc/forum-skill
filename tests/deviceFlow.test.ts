// Tests for lib/deviceFlow — the RFC 8628 polling client. We
// exercise:
//
//   1) start() POSTs registration intent and returns the
//      verification details.
//   2) poll() handles each terminal-vs-pending state correctly:
//      authorization_pending (keep going), slow_down (extend
//      interval), success (return token), access_denied (throw),
//      expired_token (throw).
//   3) pollUntilDone() sleeps for the right duration and respects
//      slow_down by adding 5s.
//
// We feed the client a stub `fetchImpl` and a fake `sleepImpl` so
// the tests never actually wait.

import { describe, expect, it, vi } from "vitest";

import {
  DeviceFlowDeniedError,
  DeviceFlowExpiredError,
  pollOnce,
  pollUntilDone,
  start,
} from "../src/lib/deviceFlow.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("start()", () => {
  it("POSTs registration intent and returns verification details", async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return jsonResponse(202, {
        userCode: "AGTM-7K3F",
        deviceCode: "dev_secret",
        verificationUri: "https://forum.agentarium.cc/agents/verify/AGTM-7K3F",
        expiresAt: "2026-05-06T18:00:00Z",
        interval: 5,
      });
    });
    const out = await start({
      baseUrl: "https://api.test",
      input: {
        handle: "next-medic",
        displayName: "Next-Medic",
        ownerHandle: "henry",
        scopes: ["forum:write"],
      },
      fetchImpl,
    });
    expect(out.userCode).toBe("AGTM-7K3F");
    expect(out.verificationUri).toBe(
      "https://forum.agentarium.cc/agents/verify/AGTM-7K3F",
    );
    expect(calls[0]!.url).toBe("https://api.test/api/v1/agents/register-device");
  });
});

describe("pollOnce()", () => {
  const baseUrl = "https://api.test";
  const deviceCode = "dev_secret";

  it("returns 'pending' on authorization_pending", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(401, { error: "authorization_pending" }),
    );
    const r = await pollOnce({ baseUrl, deviceCode, fetchImpl });
    expect(r.kind).toBe("pending");
  });

  it("returns 'slow_down' on slow_down", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(401, { error: "slow_down" }));
    const r = await pollOnce({ baseUrl, deviceCode, fetchImpl });
    expect(r.kind).toBe("slow_down");
  });

  it("returns the token on success", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        agentId: "abc",
        handle: "next-medic",
        token: "agnt_x_y",
        scopes: ["forum:write"],
      }),
    );
    const r = await pollOnce({ baseUrl, deviceCode, fetchImpl });
    expect(r.kind).toBe("success");
    if (r.kind === "success") {
      expect(r.token).toBe("agnt_x_y");
      expect(r.handle).toBe("next-medic");
    }
  });

  it("throws DeviceFlowDeniedError on access_denied", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(410, { error: "access_denied" }),
    );
    await expect(pollOnce({ baseUrl, deviceCode, fetchImpl })).rejects.toBeInstanceOf(
      DeviceFlowDeniedError,
    );
  });

  // The agentarium server returns a NESTED error envelope:
  //   { "error": { "code": "...", "message": "..." } }
  // We had a bug where we only handled the flat shape; the
  // nested shape silently stringified to `[object Object]`,
  // which surfaced to the user as
  //   "unexpected poll response: HTTP 401: [object Object]"
  // and broke registration end-to-end. These tests lock in that
  // both envelope shapes work.

  it("returns 'pending' when error is nested as { code: 'authorization_pending' }", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(401, { error: { code: "authorization_pending", message: "" } }),
    );
    const r = await pollOnce({ baseUrl, deviceCode, fetchImpl });
    expect(r.kind).toBe("pending");
  });

  it("throws DeviceFlowDeniedError when error is nested as { code: 'access_denied' }", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(410, { error: { code: "access_denied", message: "human rejected" } }),
    );
    await expect(pollOnce({ baseUrl, deviceCode, fetchImpl })).rejects.toBeInstanceOf(
      DeviceFlowDeniedError,
    );
  });

  it("throws DeviceFlowExpiredError when error is nested as { code: 'expired_token' }", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(410, { error: { code: "expired_token", message: "" } }),
    );
    await expect(pollOnce({ baseUrl, deviceCode, fetchImpl })).rejects.toBeInstanceOf(
      DeviceFlowExpiredError,
    );
  });

  it("throws DeviceFlowExpiredError on expired_token", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(410, { error: "expired_token" }),
    );
    await expect(pollOnce({ baseUrl, deviceCode, fetchImpl })).rejects.toBeInstanceOf(
      DeviceFlowExpiredError,
    );
  });
});

describe("pollUntilDone()", () => {
  const baseUrl = "https://api.test";

  it("returns the token after a few pending pings", async () => {
    let i = 0;
    const fetchImpl = vi.fn(async () => {
      i++;
      if (i < 3) return jsonResponse(401, { error: "authorization_pending" });
      return jsonResponse(200, {
        agentId: "abc",
        handle: "next-medic",
        token: "agnt_z",
        scopes: ["forum:write"],
      });
    });
    const sleeps: number[] = [];
    const sleepImpl = async (ms: number) => {
      sleeps.push(ms);
    };
    const out = await pollUntilDone({
      baseUrl,
      deviceCode: "dev_x",
      interval: 5,
      fetchImpl,
      sleepImpl,
    });
    expect(out.token).toBe("agnt_z");
    expect(sleeps).toEqual([5000, 5000]);
  });

  it("extends the interval on slow_down", async () => {
    let i = 0;
    const fetchImpl = vi.fn(async () => {
      i++;
      if (i === 1) return jsonResponse(401, { error: "slow_down" });
      return jsonResponse(200, {
        agentId: "a",
        handle: "h",
        token: "agnt_t",
        scopes: [],
      });
    });
    const sleeps: number[] = [];
    const sleepImpl = async (ms: number) => {
      sleeps.push(ms);
    };
    await pollUntilDone({
      baseUrl,
      deviceCode: "d",
      interval: 5,
      fetchImpl,
      sleepImpl,
    });
    // poll(slow_down) → bump interval to 10s → sleep 10s → poll(success).
    // We poll first, so only one sleep happens; it's the bumped value.
    expect(sleeps).toEqual([10000]);
  });

  it("propagates denied / expired errors", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(410, { error: "access_denied" }),
    );
    await expect(
      pollUntilDone({
        baseUrl,
        deviceCode: "d",
        interval: 5,
        fetchImpl,
        sleepImpl: async () => {},
      }),
    ).rejects.toBeInstanceOf(DeviceFlowDeniedError);
  });
});
