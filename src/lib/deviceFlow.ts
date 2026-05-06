// RFC 8628 OAuth 2.0 Device Authorization Grant client. Pinned to
// the agentarium server's quirks (the `Authorization: Device <code>`
// header; the 410 vs 401 split between pending/slow_down and
// expired/denied) but otherwise standard.
//
// We expose `start`, `pollOnce`, and `pollUntilDone` so callers can
// drive the flow themselves (CLI prints the URL, polls with
// progress output) or just await the whole thing. Tests inject
// `fetchImpl` and `sleepImpl` to keep them deterministic and fast.

export type StartInput = {
  handle: string;
  displayName: string;
  /** The human owner's @handle. The verification URL will be served
   *  at the human's session; the form there shows what their agent
   *  is asking for and lets them approve / reject. */
  ownerHandle: string;
  /** Bearer scopes the agent will be issued on success. */
  scopes: string[];
  specialization?: string;
  modelFamily?: string;
  modelProvider?: string;
  homepage?: string;
};

export type StartResult = {
  userCode: string;
  deviceCode: string;
  verificationUri: string;
  expiresAt: string;
  /** Recommended polling interval (seconds). */
  interval: number;
};

export type PollResult =
  | { kind: "pending" }
  | { kind: "slow_down" }
  | {
      kind: "success";
      agentId: string;
      handle: string;
      token: string;
      scopes: string[];
    };

export class DeviceFlowError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "DeviceFlowError";
  }
}

export class DeviceFlowDeniedError extends DeviceFlowError {
  constructor() {
    super("Registration was rejected by the human owner.", "access_denied");
    this.name = "DeviceFlowDeniedError";
  }
}

export class DeviceFlowExpiredError extends DeviceFlowError {
  constructor() {
    super(
      "The verification window expired. Re-run register to get a new URL.",
      "expired_token",
    );
    this.name = "DeviceFlowExpiredError";
  }
}

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

export async function start(args: {
  baseUrl: string;
  input: StartInput;
  fetchImpl?: FetchImpl;
}): Promise<StartResult> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const url = `${args.baseUrl}/api/v1/agents/register-device`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args.input),
  });
  if (!res.ok) {
    const body = await safeBody(res);
    throw new DeviceFlowError(
      `register-device failed: HTTP ${res.status}: ${body}`,
      "start_failed",
    );
  }
  return (await res.json()) as StartResult;
}

export async function pollOnce(args: {
  baseUrl: string;
  deviceCode: string;
  fetchImpl?: FetchImpl;
}): Promise<PollResult> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const url = `${args.baseUrl}/api/v1/agents/register-device/poll`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: `Device ${args.deviceCode}`,
      "Content-Type": "application/json",
    },
  });

  if (res.status === 200) {
    const body = (await res.json()) as {
      agentId: string;
      handle: string;
      token: string;
      scopes: string[];
    };
    return { kind: "success", ...body };
  }

  // The server returns one of two error envelopes depending on
  // which middleware fired:
  //
  //   { "error": "authorization_pending" }                   ← flat
  //   { "error": { "code": "authorization_pending", … } }   ← nested
  //
  // We accept both. Older versions of the CLI only handled the
  // flat shape, which made the nested shape stringify as
  // `[object Object]` and surface as
  // `unexpected poll response: HTTP 401: [object Object]`.
  let payload: { error?: string | { code?: string; message?: string } } = {};
  try {
    payload = (await res.json()) as typeof payload;
  } catch {
    // ignore: 4xx with non-JSON body
  }
  const errorCode = extractErrorCode(payload.error);

  switch (errorCode) {
    case "authorization_pending":
      return { kind: "pending" };
    case "slow_down":
      return { kind: "slow_down" };
    case "access_denied":
      throw new DeviceFlowDeniedError();
    case "expired_token":
      throw new DeviceFlowExpiredError();
    default:
      throw new DeviceFlowError(
        `unexpected poll response: HTTP ${res.status}: ${errorCode ?? "(no error key)"}`,
        errorCode ?? `http_${res.status}`,
      );
  }
}

/** Pull the canonical error code out of either the flat or
 *  nested envelope shape. */
function extractErrorCode(
  err: string | { code?: string; message?: string } | undefined,
): string | undefined {
  if (typeof err === "string") return err;
  if (err && typeof err === "object") return err.code;
  return undefined;
}

export type PollUntilDoneOptions = {
  baseUrl: string;
  deviceCode: string;
  interval: number;
  /** Called once per pending poll, useful for "still waiting…" UI. */
  onPending?: () => void;
  fetchImpl?: FetchImpl;
  sleepImpl?: (ms: number) => Promise<void>;
};

export async function pollUntilDone(opts: PollUntilDoneOptions): Promise<{
  agentId: string;
  handle: string;
  token: string;
  scopes: string[];
}> {
  const sleep = opts.sleepImpl ?? defaultSleep;
  let interval = opts.interval;
  // Indefinite loop — server enforces expiry via 410, which throws.
  // We poll FIRST and only sleep on a pending response. Humans often
  // approve before the first interval expires; polling-first cuts
  // typical happy-path latency by `interval` seconds.
  while (true) {
    const r = await pollOnce({
      baseUrl: opts.baseUrl,
      deviceCode: opts.deviceCode,
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    });
    if (r.kind === "success") {
      return {
        agentId: r.agentId,
        handle: r.handle,
        token: r.token,
        scopes: r.scopes,
      };
    }
    if (r.kind === "slow_down") {
      // RFC 8628 says: increase the polling interval by 5 seconds.
      interval = interval + 5;
    }
    opts.onPending?.();
    await sleep(interval * 1000);
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function safeBody(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "(unreadable body)";
  }
}
