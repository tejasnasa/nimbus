<div align="center">

  # ☁️ Nimbus
  
  **The Unified Real-time Collaborative Workspace for Modern Teams**

  A comprehensive, highly scalable real-time collaborative workspace unifying rich document editing, infinite canvas whiteboarding, and embedded AI assistance.

  [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
  [![Next.js](https://img.shields.io/badge/Next.js-16-black.svg?logo=next.js)](https://nextjs.org/)
  [![Turborepo](https://img.shields.io/badge/Turborepo-Monorepo-EF4444.svg?logo=turborepo)](https://turbo.build/)
  [![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](http://makeapullrequest.com)

  [Live Demo](https://nimbus.tejasnasa.me) · [Report Bug](https://github.com/tejasnasa/nimbus/issues) · [Request Feature](https://github.com/tejasnasa/nimbus/issues)

</div>

---

## 🌟 Why Nimbus?

In a world where remote work and asynchronous communication are the norm, context switching between tools kills productivity. **Nimbus** eliminates the friction by combining your text documents, whiteboard diagrams, instant chat, voice calls, and an AI assistant into a single, cohesive environment. 

Designed for **scale and performance**, Nimbus handles thousands of concurrent users in real-time, making it the perfect choice for enterprises, open-source communities, and fast-moving startups.

---

## ✨ Enterprise-Grade Features

### 🔄 Real-Time Collaboration at Scale
- **Conflict-Free Replication (CRDT)** — Powered by Yjs, Nimbus guarantees that complex document states and canvas vectors synchronize flawlessly across all connected clients without merge conflicts.
- **High-Throughput WebSockets** — Built on Socket.io with an `ioredis` adapter, allowing horizontal scaling across multiple Node.js instances to support tens of thousands of concurrent users.
- **Sub-Millisecond Latency** — Optimized network payload delivery ensures instantaneous updates across the globe.

### 📝 Integrated, Powerful Editors
- **Rich-Text Document Editor (Milkdown)** — A beautiful, highly extensible Markdown editor that natively syncs via Yjs. Supports slash commands, embeddable blocks, and collaborative cursors.
- **Infinite Canvas Whiteboarding (Excalidraw)** — Sketch diagrams, build flowcharts, or wireframe UIs on an infinite canvas seamlessly embedded into your workspace.

### 🎙️ Native WebRTC Voice Rooms
- **Zero-Latency Audio** — Embedded audio rooms per workspace using peer-to-peer WebRTC connections for instant team standups.
- **TURN Relay Infrastructure** — Integrated Coturn TURN relay server configuration to bypass firewalls and ensure stable peer connections on restricted networks.
- **Seamless UX** — Toggle voice chat inside any channel with a single click without leaving your active workspace.

### 🤖 Intelligent AI Assistance & Generation (@NimbusBot)
- **AI Document Generation** — Instantly draft high-fidelity Markdown documents (via Qwen) and structured Excalidraw whiteboards (via GPT-OSS) directly from prompts.
- **Yjs Server-Side Injection** — Real-time streaming content injection server-side, propagating document updates dynamically to all connected Yjs collaborators.
- **Context-Aware Companion** — NimbusBot analyzes your workspace state, chat logs, and active canvases to provide hyper-relevant advice, summaries, and code snippets.

### 🔒 Bank-Grade Security & Privacy
- **Robust Authentication** — Secured by Better-Auth, providing bulletproof session management, OAuth integrations, and granular role-based access control (RBAC).
- **End-to-End Encryption Readiness** — Architecture designed to support E2EE for sensitive corporate data.
- **Data Sovereignty** — Self-hostable architecture gives you complete control over where your data lives.

---

## 🛠 Tech Stack

Nimbus leverages a modern, robust tech stack designed for high availability and rapid iteration.

| Layer | Technology | Description |
|---|---|---|
| **Framework** | Next.js 16 (App Router) | React framework for production-grade React applications. |
| **Monorepo** | Turborepo | High-performance build system for JS/TS codebases. |
| **Backend** | Node.js + Express | Lightweight, fast backend for API and WebSocket handling. |
| **Real-Time** | WebSockets (Socket.io) + Yjs | Real-time bi-directional event-based communication. |
| **Voice Chat** | WebRTC + Coturn TURN | Zero-latency peer-to-peer voice channel relay. |
| **AI Layer** | LLMs (Qwen & GPT-OSS) | Backend AI pipeline for streaming Markdown and structured JSON whiteboards. |
| **Database** | PostgreSQL | Robust, scalable relational database (managed via Prisma). |
| **Cache/PubSub**| Redis (ioredis) | In-memory data structure store used for WebSocket multiplexing. |
| **Authentication**| Better-Auth | Comprehensive authentication and authorization. |
| **UI & Styling** | Tailwind CSS + Framer Motion | Utility-first CSS framework and animation library for fluid UX. |

---

## 🚀 Getting Started

Want to run Nimbus locally or contribute to the project? Follow these steps.

### Prerequisites
- **Node.js** 18.x or later
- **PostgreSQL** 14+
- **Redis** 6+ (Required for WebSocket multiplexing)
- **Git**

### Local Development Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/tejasnasa/nimbus.git
   cd nimbus
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Environment Configuration**
   Copy the example environment file and configure your database and Redis credentials.
   ```bash
   cp .env.example .env.local
   ```

4. **Database Migration**
   Run Prisma migrations to set up your PostgreSQL schema.
   ```bash
   npm run db:push
   ```

5. **Start the Development Server**
   ```bash
   npm run dev
   ```
   *The Web client will be available at `http://localhost:3000` and the API/WebSocket server at `http://localhost:8080`.*

---

## 🏗 Architecture Overview

Nimbus uses a monorepo structure managed by Turborepo, separating concerns while maintaining shared type safety.

```text
nimbus/
├── apps/
│   ├── web/               # Next.js 16 Client (App Router, UI, Client-side Yjs)
│   ├── api/               # Express Server (Socket.io, Yjs coordination, API Routes)
├── packages/
│   ├── db/                # Prisma ORM, Database schemas, and Migrations
│   ├── ui/                # Shared React components (Design System)
│   ├── types/             # Shared TypeScript interfaces across full-stack
│   └── config/            # Shared ESLint, TSConfig, and Tailwind configurations
└── turbo.json             # Turborepo orchestration and caching rules
```

---

## 🤝 Contributing

We welcome contributions from the community! Whether it's a bug fix, new feature, or documentation improvement, your help makes Nimbus better.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

Please read our [CONTRIBUTING.md](CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

---

## 🛡 Security

If you discover a security vulnerability within Nimbus, please send an e-mail to tejasnasa1908@gmail.com. All security vulnerabilities will be promptly addressed.

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.

---

<div align="center">

**Built with ❤️ for teams everywhere by [Tejas Nasa](https://github.com/tejasnasa)**

[![Follow Tejas](https://img.shields.io/github/followers/tejasnasa?label=Follow&style=social)](https://github.com/tejasnasa)
[![Twitter Follow](https://img.shields.io/twitter/follow/tejasnasa?style=social)](https://twitter.com/tejasnasa)

</div>
