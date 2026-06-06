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

interface MilkdownEditorProps extends MarkdownEditorProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
}

const MilkdownEditor = ({ documentId, containerRef }: MilkdownEditorProps) => {
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
      })
      .use(commonmark)
      .use(gfm)
      .use(tableBlock)
      .use(collab),
  );

  const collabConnectedRef = useRef(false);
  const stateAppliedRef = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onMouseEnter = (e: Event) => {
      const handle = (e.target as HTMLElement).closest(".handle");
      if (handle) handle.setAttribute("data-show", "true");
    };

    const onMouseLeave = (e: Event) => {
      const handle = (e.target as HTMLElement).closest(".handle");
      if (handle) handle.removeAttribute("data-show");
    };

    container.addEventListener("mouseover", onMouseEnter);
    container.addEventListener("mouseout", onMouseLeave);

    return () => {
      container.removeEventListener("mouseover", onMouseEnter);
      container.removeEventListener("mouseout", onMouseLeave);
    };
  }, [containerRef]);

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
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <MilkdownProvider>
      <div ref={containerRef} className="h-full overflow-y-auto p-1 milkdown">
        <MilkdownEditor documentId={documentId} containerRef={containerRef} />
      </div>
    </MilkdownProvider>
  );
};
