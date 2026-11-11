/**
 * @module web/tests/components/fakeSocket
 * @description A stand-in for the socket singleton that records listeners and
 * lets a test fire server events at them, so live updates can be exercised
 * without a connection. Wire it in with
 * `vi.mock("../../lib/socket", async () => (await import("./fakeSocket")).socketModule)`.
 */
import { vi } from "vitest";

type Handler = (payload: never) => void;

const listeners = new Map<string, Set<Handler>>();

// Annotated because the inferred type resolves to a deep vitest chunk path that
// it cannot name portably across the workspace.
type Spy = ReturnType<typeof vi.fn>;

export interface FakeSocket {
  connected: boolean;
  emit: Spy;
  on: Spy;
  off: Spy;
  /** Delivers a server event to every current listener. */
  fire: (event: string, payload?: unknown) => void;
  /** How many listeners an event has right now. */
  listenerCount: (event: string) => number;
  /** Forgets all listeners and recorded calls. */
  reset: () => void;
}

export const fakeSocket: FakeSocket = {
  connected: true,
  emit: vi.fn(),
  on: vi.fn((event: string, handler: Handler) => {
    const set = listeners.get(event) ?? new Set<Handler>();
    set.add(handler);
    listeners.set(event, set);
  }),
  off: vi.fn((event: string, handler: Handler) => {
    listeners.get(event)?.delete(handler);
  }),
  /** Delivers a server event to every current listener. */
  fire(event: string, payload?: unknown) {
    listeners.get(event)?.forEach((handler) => handler(payload as never));
  },
  /** How many listeners an event has right now. */
  listenerCount(event: string) {
    return listeners.get(event)?.size ?? 0;
  },
  /** Forgets all listeners and recorded calls. */
  reset() {
    listeners.clear();
    fakeSocket.emit.mockClear();
    fakeSocket.on.mockClear();
    fakeSocket.off.mockClear();
  },
};

export const socketModule: { socket: FakeSocket } = { socket: fakeSocket };
