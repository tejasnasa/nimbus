/**
 * @module web/tests/components/DocEditorRefContext
 * @description Contract of the ref-based `addTab` bridge: it is a provider-only
 * hook, the ref starts empty, a writer and a reader anywhere in the tree share
 * the same mutable ref object, and that object's identity survives re-renders
 * (so consumers are never re-rendered just because a callback was replaced).
 */
import "./testUtils";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  DocEditorRefProvider,
  useDocEditorRef,
} from "../../components/DocEditorRefContext";
import type { ClientDocument } from "../../api/document";

const doc: ClientDocument = {
  id: "cm_document_00000000000000",
  label: "New Document",
  type: "MARKDOWN",
  elements: [],
  yjsState: null,
};

/** Writes an `addTab` implementation into the shared ref. */
function Writer({ onSet }: { onSet: (id: string) => void }) {
  const ref = useDocEditorRef();
  return (
    <button
      onClick={() => {
        ref.current = (opened) => onSet(opened.id);
      }}
    >
      install
    </button>
  );
}

/** Invokes whatever `addTab` the shared ref currently holds. */
function Reader() {
  const ref = useDocEditorRef();
  return <button onClick={() => ref.current?.(doc)}>open</button>;
}

describe("DocEditorRefContext", () => {
  it("refuses to be used outside its provider", () => {
    function Orphan() {
      useDocEditorRef();
      return null;
    }

    expect(() => render(<Orphan />)).toThrow(
      /must be used within DocEditorRefProvider/,
    );
  });

  it("starts with no callback installed", () => {
    let current: unknown = "unset";

    function Probe() {
      current = useDocEditorRef().current;
      return null;
    }

    render(
      <DocEditorRefProvider>
        <Probe />
      </DocEditorRefProvider>,
    );

    expect(current).toBeNull();
  });

  it("lets a sibling open a document through the shared ref", async () => {
    const user = userEvent.setup();
    const onSet = vi.fn();

    render(
      <DocEditorRefProvider>
        <Writer onSet={onSet} />
        <Reader />
      </DocEditorRefProvider>,
    );

    await user.click(screen.getByRole("button", { name: "install" }));
    await user.click(screen.getByRole("button", { name: "open" }));

    expect(onSet).toHaveBeenCalledWith(doc.id);
  });

  it("is a no-op before any callback is installed", async () => {
    const user = userEvent.setup();

    render(
      <DocEditorRefProvider>
        <Reader />
      </DocEditorRefProvider>,
    );

    // The provider starts empty, so the click must be a silent no-op rather than
    // a throw. There is deliberately no spy to assert against: with no callback
    // installed, not throwing is the entire contract.
    await expect(
      user.click(screen.getByRole("button", { name: "open" })),
    ).resolves.toBeUndefined();
  });

  it("hands every consumer the same ref object across re-renders", async () => {
    const user = userEvent.setup();
    const refs: object[] = [];

    function Consumer() {
      refs.push(useDocEditorRef());
      return null;
    }

    function Harness() {
      const [, setTick] = useState(0);
      return (
        <>
          <Consumer />
          <Consumer />
          <button onClick={() => setTick((t) => t + 1)}>rerender</button>
        </>
      );
    }

    render(
      <DocEditorRefProvider>
        <Harness />
      </DocEditorRefProvider>,
    );

    await user.click(screen.getByRole("button", { name: "rerender" }));

    expect(new Set(refs).size).toBe(1);
  });
});
