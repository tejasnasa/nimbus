import { Editor, rootCtx } from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { collab, collabServiceCtx } from "@milkdown/plugin-collab";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import { nord } from "@milkdown/theme-nord";
import React, { useEffect } from "react";
import "@milkdown/theme-nord/style.css";
import * as Y from "yjs";
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

    socket.emit("doc:join", documentId);
    const doc = new Y.Doc();

    editor.action((ctx) => {
      const collabService = ctx.get(collabServiceCtx);
      collabService.bindDoc(doc);
      collabService.connect();
    });

    const handleState = (state: number[]) => {
      Y.applyUpdate(doc, Uint8Array.from(state), "socket");
    };

    const handleUpdate = (update: number[]) => {
      Y.applyUpdate(doc, Uint8Array.from(update), "socket");
    };

    socket.on("doc:state", handleState);
    socket.on("doc:update", handleUpdate);

    const onDocUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin !== "socket") {
        socket.emit("doc:update", documentId, Array.from(update));
      }
    };
    doc.on("update", onDocUpdate);

    return () => {
      socket.emit("doc:leave", documentId);
      socket.off("doc:state", handleState);
      socket.off("doc:update", handleUpdate);
      doc.off("update", onDocUpdate);
      doc.destroy();

      editor.action((ctx) => {
        const collabService = ctx.get(collabServiceCtx);
        collabService.disconnect();
      });
    };
  }, [documentId, get, loading]);

  return <Milkdown />;
};

export const MarkdownEditor = ({ documentId }: MarkdownEditorProps) => {
  return (
    <MilkdownProvider>
      <div className="p-1">
        <MilkdownEditor documentId={documentId} />
      </div>
    </MilkdownProvider>
  );
};
