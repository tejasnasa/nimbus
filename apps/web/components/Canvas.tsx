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
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { nanoid } from "nanoid";
import { useCallback } from "react";
import { CanvasToolbar } from "./CanvasToolbar";

export type FlowNodeData = {
  label: string;
};

export type FlowEdge = Edge;
export const NODE_TYPES = ["flow", "decision", "database", "server"];
export type NodeType = (typeof NODE_TYPES)[number];
export type FlowNode = Node<FlowNodeData, NodeType>;

const initialNodes: FlowNode[] = [];

const initialEdges: FlowEdge[] = [];

interface CanvasProps {
  docId: string;
}

export function Canvas({ docId }: { docId: string }) {
  const [nodes, setNodes, onNodesChange] =
    useNodesState<FlowNode>(initialNodes);
  const [edges, setEdges, onEdgesChange] =
    useEdgesState<FlowEdge>(initialEdges);
  const { screenToFlowPosition, getViewport } = useReactFlow();

  const onConnect: OnConnect = useCallback(
    (connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges],
  );

  const onAddNode = useCallback(
    (nodeType: NodeType, label: string) => {
      const { x, y, zoom } = getViewport();
      const centerX = (window.innerWidth / 2 - x) / zoom;
      const centerY = (window.innerHeight / 2 - y) / zoom;

      const newNode: FlowNode = {
        id: nanoid(),
        type: nodeType,
        position: { x: centerX, y: centerY },
        data: { label },
      };

      setNodes((nds) => [...nds, newNode]);
    },
    [getViewport, setNodes],
  );

  return (
    <div className="w-full h-full relative text-(--primary)">
      <CanvasToolbar onAddNode={onAddNode} />
      <ReactFlow<FlowNode, FlowEdge>
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        fitView
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  );
}
