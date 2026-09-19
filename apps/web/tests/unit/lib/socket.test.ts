/**
 * @module web/tests/unit/lib/socket
 * @description Pins the client socket singleton's configuration contract.
 *
 * The socket is created at module load from `NEXT_PUBLIC_BACKEND_URL`, so the
 * module is re-imported per test with a stubbed env. `socket.io-client` is
 * mocked — this asserts *how the client is configured*, not the transport.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// Typed via a function signature (rather than declared params) so `mock.calls[n]`
// is a 2-tuple instead of `[]`, without introducing unused parameters.
const ioMock = vi.fn<
  (url: string, options?: Record<string, unknown>) => { fake: string }
>();
ioMock.mockReturnValue({ fake: "socket" });

vi.mock("socket.io-client", () => ({ io: ioMock }));

const importSocketModule = () => import("../../../lib/socket");

describe("web/lib/socket", () => {
  beforeEach(() => {
    vi.resetModules();
    ioMock.mockClear();
    vi.stubEnv("NEXT_PUBLIC_BACKEND_URL", "http://localhost:3001");
  });

  it("connects to NEXT_PUBLIC_BACKEND_URL", async () => {
    await importSocketModule();

    expect(ioMock).toHaveBeenCalledTimes(1);
    expect(ioMock.mock.calls[0]?.[0]).toBe("http://localhost:3001");
  });

  it("sends credentials, so the handshake carries the session cookie", async () => {
    await importSocketModule();

    expect(ioMock.mock.calls[0]?.[1]).toMatchObject({ withCredentials: true });
  });

  it("does not auto-connect — SocketProvider owns the lifecycle", async () => {
    await importSocketModule();

    expect(ioMock.mock.calls[0]?.[1]).toMatchObject({ autoConnect: false });
  });
});
