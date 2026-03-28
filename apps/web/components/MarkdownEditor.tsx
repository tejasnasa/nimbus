import { Editor, rootCtx } from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import { nord } from "@milkdown/theme-nord";
import React from "react";
import "@milkdown/theme-nord/style.css";

interface MarkdownEditorProps {
  initialContent: string;
}

const MilkdownEditor = ({ initialContent }: MarkdownEditorProps) => {
  useEditor((root) =>
    Editor.make()
      .config(nord)
      .config((ctx) => {
        ctx.set(rootCtx, root);
      })
      .use(commonmark),
  );

  return <Milkdown />;
};

export const MarkdownEditor = ({ initialContent }: MarkdownEditorProps) => {
  return (
    <MilkdownProvider>
      <MilkdownEditor initialContent={initialContent} />
    </MilkdownProvider>
  );
};
