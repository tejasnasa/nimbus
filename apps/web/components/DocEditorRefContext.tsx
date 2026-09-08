/**
 * @module web/components/DocEditorRefContext
 * @description Ref-based bridge exposing `DocEditor.addTab` to siblings
 * (e.g. Chat's AI flow) without prop drilling. A mutable ref (not state)
 * avoids re-rendering providers when the callback identity changes.
 */
"use client";

import type { ReactNode, RefObject } from "react";
import { createContext, useContext, useRef } from "react";
import { ClientDocument } from "../api/document";

/** Opens (or focuses) a document tab in the editor. */
type AddTabFn = (doc: ClientDocument) => void;

const DocEditorContext = createContext<RefObject<AddTabFn | null> | null>(null);

export function DocEditorRefProvider({ children }: { children: ReactNode }) {
  const addTabRef = useRef<AddTabFn | null>(null);

  return (
    <DocEditorContext.Provider value={addTabRef}>
      {children}
    </DocEditorContext.Provider>
  );
}

/** Returns the shared add-tab ref; throws outside the provider. */
export function useDocEditorRef() {
  const ctx = useContext(DocEditorContext);
  if (!ctx)
    throw new Error("useDocEditorRef must be used within DocEditorRefProvider");
  return ctx;
}
