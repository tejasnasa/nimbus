/**
 * @module agent/__tests__/budget
 * @description The two self-ending timers, on fake time: the free budget and the
 * empty room.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_ROOM_MS, MeetingBudget } from "../budget.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("MeetingBudget", () => {
  it("fires the budget callback when the free time is used up", () => {
    const onBudget = vi.fn();
    const budget = new MeetingBudget({
      remainingMs: 120_000,
      onBudget,
      onEmptyRoom: vi.fn(),
    });
    budget.start();

    vi.advanceTimersByTime(119_999);
    expect(onBudget).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onBudget).toHaveBeenCalledOnce();
  });

  it("fires at once when the budget was already spent before the agent arrived", () => {
    const onBudget = vi.fn();
    new MeetingBudget({
      remainingMs: -5000,
      onBudget,
      onEmptyRoom: vi.fn(),
    }).start();

    vi.advanceTimersByTime(0);
    expect(onBudget).toHaveBeenCalledOnce();
  });

  it("has no budget timer when there is no limit", () => {
    const onBudget = vi.fn();
    new MeetingBudget({ remainingMs: null, onBudget, onEmptyRoom: vi.fn() }).start();

    vi.advanceTimersByTime(24 * 3600 * 1000);
    expect(onBudget).not.toHaveBeenCalled();
  });

  it("leaves after 60 seconds with no human in the room", () => {
    const onEmptyRoom = vi.fn();
    const budget = new MeetingBudget({
      remainingMs: null,
      onBudget: vi.fn(),
      onEmptyRoom,
    });
    budget.start();
    budget.setHumans(0);

    vi.advanceTimersByTime(EMPTY_ROOM_MS - 1);
    expect(onEmptyRoom).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onEmptyRoom).toHaveBeenCalledOnce();
  });

  it("stays when someone comes back inside the minute", () => {
    const onEmptyRoom = vi.fn();
    const budget = new MeetingBudget({
      remainingMs: null,
      onBudget: vi.fn(),
      onEmptyRoom,
    });
    budget.start();
    budget.setHumans(0);
    vi.advanceTimersByTime(30_000);
    budget.setHumans(1);

    vi.advanceTimersByTime(10 * 60_000);
    expect(onEmptyRoom).not.toHaveBeenCalled();
  });

  it("restarts the full minute each time the room empties", () => {
    const onEmptyRoom = vi.fn();
    const budget = new MeetingBudget({
      remainingMs: null,
      onBudget: vi.fn(),
      onEmptyRoom,
    });
    budget.start();
    budget.setHumans(0);
    vi.advanceTimersByTime(50_000);
    budget.setHumans(2);
    budget.setHumans(0);

    vi.advanceTimersByTime(50_000);
    expect(onEmptyRoom).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(onEmptyRoom).toHaveBeenCalledOnce();
  });

  it("does not start a second empty-room timer for repeated zero counts", () => {
    const onEmptyRoom = vi.fn();
    const budget = new MeetingBudget({
      remainingMs: null,
      onBudget: vi.fn(),
      onEmptyRoom,
      emptyRoomMs: 1000,
    });
    budget.start();
    budget.setHumans(0);
    vi.advanceTimersByTime(500);
    budget.setHumans(0);

    vi.advanceTimersByTime(500);
    expect(onEmptyRoom).toHaveBeenCalledOnce();
  });

  it("fires nothing after it is stopped, and ignores counts before it starts", () => {
    const onBudget = vi.fn();
    const onEmptyRoom = vi.fn();
    const budget = new MeetingBudget({ remainingMs: 1000, onBudget, onEmptyRoom });
    budget.setHumans(0); // not started yet
    budget.start();
    budget.setHumans(0);
    budget.stop();

    vi.advanceTimersByTime(10 * 60_000);
    expect(onBudget).not.toHaveBeenCalled();
    expect(onEmptyRoom).not.toHaveBeenCalled();
  });
});
