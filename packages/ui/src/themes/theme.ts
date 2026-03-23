import { customDarkTheme } from "./dark";

export const initializeTheme = (monaco: typeof import("monaco-editor")) => {
  monaco.editor.defineTheme("customDarkTheme", customDarkTheme);
};
