"use client";

import AlertDialog from "@nimbus/ui/AlertDialog";
import Error from "@nimbus/ui/icons/Error";
import { useRef, useState } from "react";
import type { ClientDocument } from "../api/document";
import {
  CHAT_IMAGE_ACCEPT,
  useChatImageUpload,
} from "../hooks/useChatImageUpload";
import { useWorkspaceDocumentForm } from "../hooks/useWorkspaceDocumentForm";
import { chatTimeContext } from "../lib/chatClock";
import { socket } from "../lib/socket";
import { authInputClass } from "./AuthParts";

/**
 * @module web/components/NewDocumentDialog
 * @description The "New document" button and modal on the settings Documents
 * tab. The modal has two modes: **Blank** (a title and a type, posted to the
 * document API, then opened through `onCreated`) and **From an image** (a
 * dropzone that uploads a photo of a sketch and asks Nimbus to draw it as a
 * whiteboard). The type is fixed to a whiteboard in image mode, since that is
 * what Nimbus produces from a picture.
 *
 * @important "From an image" has no code path of its own: it uploads the picture
 *            and posts the same chat message a member would type, so the bot,
 *            the quota and the generation overlay behave exactly as they do from
 *            the composer. The create form closes the dialog by clicking the
 *            hidden `close-doc-dialog` button (see `useWorkspaceDocumentForm`).
 */

/** The chat message the image mode posts alongside the uploaded picture. */
const IMAGE_TO_DIAGRAM_MESSAGE = "@nimbus turn this into a diagram";

type Mode = "blank" | "image";
type DocType = "MARKDOWN" | "CANVAS";

const MODES: { id: Mode; label: string; hint: string; glyph: string }[] = [
  { id: "blank", label: "Blank", hint: "Start from nothing", glyph: "+" },
  {
    id: "image",
    label: "From an image",
    hint: "Turn a sketch into a board",
    glyph: "▣",
  },
];

const TYPES: { id: DocType; label: string; code: string; color: string }[] = [
  { id: "MARKDOWN", label: "Doc", code: "DOC", color: "text-(--violet)" },
  { id: "CANVAS", label: "Whiteboard", code: "BRD", color: "text-(--lime)" },
];

const SECONDARY_BUTTON =
  "min-h-11 rounded-[11px] border border-(--line-3) bg-transparent px-4 text-sm text-(--foreground) transition-colors hover:cursor-pointer hover:bg-(--surface-3)";
const PRIMARY_BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-[11px] bg-(--brand) px-4.5 text-sm font-semibold text-white transition-colors hover:cursor-pointer hover:bg-(--brand)/90 disabled:cursor-default disabled:opacity-60";

/**
 * @param props.workspaceId - Workspace the document is created in.
 * @param props.onCreated - Receives the created document so it can be listed
 *                          and opened in the editor.
 */
export default function NewDocumentDialog({
  workspaceId,
  onCreated,
}: {
  workspaceId: string;
  onCreated: (doc: ClientDocument) => void;
}) {
  const [mode, setMode] = useState<Mode>("blank");
  const [type, setType] = useState<DocType>("MARKDOWN");
  const [dragging, setDragging] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const imageUpload = useChatImageUpload(workspaceId);

  const {
    register,
    firstError,
    isSubmitting,
    onSubmit,
    setValue: setFormValue,
  } = useWorkspaceDocumentForm(workspaceId, onCreated);

  const handleImageToDiagram = async (file: File | undefined) => {
    if (!file) return;
    const imageUrl = await imageUpload.upload(file);
    if (!imageUrl) return;
    socket.emit("message:send", {
      workspaceId,
      content: IMAGE_TO_DIAGRAM_MESSAGE,
      imageUrl,
      ...chatTimeContext(),
    });
    imageUpload.reset();
    document.getElementById("close-doc-dialog")?.click();
  };

  const pickType = (next: DocType) => {
    setType(next);
    setFormValue("type", next);
  };

  const isImage = mode === "image";
  const uploading = imageUpload.state.status === "uploading";

  return (
    <AlertDialog
      trigger={
        <button
          type="button"
          className="min-h-10.5 rounded-[11px] bg-(--brand) px-4 text-sm font-semibold text-white transition-colors hover:cursor-pointer hover:bg-(--brand)/90"
        >
          + New document
        </button>
      }
    >
      <div
        aria-label="New document"
        className="relative z-50 box-border flex w-[min(620px,calc(100vw-40px))] flex-col gap-5 rounded-[22px] border border-(--line-3) bg-(--surface-1) p-6.5 font-sans shadow-[0_50px_120px_rgba(0,0,0,0.65)]"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            <h2 className="font-display text-[26px] font-semibold tracking-[-0.02em]">
              New document
            </h2>
            <p className="text-sm text-(--muted-foreground)">
              Start blank, or turn a photo of a sketch into a board.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            data-alert-dialog-close
            className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-(--surface-4) text-lg text-(--text-body) transition-colors hover:cursor-pointer hover:text-(--foreground)"
          >
            ×
          </button>
        </div>

        <div role="tablist" className="grid grid-cols-2 gap-2">
          {MODES.map((m) => {
            const on = m.id === mode;
            return (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => {
                  setMode(m.id);
                  if (m.id === "image") pickType("CANVAS");
                }}
                className={`flex flex-col items-start gap-1.5 rounded-[14px] border p-3.5 text-left transition-colors duration-200 hover:cursor-pointer ${
                  on
                    ? "border-(--violet) bg-(--violet)/10"
                    : "border-(--line-2) bg-(--panel)"
                }`}
              >
                <span
                  className={`grid size-7.5 place-items-center rounded-[9px] text-[15px] transition-colors duration-200 ${
                    on
                      ? "bg-(--brand) text-white"
                      : "bg-(--surface-4) text-(--muted-foreground)"
                  }`}
                >
                  {m.glyph}
                </span>
                <span className="text-sm font-semibold">{m.label}</span>
                <span className="text-xs text-(--muted-foreground)">
                  {m.hint}
                </span>
              </button>
            );
          })}
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-5">
          <input type="hidden" {...register("workspaceId")} />
          <input type="hidden" {...register("type")} />

          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-medium text-(--text-soft)">
              Type
            </span>
            <div className="flex gap-2">
              {TYPES.map((t) => {
                const on = t.id === type;
                const locked = isImage && t.id === "MARKDOWN";
                return (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={on}
                    disabled={isImage}
                    onClick={() => pickType(t.id)}
                    className={`flex min-h-11 flex-1 items-center gap-2.5 rounded-[11px] border px-3.5 text-sm transition-colors duration-200 hover:cursor-pointer disabled:cursor-not-allowed ${
                      on
                        ? "border-(--violet) bg-(--violet)/10"
                        : "border-(--line-2) bg-transparent"
                    } ${locked ? "opacity-50" : ""}`}
                  >
                    <span
                      className={`rounded-sm bg-(--surface-4) px-1.5 py-0.75 font-mono text-[9px] font-bold ${t.color}`}
                    >
                      {t.code}
                    </span>
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          {!isImage && (
            <div className="flex flex-col gap-2 animate-fade-in">
              <label
                htmlFor="docTitle"
                className="text-[13px] font-medium text-(--text-soft)"
              >
                Title
              </label>
              <input
                id="docTitle"
                placeholder="My Awesome Document"
                className={`${authInputClass} bg-(--panel)`}
                {...register("title")}
              />
            </div>
          )}

          <input
            ref={imageInputRef}
            type="file"
            accept={CHAT_IMAGE_ACCEPT}
            className="hidden"
            data-testid="doc-image-input"
            onChange={(e) => {
              void handleImageToDiagram(e.target.files?.[0]);
              e.target.value = "";
            }}
          />

          {isImage && (
            <div className="flex flex-col gap-2 animate-fade-in">
              <button
                type="button"
                data-testid="doc-from-image"
                disabled={uploading}
                onClick={() => imageInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  void handleImageToDiagram(e.dataTransfer.files?.[0]);
                }}
                className={`relative flex h-42.5 flex-col items-center justify-center gap-2.5 rounded-[14px] bg-(--panel) text-center transition-colors hover:cursor-pointer disabled:cursor-wait ${
                  dragging ? "bg-(--violet)/10" : ""
                }`}
              >
                <svg className="absolute inset-0 size-full" aria-hidden="true">
                  <rect
                    x="1"
                    y="1"
                    style={{
                      width: "calc(100% - 2px)",
                      height: "calc(100% - 2px)",
                    }}
                    rx="14"
                    fill="none"
                    stroke="var(--line-3)"
                    strokeWidth="1.5"
                    strokeDasharray="8 6"
                    className="ws-dash"
                  />
                </svg>
                <svg
                  width="30"
                  height="30"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--violet)"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="relative"
                  aria-hidden="true"
                >
                  <rect x="3" y="4" width="18" height="16" rx="3" />
                  <circle cx="9" cy="10" r="2" />
                  <path d="M21 16l-5-5-9 9" />
                </svg>
                <span className="relative text-[15px] font-medium">
                  {uploading ? (
                    "Uploading…"
                  ) : (
                    <>
                      Drop a photo of a sketch, or{" "}
                      <span className="text-(--violet-soft)">browse</span>
                    </>
                  )}
                </span>
                <span className="relative px-6 text-xs text-(--muted-foreground)">
                  Nimbus reads the boxes, arrows and labels and draws them as a
                  board.
                </span>
              </button>
              {imageUpload.state.status === "error" && (
                <p role="alert" className="text-xs text-(--destructive)">
                  {imageUpload.state.message}
                </p>
              )}
            </div>
          )}

          {!isImage && firstError && (
            <div className="flex items-center gap-2 rounded-lg border border-(--destructive)/20 bg-(--destructive)/10 px-3 py-2">
              <Error className="size-4 shrink-0 text-(--destructive)" />
              <span className="text-xs text-(--destructive)">{firstError}</span>
            </div>
          )}

          <div className="flex justify-end gap-2.5 pt-1">
            <button
              type="button"
              data-alert-dialog-close
              className={SECONDARY_BUTTON}
            >
              Cancel
            </button>
            {isImage ? (
              <button
                type="button"
                disabled={uploading}
                onClick={() => imageInputRef.current?.click()}
                className={PRIMARY_BUTTON}
              >
                Draw from image
              </button>
            ) : (
              <button
                type="submit"
                disabled={isSubmitting}
                className={PRIMARY_BUTTON}
              >
                Create document
              </button>
            )}
            <button
              type="button"
              id="close-doc-dialog"
              data-alert-dialog-close
              className="hidden"
            ></button>
          </div>
        </form>
      </div>
    </AlertDialog>
  );
}
