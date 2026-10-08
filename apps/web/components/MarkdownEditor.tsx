import {
  tableBlock,
  tableBlockConfig,
} from "@milkdown/kit/component/table-block";
import {
  Editor,
  editorViewCtx,
  editorViewOptionsCtx,
  rootCtx,
} from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { collab, collabServiceCtx } from "@milkdown/plugin-collab";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import { nord } from "@milkdown/theme-nord";
import "@milkdown/theme-nord/style.css";
/**
 * @module web/components/MarkdownEditor
 * @description Real-time collaborative Markdown editor (Milkdown + Yjs).
 *
 * Lifecycle: `doc:join` → apply server binary state with origin `"socket"`
 * → bind the collab plugin (seeding AI `initialContent` as a template when
 * present) → local edits emit `doc:update`, remote updates apply silently.
 *
 * @important The editor is read-only until the collaboration binding is live.
 *            Binding renders the Y.Doc into the view and REPLACES whatever the
 *            view already held, so an editor that accepted input before it
 *            would discard those keystrokes rather than sync them — they reach
 *            no Yjs update, so nothing persists them and a reload shows the
 *            document empty. The wait is as long as the join round-trip, which
 *            is imperceptible locally and seconds against a remote database,
 *            so this cannot be left to timing. The view is unlocked in
 *            `connectCollab`, after that render has happened.
 *
 * @important The session effect must never depend on `useEditor().get` — that
 *            package returns a fresh closure on every render, so using it as a
 *            dependency destroys and recreates the Yjs doc, the awareness
 *            instance and the socket room on every render of the editor
 *            subtree. The accessor is held in a ref instead.
 */
import { memo, useEffect, useRef } from "react";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { socket } from "../lib/socket";

/**
 * @param documentId - Document cuid (socket room + Yjs session key).
 */
interface MarkdownEditorProps {
  documentId: string;
}

interface MilkdownEditorProps extends MarkdownEditorProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * How long to wait for the first `doc:state` before retrying the join. Only
 * reached when the join genuinely failed — a normal round-trip is far faster.
 */
const STATE_RETRY_MS = 2_000;


const MilkdownEditor = memo(function MilkdownEditor({
  documentId,
  containerRef,
}: MilkdownEditorProps) {
  const { get, loading } = useEditor((root) =>
    Editor.make()
      .config(nord)
      .config((ctx) => {
        ctx.set(rootCtx, root);

        // The view-level half of the read-only-until-bound rule in the module
        // note. A view option (rather than a ProseMirror plugin) because this is
        // read once, when the view is constructed, so the editor is locked from
        // its very first paint — no window between mount and the lock applying.
        //
        // @important Merge into the slice, never `ctx.set` it. This object is
        //            shared: the `nord` config above contributes the editor's
        //            `attributes` (the `milkdown-theme-nord` and `prose` classes
        //            every typographic rule in the theme is scoped to) through
        //            the same slice. Assigning a fresh object drops them, and the
        //            editor then renders unstyled — headings fall back to the
        //            preflight `font-size: inherit`, so `#` looks like body text.
        ctx.update(editorViewOptionsCtx, (prev) => ({
          ...prev,
          editable: () => false,
        }));

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

  // See the module note: `get` is a new closure on every render, so it is
  // mirrored into a ref and deliberately kept out of the session effect's
  // dependency list.
  const getEditorRef = useRef(get);
  useEffect(() => {
    getEditorRef.current = get;
  }, [get]);

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

    const editor = getEditorRef.current();
    if (!editor) return;

    const doc = new Y.Doc();
    const awareness = new Awareness(doc);

    // Seeds AI content into an already-bound session. Skipped when the document
    // already has content: a rejoin can deliver the template after a peer (or
    // the user) has started typing, and `applyTemplate` appends rather than
    // replaces, which would duplicate the body.
    const applySeed = (markdown: string) => {
      if (doc.getXmlFragment("prosemirror").length > 0) return;

      editor.action((ctx) => {
        ctx.get(collabServiceCtx).applyTemplate(markdown);
      });
    };

    const connectCollab = (initialMarkdown?: string) => {
      if (collabConnectedRef.current) {
        if (initialMarkdown) applySeed(initialMarkdown);
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

        // Unlock last, and only now: `connect()` is what renders the Y.Doc into
        // the view, so releasing before it would accept the keystrokes that
        // render is about to overwrite. Clearing the option rather than setting
        // it true hands the decision back to the collab plugin, which disables
        // editing of its own accord while it renders a snapshot.
        ctx.get(editorViewCtx).setProps({ editable: undefined });
      });
    };

    // Once a full server state has been applied, the metadata map it carried is
    // authoritative: if there is no `initialContent` in it, no template is
    // coming, so waiting longer would only leave the editor inert. Connecting
    // unconditionally here is what stops a slow `doc:state` from producing a
    // dead editor.
    const tryConnectCollab = () => {
      if (collabConnectedRef.current || !stateAppliedRef.current) return;

      const metadata = doc.getMap("metadata");
      const initialMarkdown = metadata.get("initialContent") as
        | string
        | undefined;

      if (initialMarkdown) metadata.delete("initialContent");

      connectCollab(initialMarkdown);
    };

    const handleState = (state: number[]) => {
      Y.applyUpdate(doc, Uint8Array.from(state), "socket");
      stateAppliedRef.current = true;
      tryConnectCollab();
    };

    const handleUpdate = (update: number[]) => {
      Y.applyUpdate(doc, Uint8Array.from(update), "socket");
    };

    // A reconnect hands the server a brand-new socket with no rooms, so the
    // doc room must be re-entered or every later update is rejected and peers'
    // edits are never received. `doc:state` is a full Yjs update, so applying
    // it again after a rejoin merges idempotently.
    const handleConnect = () => {
      socket.emit("doc:join", documentId);
    };

    const handleError = (message: string) => {
      console.error("Document sync error:", message);
    };

    socket.on("doc:state", handleState);
    socket.on("doc:update", handleUpdate);
    socket.on("connect", handleConnect);
    socket.on("doc:error", handleError);

    // Guard: suppress echo — only emit local mutations (origin !== "socket").
    const onDocUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin !== "socket") {
        socket.emit("doc:update", documentId, Array.from(update));
      }
    };
    doc.on("update", onDocUpdate);

    socket.emit("doc:join", documentId);

    // Safety net for the one case `tryConnectCollab` cannot cover: no server
    // state at all, so the join never completed. Retrying is honest — silently
    // binding an empty doc would look like data loss to the user.
    const stateRetryTimer = window.setTimeout(() => {
      if (!stateAppliedRef.current) {
        socket.emit("doc:join", documentId);
      }
    }, STATE_RETRY_MS);

    return () => {
      window.clearTimeout(stateRetryTimer);
      socket.off("doc:state", handleState);
      socket.off("doc:update", handleUpdate);
      socket.off("connect", handleConnect);
      socket.off("doc:error", handleError);
      doc.off("update", onDocUpdate);

      if (collabConnectedRef.current) {
        editor.action((ctx) => {
          // Re-lock before unbinding, so there is no moment where the view is
          // editable with nothing left to sync it. It also restores the initial
          // state if this editor outlives the document it was bound to.
          ctx.get(editorViewCtx).setProps({ editable: () => false });
          ctx.get(collabServiceCtx).disconnect();
        });
      }

      socket.emit("doc:leave", documentId);
      awareness.destroy();
      doc.destroy();
      collabConnectedRef.current = false;
      stateAppliedRef.current = false;
    };
  }, [documentId, loading]);

  return <Milkdown />;
});

/**
 * Collaborative Markdown editor for one document.
 *
 * Remount per `documentId` (keyed by the parent) so each doc gets a fresh
 * Yjs session, Milkdown provider, and socket room.
 *
 * Memoised because its parent re-renders on unrelated state (AI token streams,
 * tab highlighting); without this the whole editor subtree re-renders with it.
 */
export const MarkdownEditor = memo(function MarkdownEditor({
  documentId,
}: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <MilkdownProvider>
      <div ref={containerRef} className="h-full overflow-y-auto p-1 milkdown">
        <MilkdownEditor documentId={documentId} containerRef={containerRef} />
      </div>
    </MilkdownProvider>
  );
});
