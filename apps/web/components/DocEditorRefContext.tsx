"use client";

import type { ReactNode, RefObject } from "react";
import { createContext, useContext, useRef } from "react";
import { ClientDocument } from "../api/document";

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

export function useDocEditorRef() {
  const ctx = useContext(DocEditorContext);
  if (!ctx)
    throw new Error("useDocEditorRef must be used within DocEditorRefProvider");
  return ctx;
}
