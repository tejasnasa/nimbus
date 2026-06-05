import { languages } from "@codemirror/language-data";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  codeBlockComponent,
  codeBlockConfig,
} from "@milkdown/kit/component/code-block";
import {
  tableBlock,
  tableBlockConfig,
} from "@milkdown/kit/component/table-block";
import { Editor, rootCtx } from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { collab, collabServiceCtx } from "@milkdown/plugin-collab";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import { nord } from "@milkdown/theme-nord";
import "@milkdown/theme-nord/style.css";
import { useEffect, useRef } from "react";
import { Awareness } from "y-protocols/awareness";
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

        ctx.update(tableBlockConfig.key, (prev) => ({
          ...prev,
          renderButton: (renderType) => {
            switch (renderType) {
              case "add_row":
                return `<svg viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4"><path d="M11 11V5H13V11H19V13H13V19H11V13H5V11H11Z" /></svg>`;
              case "add_col":
                return `<svg viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4"><path d="M11 11V5H13V11H19V13H13V19H11V13H5V11H11Z" /></svg>`;
              case "delete_row":
                return `<svg viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4"><path d="M17 6H22V8H20V21C20 21.5523 19.5523 22 19 22H5C4.44772 22 4 21.5523 4 21V8H2V6H7V3C7 2.44772 7.44772 2 8 2H16C16.5523 2 17 2.44772 17 3V6ZM18 8H6V20H18V8ZM9 11H11V17H9V11ZM13 11H15V17H13V11ZM9 4V6H15V4H9Z"></path></svg>`;
              case "delete_col":
                return `<svg viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4"><path d="M17 6H22V8H20V21C20 21.5523 19.5523 22 19 22H5C4.44772 22 4 21.5523 4 21V8H2V6H7V3C7 2.44772 7.44772 2 8 2H16C16.5523 2 17 2.44772 17 3V6ZM18 8H6V20H18V8ZM9 11H11V17H9V11ZM13 11H15V17H13V11ZM9 4V6H15V4H9Z"></path></svg>`;
              case "align_col_left":
                return `<svg viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4"><path d="M3 3H21V5H3V3ZM3 7H15V9H3V7ZM3 11H21V13H3V11ZM3 15H15V17H3V15ZM3 19H21V21H3V19Z"/></svg>`;
              case "align_col_center":
                return `<svg viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4"><path d="M3 3H21V5H3V3ZM6 7H18V9H6V7ZM3 11H21V13H3V11ZM6 15H18V17H6V15ZM3 19H21V21H3V19Z"/></svg>`;
              case "align_col_right":
                return `<svg viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4"><path d="M3 3H21V5H3V3ZM9 7H21V9H9V7ZM3 11H21V13H3V11ZM9 15H21V17H9V15ZM3 19H21V21H3V19Z"/></svg>`;
              case "col_drag_handle":
              case "row_drag_handle":
                return `<svg viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4"><path d="M8.5 6a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zm0 7a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zm0 7a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zm7-14a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zm0 7a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zm0 7a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"/></svg>`;
              default:
                return "";
            }
          },
        }));

        ctx.update(codeBlockConfig.key, (prev) => ({
          ...prev,
          languages,
          extensions: [oneDark],
          expandIcon: `<svg viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4"><path d="M12 16L6 10H18L12 16Z"/></svg>`,
          searchIcon: `<svg viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4"><path d="M15.5 14H14.71L14.43 13.73C15.41 12.59 16 11.11 16 9.5C16 5.91 13.09 3 9.5 3C5.91 3 3 5.91 3 9.5C3 13.09 5.91 16 9.5 16C11.11 16 12.59 15.41 13.73 14.43L14 14.71V15.5L19 20.5L20.5 19L15.5 14ZM9.5 14C7.01 14 5 11.99 5 9.5C5 7.01 7.01 5 9.5 5C11.99 5 14 7.01 14 9.5C14 11.99 11.99 14 9.5 14Z"/></svg>`,
          clearSearchIcon: `<svg viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4"><path d="M19 6.41L17.59 5L12 10.59L6.41 5L5 6.41L10.59 12L5 17.59L6.41 19L12 13.41L17.59 19L19 17.59L13.41 12L19 6.41Z"/></svg>`,
          copyIcon: `<svg viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4"><path d="M6.9998 6V3C6.9998 2.44772 7.44752 2 7.9998 2H19.9998C20.5521 2 20.9998 2.44772 20.9998 3V17C20.9998 17.5523 20.5521 18 19.9998 18H16.9998V20.9991C16.9998 21.5519 16.5499 22 15.993 22H4.00666C3.45059 22 3 21.5554 3 20.9991L3.0026 7.00087C3.0027 6.44811 3.45264 6 4.00942 6H6.9998ZM5.00242 8L5.00019 20H14.9998V8H5.00242ZM8.9998 6H16.9998V16H18.9998V4H8.9998V6Z"></path></svg>`,
        }));
      })
      .use(commonmark)
      .use(gfm)
      .use(tableBlock)
      .use(codeBlockComponent)
      .use(collab),
  );

  const collabConnectedRef = useRef(false);
  const stateAppliedRef = useRef(false);

  useEffect(() => {
    if (loading) return;

    const editor = get();
    if (!editor) return;

    const doc = new Y.Doc();
    const awareness = new Awareness(doc);

    const connectCollab = (initialMarkdown?: string) => {
      if (collabConnectedRef.current) {
        if (initialMarkdown) {
          editor.action((ctx) => {
            ctx.get(collabServiceCtx).applyTemplate(initialMarkdown);
          });
        }
        return;
      }

      collabConnectedRef.current = true;

      editor.action((ctx) => {
        const collabService = ctx.get(collabServiceCtx);
        collabService.bindDoc(doc);
        collabService.setAwareness(awareness);
        if (initialMarkdown) {
          collabService.applyTemplate(initialMarkdown);
        }
        collabService.connect();
      });
    };

    const tryConnectCollab = () => {
      if (collabConnectedRef.current || !stateAppliedRef.current) return;

      const metadata = doc.getMap("metadata");
      const initialMarkdown = metadata.get("initialContent") as
        | string
        | undefined;

      if (initialMarkdown) {
        metadata.delete("initialContent");
        connectCollab(initialMarkdown);
        return;
      }

      const yFragment = doc.getXmlFragment("prosemirror");
      const hasYjsContent = yFragment.length > 0;

      if (hasYjsContent) {
        connectCollab();
      }
    };

    const handleState = (state: number[]) => {
      Y.applyUpdate(doc, Uint8Array.from(state), "socket");
      stateAppliedRef.current = true;
      tryConnectCollab();
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

    socket.emit("doc:join", documentId);

    const emptyDocConnectTimer = window.setTimeout(() => {
      if (!collabConnectedRef.current && stateAppliedRef.current) {
        const metadata = doc.getMap("metadata");
        const initialMarkdown = metadata.get("initialContent") as
          | string
          | undefined;
        if (initialMarkdown) {
          metadata.delete("initialContent");
        }
        connectCollab(initialMarkdown);
      }
    }, 300);

    return () => {
      window.clearTimeout(emptyDocConnectTimer);
      socket.off("doc:state", handleState);
      socket.off("doc:update", handleUpdate);
      doc.off("update", onDocUpdate);

      if (collabConnectedRef.current) {
        editor.action((ctx) => {
          ctx.get(collabServiceCtx).disconnect();
        });
      }

      socket.emit("doc:leave", documentId);
      awareness.destroy();
      doc.destroy();
      collabConnectedRef.current = false;
      stateAppliedRef.current = false;
    };
  }, [documentId, get, loading]);

  return <Milkdown />;
};

export const MarkdownEditor = ({ documentId }: MarkdownEditorProps) => {
  return (
    <MilkdownProvider>
      <div className="h-full overflow-y-auto p-1 milkdown">
        <MilkdownEditor documentId={documentId} />
      </div>
    </MilkdownProvider>
  );
};
