"use client";

import { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import DocTabs from "@nimbus/ui/DocTabs";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ClientDocument } from "../api/document";
import type { DocumentSummaryDTO } from "@nimbus/types";
import { toClientDocument } from "../hooks/useLiveDocuments";
import { fetchDocument } from "../lib/documentApi";
import {
  samePeers,
  type LocalPresenceUser,
  type PresencePeer,
} from "../lib/presence";
import { socket } from "../lib/socket";
import { AIGenerationState, AiGenOverlay } from "./AiGenOverlay";
import Canvas from "./Canvas";
import { useDocEditorRef } from "./DocEditorRefContext";
import { MarkdownEditor } from "./MarkdownEditor";
import PresenceAvatars from "./PresenceAvatars";

/**
 * @module web/components/DocEditor
 * @description Tabbed document workspace: `DocTabs` strip + per-tab
 * `Canvas`/`MarkdownEditor`, plus the NimbusBot AI flow. `doc:ai:start`
 * swaps in a GENERATING pseudo-tab with `AiGenOverlay`; `doc:ai:thinking`
 * streams reasoning tokens; `doc:ai:complete` replaces the pseudo-tab with
 * the real document after 500ms; `doc:ai:error` surfaces dismissal. When a
 * meeting's notes are written (`meeting:notes-ready`) the notes document is
 * added as a tab in the background, highlighted but without taking the
 * selection from whatever someone is editing. `document:created` adds a tab,
 * `document:renamed` retitles one, and `document:deleted` replaces the editor of
 * a tab that is open on it with a "This document was deleted" notice (the tab
 * stays until closed, so nobody is left typing into a document that is gone).
 * The person who deleted it needs no warning, so their own tab just closes.
 * Exposes `addTab` to siblings (e.g. Chat) via `DocEditorRefContext`.
 *
 * Presence: the open editor reports who else is in its document (markdown
 * awareness, or the canvas pointers seen so far) and the tab strip shows them as
 * avatars, never including the signed-in user. Presence belongs to the open
 * tab only; switching tabs remounts the editor, which clears the list before
 * the next one fills it.
 *
 * @important Every document event is applied idempotently by id.
 *            `document:created` is also sent for documents that arrive through
 *            `doc:ai:complete` or `meeting:notes-ready`, in either order, and
 *            `replaceGeneratingTab` never leaves two tabs on one document.
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
 * @param props.user - Signed-in user; published as this tab's cursor identity and
 *                     excluded from the "also editing" avatars.
 */
export default function DocEditor({
  documents,
  user,
}: {
  documents: ClientDocument[];
  user?: LocalPresenceUser;
}) {
  const [state, setState] = useState<EditorState>(() => ({
    tabs: documents,
    active: 0,
  }));
  const { tabs, active } = state;
  const [highlightTabId, setHighlightTabId] = useState<string | null>(null);
  const [deletedIds, setDeletedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [aiGenerating, setAiGenerating] = useState<AIGenerationState | null>(
    null,
  );
  const aiGeneratingRef = useRef<AIGenerationState | null>(null);
  const addTabRef = useDocEditorRef();

  const userId = user?.id;
  const userName = user?.name;
  const userImage = user?.image;
  // Stable identity: the editors take it through refs but are memoised on it.
  const presenceUser = useMemo<LocalPresenceUser | undefined>(
    () =>
      userId && userName
        ? { id: userId, name: userName, image: userImage ?? null }
        : undefined,
    [userId, userName, userImage],
  );
  const [peers, setPeers] = useState<PresencePeer[]>([]);
  const updatePeers = useCallback((next: PresencePeer[]) => {
    setPeers((prev) => (samePeers(prev, next) ? prev : next));
  }, []);

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
  const setTabs = useCallback<Dispatch<SetStateAction<EditorTab[]>>>(
    (value) => {
      setState((prev) => ({
        tabs: typeof value === "function" ? value(prev.tabs) : value,
        active: prev.active,
      }));
    },
    [],
  );

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

        const existingIndex = prev.tabs.findIndex(
          (tab) => !isGeneratingTab(tab) && tab.id === nextDoc.id,
        );

        if (generatingIndex < 0) {
          if (existingIndex >= 0) {
            return { tabs: prev.tabs, active: existingIndex };
          }

          return { tabs: [...prev.tabs, nextDoc], active: prev.tabs.length };
        }

        // The announcement of a new document can land before the generation
        // finishes; keep that tab and drop the placeholder rather than showing
        // the document twice.
        if (existingIndex >= 0) {
          const nextTabs = prev.tabs.filter((_, i) => i !== generatingIndex);
          const keptIndex = nextTabs.findIndex((tab) => tab.id === nextDoc.id);
          return { tabs: nextTabs, active: keptIndex };
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

  // The notes document is created on the server, so no tab exists for it yet.
  // It is appended without moving the selection: the people on the call are
  // usually mid-edit when the notes land.
  useEffect(() => {
    let active = true;
    async function onNotesReady(data: {
      meetingId: string;
      documentId: string;
    }) {
      const doc = await fetchDocument(data.documentId);
      if (!active || !doc) return;
      setState((prev) =>
        prev.tabs.some((tab) => !isGeneratingTab(tab) && tab.id === doc.id)
          ? prev
          : { tabs: [...prev.tabs, doc], active: prev.active },
      );
      setHighlightForTab(doc.id);
    }
    socket.on("meeting:notes-ready", onNotesReady);
    return () => {
      active = false;
      socket.off("meeting:notes-ready", onNotesReady);
    };
  }, [setHighlightForTab]);

  // Document lifecycle announcements from other members (and from the server,
  // for generated documents and notes). A new document is appended without
  // taking the selection; its content arrives through the editor's own sync.
  useEffect(() => {
    const onCreated = (data: { document: DocumentSummaryDTO }) => {
      const doc = toClientDocument(data.document);
      setState((prev) =>
        prev.tabs.some((tab) => !isGeneratingTab(tab) && tab.id === doc.id)
          ? prev
          : { tabs: [...prev.tabs, doc], active: prev.active },
      );
      setHighlightForTab(doc.id);
    };
    const onRenamed = (data: { documentId: string; title: string }) => {
      setState((prev) =>
        prev.tabs.some(
          (tab) =>
            !isGeneratingTab(tab) &&
            tab.id === data.documentId &&
            tab.label !== data.title,
        )
          ? {
              tabs: prev.tabs.map((tab) =>
                !isGeneratingTab(tab) && tab.id === data.documentId
                  ? { ...tab, label: data.title }
                  : tab,
              ),
              active: prev.active,
            }
          : prev,
      );
    };
    const onDeleted = (data: { documentId: string; deletedById: string }) => {
      if (data.deletedById === userId) {
        closeTab(data.documentId);
        return;
      }
      setDeletedIds((prev) =>
        prev.has(data.documentId) ? prev : new Set(prev).add(data.documentId),
      );
    };
    socket.on("document:created", onCreated);
    socket.on("document:renamed", onRenamed);
    socket.on("document:deleted", onDeleted);
    return () => {
      socket.off("document:created", onCreated);
      socket.off("document:renamed", onRenamed);
      socket.off("document:deleted", onDeleted);
    };
  }, [setHighlightForTab, closeTab, userId]);

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
        trailing={
          isGeneratingTab(current) || deletedIds.has(current.id) ? null : (
            <PresenceAvatars peers={peers} />
          )
        }
      />

      <div className="min-h-0 flex-1">
        {isGeneratingTab(current) && aiGenerating?.tabId === current.id && (
          <AiGenOverlay
            state={aiGenerating}
            onDismissError={dismissGenerationError}
          />
        )}

        {!isGeneratingTab(current) && deletedIds.has(current.id) && (
          <div
            role="alert"
            data-testid="document-deleted"
            className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center"
          >
            <p className="text-base font-medium">This document was deleted</p>
            <p className="max-w-sm text-sm text-(--muted-foreground)">
              Someone removed &ldquo;{current.label}&rdquo; from the workspace.
              Anything typed since is not saved.
            </p>
            <button
              type="button"
              onClick={() => closeTab(current.id)}
              className="rounded-xl border border-(--border) px-3 py-1.5 text-sm hover:bg-(--muted) hover:cursor-pointer"
            >
              Close tab
            </button>
          </div>
        )}

        {!isGeneratingTab(current) &&
          !deletedIds.has(current.id) &&
          current.type === "CANVAS" && (
            <Canvas
              key={current.id}
              initialElements={current.elements}
              documentId={current.id}
              user={presenceUser}
              onPeersChange={updatePeers}
            />
          )}

        {!isGeneratingTab(current) &&
          !deletedIds.has(current.id) &&
          current.type === "MARKDOWN" && (
            <MarkdownEditor
              key={current.id}
              documentId={current.id}
              user={presenceUser}
              onPeersChange={updatePeers}
            />
          )}
      </div>
    </section>
  );
}
