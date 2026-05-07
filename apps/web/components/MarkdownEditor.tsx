import { Editor, rootCtx } from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { collab, collabServiceCtx } from "@milkdown/plugin-collab";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import { nord } from "@milkdown/theme-nord";
import React, { useEffect } from "react";
import "@milkdown/theme-nord/style.css";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { socket } from "../lib/socket";

interface MarkdownEditorProps {
  documentId: string;
}

const MilkdownEditor = ({ documentId }: MarkdownEditorProps) => {
  const { get, loading } = useEditor((root) =>
    Editor.make()
      .config(nord)
      .config((ctx) => {
        ctx.set(rootCtx, root);
      })
      .use(commonmark)
      .use(collab),
  );

  useEffect(() => {
    if (loading) return;

    const editor = get();
    if (!editor) return;

    const doc = new Y.Doc();
    const awareness = new Awareness(doc);

    const handleState = (state: number[]) => {
      Y.applyUpdate(doc, Uint8Array.from(state), "socket");
    };

    const handleUpdate = (update: number[]) => {
      Y.applyUpdate(doc, Uint8Array.from(update), "socket");
    };

    socket.on("doc:state", handleState);
    socket.on("doc:update", handleUpdate);

    editor.action((ctx) => {
      const collabService = ctx.get(collabServiceCtx);
      collabService.bindDoc(doc);
      collabService.setAwareness(awareness);
      collabService.connect();
    });

    socket.emit("doc:join", documentId);

    const onDocUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin !== "socket") {
        socket.emit("doc:update", documentId, Array.from(update));
      }
    };
    doc.on("update", onDocUpdate);

    return () => {
      socket.off("doc:state", handleState);
      socket.off("doc:update", handleUpdate);
      doc.off("update", onDocUpdate);

      editor.action((ctx) => {
        const collabService = ctx.get(collabServiceCtx);
        collabService.disconnect();
      });

      socket.emit("doc:leave", documentId);
      awareness.destroy();
      doc.destroy();
    };
  }, [documentId, get]);

  return <Milkdown />;
};

export const MarkdownEditor = ({ documentId }: MarkdownEditorProps) => {
  return (
    <MilkdownProvider>
      <div className="h-full overflow-y-auto p-1">
        <MilkdownEditor documentId={documentId} />
      </div>
    </MilkdownProvider>
  );
};