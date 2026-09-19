/**
 * @module web/tests/components/Canvas
 * @description Smoke coverage for the Excalidraw whiteboard. The whiteboard
 * itself is not exercised (that would be simulating collaborative editing);
 * what is asserted is the contract the component owns: it mounts its editor
 * without pulling in the real Excalidraw bundle, joins the document room on
 * mount, subscribes to the state events for that room, and leaves the room on
 * unmount.
 */
import "./testUtils";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Canvas from "../../components/Canvas";

vi.mock("@excalidraw/excalidraw", () => ({
  Excalidraw: () => <div data-testid="excalidraw" />,
}));

const socket = vi.hoisted(() => ({
  emit: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
}));

vi.mock("../../lib/socket", () => ({ socket }));

const documentId = "cm_document_00000000000001";

describe("Canvas", () => {
  it("mounts its whiteboard without throwing", async () => {
    render(<Canvas initialElements={[]} documentId={documentId} />);

    expect(await screen.findByTestId("excalidraw")).toBeInTheDocument();
  });

  it("joins the document's canvas room on mount", () => {
    render(<Canvas initialElements={[]} documentId={documentId} />);

    expect(socket.emit).toHaveBeenCalledWith("canvas:join", documentId);
  });

  it("subscribes to the room's state and update events", () => {
    render(<Canvas initialElements={[]} documentId={documentId} />);

    const subscribed = socket.on.mock.calls.map(([event]) => event);
    expect(subscribed).toEqual(
      expect.arrayContaining(["canvas:state", "canvas:update"]),
    );
  });

  it("leaves the room and drops its listeners on unmount", () => {
    const { unmount } = render(
      <Canvas initialElements={[]} documentId={documentId} />,
    );

    unmount();

    expect(socket.emit).toHaveBeenCalledWith("canvas:leave", documentId);
    const unsubscribed = socket.off.mock.calls.map(([event]) => event);
    expect(unsubscribed).toEqual(
      expect.arrayContaining(["canvas:state", "canvas:update"]),
    );
  });

  it("does not join a room when it has no document to join", () => {
    render(<Canvas initialElements={[]} documentId="" />);

    expect(socket.emit).not.toHaveBeenCalledWith("canvas:join", "");
  });
});
