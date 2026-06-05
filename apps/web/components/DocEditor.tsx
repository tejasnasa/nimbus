"use client";

import { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import DocTabs from "@nimbus/ui/DocTabs";
import { useCallback, useEffect, useRef, useState } from "react";
import { ClientDocument } from "../api/document";
import { socket } from "../lib/socket";
import { AIGenerationState, AiGenOverlay } from "./AiGenOverlay";
import Canvas from "./Canvas";
import { useDocEditorRef } from "./DocEditorRefContext";
import { MarkdownEditor } from "./MarkdownEditor";

type GeneratingTab = {
  id: string;
  label: string;
  type: "GENERATING";
  docType: "MARKDOWN" | "CANVAS";
};

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

export default function DocEditor({
  documents,
}: {
  documents: ClientDocument[];
}) {
  const [tabs, setTabs] = useState<EditorTab[]>(documents);
  const [active, setActive] = useState(0);
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

  const addTab = useCallback(
    (doc: ClientDocument) => {
      setTabs((prev) => {
        const existingIndex = prev.findIndex(
          (tab) => !isGeneratingTab(tab) && tab.id === doc.id,
        );

        if (existingIndex >= 0) {
          setActive(existingIndex);
          return prev;
        }

        setActive(prev.length);
        return [...prev, doc];
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
      setTabs((currentTabs) => {
        const generatingIndex = currentTabs.findIndex(
          (tab) => isGeneratingTab(tab) && tab.id === generatingTabId,
        );

        if (generatingIndex < 0) {
          const existingIndex = currentTabs.findIndex(
            (tab) => !isGeneratingTab(tab) && tab.id === nextDoc.id,
          );

          if (existingIndex >= 0) {
            setActive(existingIndex);
            return currentTabs;
          }

          setActive(currentTabs.length);
          return [...currentTabs, nextDoc];
        }

        const nextTabs = [...currentTabs];
        nextTabs[generatingIndex] = nextDoc;
        setActive(generatingIndex);
        return nextTabs;
      });
    },
    [],
  );

  const removeGeneratingTab = useCallback((generatingTabId: string) => {
    setTabs((currentTabs) => {
      const removedIndex = currentTabs.findIndex(
        (tab) => tab.id === generatingTabId,
      );
      const nextTabs = currentTabs.filter((tab) => tab.id !== generatingTabId);

      setActive((currentActive) => {
        if (removedIndex < 0) return currentActive;
        if (nextTabs.length === 0) return 0;
        if (currentActive > removedIndex) return currentActive - 1;
        if (currentActive === removedIndex) {
          return Math.max(0, removedIndex - 1);
        }
        return currentActive;
      });

      return nextTabs;
    });
  }, []);

  const closeTab = useCallback((tabId: string) => {
    setTabs((currentTabs) => {
      const indexToClose = currentTabs.findIndex((tab) => tab.id === tabId);
      if (indexToClose < 0) return currentTabs;

      const tabToClose = currentTabs[indexToClose];
      if (tabToClose && isGeneratingTab(tabToClose)) {
        setAiGenerating(null);
      }

      const nextTabs = currentTabs.filter((tab) => tab.id !== tabId);

      setActive((currentActive) => {
        if (nextTabs.length === 0) return 0;
        if (currentActive > indexToClose) return currentActive - 1;
        if (currentActive === indexToClose) {
          return Math.max(0, indexToClose - 1);
        }
        return currentActive;
      });

      return nextTabs;
    });
  }, []);

  useEffect(() => {
    function onStart(data: DocAIStartData) {
      const tabId = `generating:${Date.now()}`;

      setTabs((prev) => {
        const nextTabs = [
          ...prev.filter((tab) => !isGeneratingTab(tab)),
          {
            id: tabId,
            label: `${data.label}`,
            type: "GENERATING" as const,
            docType: data.type,
          },
        ];
        setActive(nextTabs.length - 1);
        return nextTabs;
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

    removeGeneratingTab(prev.tabId);
    setAiGenerating(null);
  }, [removeGeneratingTab]);

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
