/**
 * @module web/tests/components/MeetingProvider
 * @description The shared assistant state: outside the provider the call UI
 * sees "no assistant" rather than an error, and inside it every consumer reads
 * the same meeting.
 */
import "./testUtils";
import { render, screen, waitFor } from "@testing-library/react";
import { http } from "msw";
import { describe, expect, it } from "vitest";
import { MeetingProvider, useAssistant } from "../../providers/MeetingProvider";
import { server } from "../msw/server";
import { BACKEND_URL, ok } from "../msw/handlers";

function Probe({ id }: { id: string }) {
  const { meeting, segments } = useAssistant();
  return (
    <p data-testid={id}>
      {meeting ? `live:${meeting.id}` : "none"}:{segments.length}
    </p>
  );
}

describe("MeetingProvider", () => {
  it("reads as no assistant outside the provider", () => {
    render(<Probe id="a" />);

    expect(screen.getByTestId("a")).toHaveTextContent("none:0");
  });

  it("gives every consumer the live meeting and its transcript", async () => {
    server.use(
      http.get(`${BACKEND_URL}/api/meetings/live`, () =>
        ok({
          meeting: {
            id: "m1",
            workspaceId: "w1",
            status: "LIVE",
            source: "BYOK",
            startedById: null,
            startedAt: "2026-01-01T00:00:00.000Z",
            endedAt: null,
            endReason: null,
            budgetSeconds: null,
            lastSeq: 1,
          },
        }),
      ),
      http.get(`${BACKEND_URL}/api/meetings/m1/segments`, () =>
        ok({
          segments: [
            {
              id: "s1",
              meetingId: "m1",
              seq: 1,
              speakerUserId: null,
              speakerName: "Ada",
              text: "hello",
              startMs: 0,
              endMs: 500,
              language: null,
            },
          ],
          hasMore: false,
        }),
      ),
    );

    render(
      <MeetingProvider workspaceId="w1">
        <Probe id="a" />
        <Probe id="b" />
      </MeetingProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("a")).toHaveTextContent("live:m1:1"),
    );
    expect(screen.getByTestId("b")).toHaveTextContent("live:m1:1");
  });
});
