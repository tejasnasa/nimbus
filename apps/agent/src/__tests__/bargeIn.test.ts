/**
 * @module agent/__tests__/bargeIn
 * @description The interrupt policy on fake time: 300 ms of talking over the
 * assistant interrupts it, a cough does not, nothing happens while it is
 * silent, and stopping drops pending interruptions.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BARGE_IN_MS, BargeIn } from "../bargeIn.js";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const make = (speaking = true) => {
  const state = { speaking };
  const interrupt = vi.fn();
  const policy = new BargeIn({ isSpeaking: () => state.speaking, interrupt });
  return { state, interrupt, policy };
};

describe("BargeIn", () => {
  it("interrupts after 300 ms of talking over the assistant", () => {
    const { policy, interrupt } = make();
    policy.speechStarted("riya");
    vi.advanceTimersByTime(BARGE_IN_MS - 1);
    expect(interrupt).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(interrupt).toHaveBeenCalledOnce();
  });

  it("ignores a cough shorter than the threshold", () => {
    const { policy, interrupt } = make();
    policy.speechStarted("riya");
    vi.advanceTimersByTime(150);
    policy.speechEnded("riya");
    vi.advanceTimersByTime(BARGE_IN_MS * 2);
    expect(interrupt).not.toHaveBeenCalled();
  });

  it("does nothing while the assistant is silent", () => {
    const { policy, interrupt } = make(false);
    policy.speechStarted("riya");
    vi.advanceTimersByTime(BARGE_IN_MS * 2);
    expect(interrupt).not.toHaveBeenCalled();
  });

  it("does not interrupt if the assistant finished in the meantime", () => {
    const { policy, interrupt, state } = make();
    policy.speechStarted("riya");
    state.speaking = false;
    vi.advanceTimersByTime(BARGE_IN_MS);
    expect(interrupt).not.toHaveBeenCalled();
  });

  it("times each speaker separately and only once per stretch", () => {
    const { policy, interrupt } = make();
    policy.speechStarted("riya");
    vi.advanceTimersByTime(200);
    policy.speechStarted("riya");
    policy.speechStarted("sam");
    vi.advanceTimersByTime(100);
    expect(interrupt).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(200);
    expect(interrupt).toHaveBeenCalledTimes(2);
  });

  it("drops pending interruptions when stopped", () => {
    const { policy, interrupt } = make();
    policy.speechStarted("riya");
    policy.stop();
    vi.advanceTimersByTime(BARGE_IN_MS * 2);
    expect(interrupt).not.toHaveBeenCalled();
    policy.speechEnded("nobody");
  });
});
