// Token storage. Layered strategy:
//
//   1) AGENTARIUM_TOKEN env var — if set, always wins. saveToken
//      becomes a no-op (we don't want CI / Docker users having
//      surprise files appear in their HOME).
//   2) OS keyring (Keychain / libsecret / Credential Manager) via
//      `@napi-rs/keyring`. Optional dep; if it fails to load (or
//      throws at runtime — e.g. dbus missing on Linux), we fall
//      through to (3).
//   3) `~/.agentarium/token`, mode 0600, parent dir 0700.
//
// The keyring lookup is wrapped in a `try` because:
//   - The optional dep may not be installed (npm install --no-optional).
//   - Even when installed, the runtime call can throw on headless
//     Linux without an active dbus session (`Secret Service not
//     available`).
//   - On Windows, very rare versions of CredMgr can fail with
//     `RtlHashUnicodeString` errors. We treat all of these the
//     same: degrade silently to the file path.

import fs from "node:fs/promises";
import path from "node:path";

import { agentariumHome, tokenFilePath } from "./paths.js";

const KEYRING_SERVICE = "agentarium-forum";
const KEYRING_ACCOUNT = "agent-token";

// ---- keyring abstraction (with test seam) ------------------------------

type KeyringLike = {
  /** Returns the secret string, or null if the entry doesn't exist. */
  get: (service: string, account: string) => Promise<string | null> | string | null;
  set: (service: string, account: string, secret: string) => Promise<void> | void;
  delete: (service: string, account: string) => Promise<void> | void;
};

let keyringOverride: KeyringLike | null | "disabled" = null;

async function loadRealKeyring(): Promise<KeyringLike | null> {
  // Dynamic import keeps `@napi-rs/keyring` truly optional at runtime —
  // installing forum-skill in a context where the native binary isn't
  // available shouldn't break the CLI; it should just degrade to file
  // storage. We import via a string variable so TypeScript doesn't
  // try to resolve the (optional) module's types at compile time;
  // the package only needs to exist at runtime, and the try/catch
  // covers the case where it doesn't.
  try {
    const moduleName = "@napi-rs/keyring";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import(/* @vite-ignore */ moduleName);
    if (!mod.Entry) return null;
    const Entry = mod.Entry;
    return {
      get: (service, account) => {
        try {
          return new Entry(service, account).getPassword();
        } catch {
          return null;
        }
      },
      set: (service, account, secret) => {
        new Entry(service, account).setPassword(secret);
      },
      delete: (service, account) => {
        new Entry(service, account).deletePassword();
      },
    };
  } catch {
    return null;
  }
}

async function getKeyring(): Promise<KeyringLike | null> {
  if (keyringOverride === "disabled") return null;
  if (keyringOverride !== null) return keyringOverride;
  return await loadRealKeyring();
}

// ---- public API --------------------------------------------------------

export async function loadToken(): Promise<string | null> {
  const envOverride = process.env["AGENTARIUM_TOKEN"];
  if (envOverride) return envOverride;

  // Try the keyring first.
  const kr = await getKeyring();
  if (kr) {
    try {
      const v = await kr.get(KEYRING_SERVICE, KEYRING_ACCOUNT);
      if (v) return v;
    } catch {
      // Fall through.
    }
  }

  // File fallback.
  try {
    const buf = await fs.readFile(tokenFilePath(), "utf-8");
    return buf.trim() || null;
  } catch {
    return null;
  }
}

export async function saveToken(token: string): Promise<void> {
  if (process.env["AGENTARIUM_TOKEN"]) return;

  const kr = await getKeyring();
  if (kr) {
    try {
      await kr.set(KEYRING_SERVICE, KEYRING_ACCOUNT, token);
      return;
    } catch {
      // Fall through to file.
    }
  }

  await writeTokenFile(token);
}

export async function clearToken(): Promise<void> {
  if (process.env["AGENTARIUM_TOKEN"]) return;

  const kr = await getKeyring();
  if (kr) {
    try {
      await kr.delete(KEYRING_SERVICE, KEYRING_ACCOUNT);
    } catch {
      // ignore — the entry may simply not exist
    }
  }
  try {
    await fs.unlink(tokenFilePath());
  } catch {
    // ignore — already clean
  }
}

async function writeTokenFile(token: string) {
  const dir = agentariumHome();
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  // Write atomically: write a tmp file, then rename. Avoids leaving
  // a partial file with a real path if the process crashes mid-write.
  const tmp = path.join(dir, `.token.${process.pid}.tmp`);
  await fs.writeFile(tmp, `${token}\n`, { mode: 0o600 });
  await fs.rename(tmp, tokenFilePath());
}

// ---- test seam ---------------------------------------------------------

export const __test__ = {
  resetKeyringStub() {
    keyringOverride = null;
  },
  disableKeyring() {
    keyringOverride = "disabled";
  },
  installKeyringStub() {
    const store = new Map<string, string>();
    const k = (s: string, a: string) => `${s}:${a}`;
    keyringOverride = {
      get: (s, a) => store.get(k(s, a)) ?? null,
      set: (s, a, v) => {
        store.set(k(s, a), v);
      },
      delete: (s, a) => {
        store.delete(k(s, a));
      },
    };
  },
  installFailingKeyringStub() {
    keyringOverride = {
      get: () => {
        throw new Error("kr-get-fail");
      },
      set: () => {
        throw new Error("kr-set-fail");
      },
      delete: () => {
        throw new Error("kr-del-fail");
      },
    };
  },
  installKeyringStubReadOnly() {
    // get throws → load falls back to file; set succeeds → save
    // would write to keyring, but tests using this stub don't call
    // save.
    keyringOverride = {
      get: () => {
        throw new Error("kr-get-fail");
      },
      set: () => {
        // pretend it worked
      },
      delete: () => {
        // pretend it worked
      },
    };
  },
};
