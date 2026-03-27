"use client";

import { NodeType } from "./Canvas";

interface Tool {
  label: string;
  nodeType: NodeType;
  description: string;
}

const tools: Tool[] = [
  { label: "Process", nodeType: "flow", description: "Regular step" },
  { label: "Decision", nodeType: "decision", description: "Branch point" },
  { label: "Database", nodeType: "database", description: "Data store" },
  { label: "Server", nodeType: "server", description: "Backend service" },
];

interface CanvasToolbarProps {
  onAddNode: (nodeType: NodeType, label: string) => void;
}

export function CanvasToolbar({ onAddNode }: CanvasToolbarProps) {
  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex gap-2 border  rounded-lg px-2 py-1 bg-(--muted) text-(--muted-foreground)">
      {tools.map((tool) => (
        <button
          key={tool.nodeType}
          onClick={() => onAddNode(tool.nodeType, tool.label)}
          title={tool.description}
          className="px-3 py-1.5 text-sm font-medium rounded-lg transition-colors"
        >
          {tool.label}
        </button>
      ))}
    </div>
  );
}
