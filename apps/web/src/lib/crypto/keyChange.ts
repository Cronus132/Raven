/**
 * Key-change detection. Identity keys are public, so we remember the last one
 * we saw per contact (in localStorage) and flag when it changes — a new key can
 * mean the contact reinstalled, or a key-substituting (MITM) server. The UI then
 * shows an unverified/changed trust state until the user re-checks the safety
 * number out of band.
 */

export type KeyState = "first" | "unchanged" | "changed";

/** Pure classification — testable without storage. */
export function classifyKey(previous: string | undefined, next: string): KeyState {
  if (previous === undefined) return "first";
  return previous === next ? "unchanged" : "changed";
}

const STORE_KEY = "raven.peerkeys";

function load(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}");
  } catch {
    return {};
  }
}
function save(map: Record<string, string>): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(map));
  } catch {
    /* storage unavailable */
  }
}

/** Record the current identity key for a contact and report whether it changed. */
export function recordAndCheck(userId: string, identityKeyB64: string): KeyState {
  const map = load();
  const state = classifyKey(map[userId], identityKeyB64);
  map[userId] = identityKeyB64;
  save(map);
  return state;
}

export function forgetPeerKey(userId: string): void {
  const map = load();
  delete map[userId];
  save(map);
}
