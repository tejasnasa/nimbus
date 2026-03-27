"use client";

import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  Node,
  Edge,
  OnConnect,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

export type FlowNodeData = {
  label: string;
};
export type FlowNode = Node<FlowNodeData, "flow">;
export type FlowEdge = Edge;

const initialNodes: FlowNode[] = [
  {
    id: "1",
    type: "flow",
    position: { x: 0, y: 0 },
    data: { label: "Start" },
  },
];

const initialEdges: FlowEdge[] = [];

interface CanvasProps {
  docId: string;
}

export function Canvas({ docId }: CanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onConnect: OnConnect = (connection) => {
    setEdges((eds) => addEdge(connection, eds));
  };

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      fitView
      className="text-(--primary)"
    >
      <Background />
      <Controls />
      <MiniMap />
    </ReactFlow>
  );
}
