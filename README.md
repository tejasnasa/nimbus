# ☁️ Nimbus — Real-time Collaborative Workspace

<div align="center">

**A comprehensive, real-time collaborative workspace unifying document editing, infinite canvas mind-mapping, and AI assistance.**

[Live Demo](https://nimbus.tejasnasa.me) · [GitHub](https://github.com/tejasnasa/nimbus) · [Features](#-features) · [Tech Stack](#-tech-stack) · [Getting Started](#-getting-started) · [Architecture](#-architecture)

</div>

---

## ✨ Features

### 🔄 Real-Time Collaboration
- **CRDT-Powered Sync** — Leverages Yjs and WebSockets to synchronize complex document states and vectors across multiple connected clients with zero conflict.
- **Scalable WebSockets** — Utilizes an `ioredis` adapter for Socket.io, allowing horizontal scaling of WebSocket connections.
- **Instantaneous Updates** — Sub-millisecond latency for concurrent users working simultaneously on the same dashboard.

### 📝 Integrated Editors
- **Milkdown (Rich-Text)** — A highly extensible Markdown editor natively synced via Yjs for collaborative document drafting.
- **Excalidraw (Canvas)** — Infinite canvas whiteboarding seamlessly embedded into the workspace for visual diagrams.

### 🤖 Intelligent AI Assistance
- **@nimbusbot Companion** — An advanced, context-aware AI bot embedded directly within the collaborative chat.
- **Context-Aware Querying** — Dynamically analyzes the current state of documents and canvas vectors to answer queries natively within the workflow.

### 🔒 Workspace Security
- **Better-Auth Integration** — Robust session-based authentication protecting user workspaces and sensitive collaborative documents.

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | Next.js 16 (App Router) |
| **Monorepo** | Turborepo |
| **Backend** | Node.js + Express |
| **Real-Time** | WebSockets (Socket.io) + Yjs |
| **Database/Cache**| PostgreSQL + Redis (ioredis) |
| **Authentication**| Better-Auth |
| **Editors** | Milkdown + Excalidraw |
| **Styling** | Tailwind CSS + React Masonry CSS |

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- PostgreSQL database
- Redis Instance (for Socket.io multiplexing)

### Installation

```bash
# Clone the repository
git clone https://github.com/tejasnasa/nimbus.git
cd nimbus

# Install dependencies (Turborepo)
npm install

# Setup your environment variables inside apps/api and apps/web
cp .env.example .env
```

### Development

```bash
# Start both web and api applications in parallel
npm run dev
```

---

## 🏗 Architecture

```
nimbus/
├── apps/
│   ├── web/               # Next.js 16 Frontend Client
│   │   ├── app/           # App Router pages and collaborative layouts
│   │   ├── components/    # Milkdown & Excalidraw wrappers
│   │   └── package.json
│   ├── api/               # Express & WebSocket Server
│   │   ├── src/
│   │   │   ├── sockets.ts # Yjs and Socket.io handlers
│   │   │   └── index.ts
│   │   └── package.json
├── packages/
│   ├── db/                # Shared Prisma schemas and migrations
│   ├── types/             # Shared TypeScript types
│   └── utils/             # Shared validation and formatter utilities
└── turbo.json             # Monorepo task orchestration
```

---

<div align="center">

**Built with ❤️ by [Tejas](https://github.com/tejasnasa)**

</div>
