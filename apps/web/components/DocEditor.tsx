"use client";

import { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import DocTabs from "@nimbus/ui/DocTabs";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { ClientDocument } from "../api/document";
import { socket } from "../lib/socket";
import { AIGenerationState, AiGenOverlay } from "./AiGenOverlay";
import Canvas from "./Canvas";
import { useDocEditorRef } from "./DocEditorRefContext";
import { MarkdownEditor } from "./MarkdownEditor";

/**
 * @module web/components/DocEditor
 * @description Tabbed document workspace: `DocTabs` strip + per-tab
 * `Canvas`/`MarkdownEditor`, plus the NimbusBot AI flow. `doc:ai:start`
 * swaps in a GENERATING pseudo-tab with `AiGenOverlay`; `doc:ai:thinking`
 * streams reasoning tokens; `doc:ai:complete` replaces the pseudo-tab with
 * the real document after 500ms; `doc:ai:error` surfaces dismissal. Exposes
 * `addTab` to siblings (e.g. Chat) via `DocEditorRefContext`.
 */
/** Placeholder tab shown while NimbusBot generates a document. */
type GeneratingTab = {
  id: string;
  label: string;
  type: "GENERATING";
  docType: "MARKDOWN" | "CANVAS";
};

/** Renderable tab: persisted document or in-flight generation. */
type EditorTab = ClientDocument | GeneratingTab;

type DocAIStartData = { type: "MARKDOWN" | "CANVAS"; label: string };
type DocAIThinkingData = { token: string };
type DocAICompleteData = {
  documentId: string;
  label: string;
  type: "MARKDOWN" | "CANVAS";
  canvasData?: readonly OrderedExcalidrawElement[];
};
type DocAIErrorData = { message: string };

function isGeneratingTab(tab: EditorTab): tab is GeneratingTab {
  return tab.type === "GENERATING";
}

/**
 * Tab list and selection as one value.
 *
 * They move together — opening, closing, replacing and reordering a tab all
 * change which index should be selected — so holding them in separate states
 * forces one store's setter to be called from inside the other's updater. React
 * requires updaters to be pure, and double-invokes them under StrictMode, so
 * that pattern fires the selection change twice or drops it.
 */
type EditorState = {
  tabs: EditorTab[];
  active: number;
};

/**
 * Applies a next-tab list and recomputes the selection, given the index that
 * was removed (or `-1` when nothing was).
 *
 * @param prev - Current state.
 * @param nextTabs - Tab list to install.
 * @param removedIndex - Index removed by this change, if any.
 */
const withTabs = (
  prev: EditorState,
  nextTabs: EditorTab[],
  removedIndex = -1,
): EditorState => {
  if (removedIndex < 0) return { tabs: nextTabs, active: prev.active };

  if (nextTabs.length === 0) return { tabs: nextTabs, active: 0 };
  if (prev.active > removedIndex) {
    return { tabs: nextTabs, active: prev.active - 1 };
  }
  if (prev.active === removedIndex) {
    return { tabs: nextTabs, active: Math.max(0, removedIndex - 1) };
  }
  return { tabs: nextTabs, active: prev.active };
};

/**
 * Tabbed editor over the workspace's documents.
 *
 * @param props.documents - Initial tabs (first tab active).
 */
export default function DocEditor({
  documents,
}: {
  documents: ClientDocument[];
}) {
  const [state, setState] = useState<EditorState>(() => ({
    tabs: documents,
    active: 0,
  }));
  const { tabs, active } = state;
  const [highlightTabId, setHighlightTabId] = useState<string | null>(null);
  const [aiGenerating, setAiGenerating] = useState<AIGenerationState | null>(
    null,
  );
  const aiGeneratingRef = useRef<AIGenerationState | null>(null);
  const addTabRef = useDocEditorRef();

  useEffect(() => {
    aiGeneratingRef.current = aiGenerating;
  }, [aiGenerating]);

  const setHighlightForTab = useCallback((tabId: string) => {
    setHighlightTabId(tabId);
    window.setTimeout(() => {
      setHighlightTabId((current) => (current === tabId ? null : current));
    }, 2000);
  }, []);

  // Adapters so `DocTabs` keeps its plain tabs/setter surface while the two
  // values live in a single state object.
  const setTabs = useCallback<Dispatch<SetStateAction<EditorTab[]>>>((value) => {
    setState((prev) => ({
      tabs: typeof value === "function" ? value(prev.tabs) : value,
      active: prev.active,
    }));
  }, []);

  const setActive = useCallback<Dispatch<SetStateAction<number>>>((value) => {
    setState((prev) => ({
      tabs: prev.tabs,
      active: typeof value === "function" ? value(prev.active) : value,
    }));
  }, []);

  // Idempotent open: existing docs focus instead of duplicating tabs.
  const addTab = useCallback(
    (doc: ClientDocument) => {
      setState((prev) => {
        const existingIndex = prev.tabs.findIndex(
          (tab) => !isGeneratingTab(tab) && tab.id === doc.id,
        );

        if (existingIndex >= 0) {
          return { tabs: prev.tabs, active: existingIndex };
        }

        return { tabs: [...prev.tabs, doc], active: prev.tabs.length };
      });
      setHighlightForTab(doc.id);
    },
    [setHighlightForTab],
  );

  useEffect(() => {
    addTabRef.current = addTab;
    return () => {
      addTabRef.current = null;
    };
  }, [addTab, addTabRef]);

  const replaceGeneratingTab = useCallback(
    (generatingTabId: string, nextDoc: ClientDocument) => {
      setState((prev) => {
        const generatingIndex = prev.tabs.findIndex(
          (tab) => isGeneratingTab(tab) && tab.id === generatingTabId,
        );

        if (generatingIndex < 0) {
          const existingIndex = prev.tabs.findIndex(
            (tab) => !isGeneratingTab(tab) && tab.id === nextDoc.id,
          );

          if (existingIndex >= 0) {
            return { tabs: prev.tabs, active: existingIndex };
          }

          return { tabs: [...prev.tabs, nextDoc], active: prev.tabs.length };
        }

        const nextTabs = [...prev.tabs];
        nextTabs[generatingIndex] = nextDoc;
        return { tabs: nextTabs, active: generatingIndex };
      });
    },
    [],
  );

  /** Closes a tab and moves the selection to a neighbour when it was active. */
  const closeTab = useCallback((tabId: string) => {
    setState((prev) => {
      const removedIndex = prev.tabs.findIndex((tab) => tab.id === tabId);
      if (removedIndex < 0) return prev;

      return withTabs(
        prev,
        prev.tabs.filter((tab) => tab.id !== tabId),
        removedIndex,
      );
    });
  }, []);

  // A generation whose tab is gone can no longer be rendered. Keeping this in an
  // effect rather than inside the tab updaters is what lets those updaters stay
  // pure.
  useEffect(() => {
    if (!aiGenerating) return;

    const stillOpen = tabs.some(
      (tab) => isGeneratingTab(tab) && tab.id === aiGenerating.tabId,
    );
    if (!stillOpen) setAiGenerating(null);
  }, [tabs, aiGenerating]);

  useEffect(() => {
    // Single-flight generation: a new start evicts any stale GENERATING tab so
    // only one AI overlay exists at a time.
    function onStart(data: DocAIStartData) {
      const tabId = `generating:${Date.now()}`;

      setState((prev) => {
        const nextTabs = [
          ...prev.tabs.filter((tab) => !isGeneratingTab(tab)),
          {
            id: tabId,
            label: `${data.label}`,
            type: "GENERATING" as const,
            docType: data.type,
          },
        ];
        return { tabs: nextTabs, active: nextTabs.length - 1 };
      });

      setAiGenerating({
        tabId,
        type: data.type,
        label: data.label,
        thinkingTokens: "",
        stage: "starting",
        status:
          data.type === "MARKDOWN"
            ? "Writing your document..."
            : "Generating your canvas...",
      });
    }

    function onThinking(data: DocAIThinkingData) {
      setAiGenerating((prev) =>
        prev
          ? {
              ...prev,
              stage: "thinking",
              thinkingTokens: prev.thinkingTokens + data.token,
            }
          : prev,
      );
    }

    function onComplete(data: DocAICompleteData) {
      // Ref (not state) read: the socket callback closes over registration time,
      // so the ref carries the latest generation tab id.
      const prev = aiGeneratingRef.current;
      if (!prev) return;

      setAiGenerating((prevGen) =>
        prevGen
          ? {
              ...prevGen,
              stage: "complete",
              status: "Document created successfully!",
            }
          : prevGen,
      );

      const nextDoc: ClientDocument = {
        id: data.documentId,
        label: data.label,
        type: data.type,
        elements:
          data.type === "CANVAS" && Array.isArray(data.canvasData)
            ? data.canvasData
            : [],
        yjsState: null,
      };

      setTimeout(() => {
        replaceGeneratingTab(prev.tabId, nextDoc);
        setHighlightForTab(data.documentId);
        setAiGenerating(null);
      }, 500);
    }

    function onError(data: DocAIErrorData) {
      setAiGenerating((prev) =>
        prev
          ? {
              ...prev,
              stage: "error",
              status: "Generation failed.",
              errorMessage: data.message,
            }
          : prev,
      );
    }

    socket.on("doc:ai:start", onStart);
    socket.on("doc:ai:thinking", onThinking);
    socket.on("doc:ai:complete", onComplete);
    socket.on("doc:ai:error", onError);

    return () => {
      socket.off("doc:ai:start", onStart);
      socket.off("doc:ai:thinking", onThinking);
      socket.off("doc:ai:complete", onComplete);
      socket.off("doc:ai:error", onError);
    };
  }, [replaceGeneratingTab, setHighlightForTab]);

  const dismissGenerationError = useCallback(() => {
    const prev = aiGeneratingRef.current;
    if (!prev) return;

    // Dropping the tab is enough — the effect above clears the overlay state
    // once the tab it belongs to is gone.
    closeTab(prev.tabId);
  }, [closeTab]);

  const current = tabs[active];
  if (!current) return null;

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-(--background)">
      <DocTabs
        tabs={tabs}
        setTabs={setTabs}
        active={active}
        setActive={setActive}
        highlightTabId={highlightTabId}
        onCloseTab={closeTab}
      />

      <div className="min-h-0 flex-1">
        {isGeneratingTab(current) && aiGenerating?.tabId === current.id && (
          <AiGenOverlay
            state={aiGenerating}
            onDismissError={dismissGenerationError}
          />
        )}

        {!isGeneratingTab(current) && current.type === "CANVAS" && (
          <Canvas
            key={current.id}
            initialElements={current.elements}
            documentId={current.id}
          />
        )}

        {!isGeneratingTab(current) && current.type === "MARKDOWN" && (
          <MarkdownEditor key={current.id} documentId={current.id} />
        )}
      </div>
    </section>
  );
}
