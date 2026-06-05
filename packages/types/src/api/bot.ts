export type BotResult =
  | { kind: "reply"; content: string }
  | {
      kind: "create_document";
      type: "MARKDOWN" | "CANVAS";
      label: string;
      prompt: string;
      chatMessage: string;
    };
