/**
 * Cross-tab auth state broadcast (audit Finding 1.4).
 *
 * Uses the Web `BroadcastChannel` API
 * (https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel)
 * to notify every same-origin tab when the auth state changes. This
 * eliminates the drift where:
 *   - Tab A signs out, Tab B keeps showing a "logged-in" UI until
 *     its next mount-on-nav or 10-minute heartbeat.
 *   - Tab A re-authenticates, Tab B keeps using its old (or absent)
 *     in-memory user state.
 *
 * Industry-standard pattern: BroadcastChannel is widely supported
 * (Chrome 54+, Firefox 38+, Safari 15.4+, Edge 79+, all modern
 * browsers) and is what Auth0, NextAuth, and similar libraries all use for
 * cross-tab session sync.
 *
 * SSR-safe: every export checks for `typeof BroadcastChannel` so it
 * works during server-side rendering without errors. The actual
 * channel is only instantiated lazily on first use.
 *
 * Channel name uses a stable string so different bundles (chat tab,
 * memory tab, signin tab) all see each other's messages.
 */

export type AuthBroadcastEvent =
  | { type: "signed-out" }
  | { type: "signed-in" }
  | { type: "session-refreshed" };

const CHANNEL_NAME = "insforge-auth";

let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  if (channel) return channel;
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
  } catch {
    channel = null;
  }
  return channel;
}

/** Publish an auth event to every other same-origin tab. */
export function broadcastAuthEvent(event: AuthBroadcastEvent): void {
  const ch = getChannel();
  if (!ch) return;
  try {
    ch.postMessage(event);
  } catch {
    // postMessage can throw if the channel was closed mid-tick — ignore.
  }
}

/**
 * Subscribe to auth events from other tabs. Returns an unsubscribe
 * function. The handler is NOT invoked for events posted by the
 * same tab — `BroadcastChannel` deliberately filters those out.
 *
 * Caller pattern:
 *   useEffect(() => subscribeAuthEvents(handler), []);
 */
export function subscribeAuthEvents(
  handler: (event: AuthBroadcastEvent) => void,
): () => void {
  const ch = getChannel();
  if (!ch) return () => {};

  const onMessage = (e: MessageEvent<AuthBroadcastEvent>) => {
    try {
      handler(e.data);
    } catch (err) {
      // Never let a handler error propagate — would break all subsequent listeners.
      console.warn("[auth-broadcast] handler threw:", err);
    }
  };

  ch.addEventListener("message", onMessage);
  return () => ch.removeEventListener("message", onMessage);
}
