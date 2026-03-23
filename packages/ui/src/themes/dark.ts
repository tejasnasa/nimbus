import { editor } from "monaco-editor";

export const customDarkTheme: editor.IStandaloneThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#0A0A0A",
    "editor.foreground": "#D4D4D4",
    "editor.lineHighlightBackground": "#2D2D2D",
    "editor.selectionBackground": "#264F78",
    "editor.inactiveSelectionBackground": "#3A3D41",
    "editorCursor.foreground": "#FFFFFF",
    "editorWhitespace.foreground": "#404040",
    "editorLineNumber.foreground": "#858585",
    "editor.selectionHighlightBackground": "#ADD6FF26",
  },
};
