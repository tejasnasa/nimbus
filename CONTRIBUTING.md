# Contributing to Nimbus

First off, thank you for considering contributing to Nimbus! It's people like you that make Nimbus such a great tool for real-time collaboration. We welcome contributions of all kinds, from bug reports and feature requests to code improvements and documentation updates.

## 🤝 Code of Conduct

By participating in this project, you are expected to uphold our Code of Conduct. Please treat everyone with respect and foster a welcoming and collaborative environment.

## 🛠 Getting Started

Nimbus is structured as a monorepo using [Turborepo](https://turbo.build/).

### Prerequisites

Before you begin, ensure you have the following installed:
- [Node.js](https://nodejs.org/) (v18 or higher)
- [npm](https://www.npmjs.com/) (v9 or higher)
- [PostgreSQL](https://www.postgresql.org/) (v14 or higher)
- [Redis](https://redis.io/) (v6 or higher)

### Local Setup

1. **Fork and clone the repository:**
   ```bash
   git clone https://github.com/YOUR_USERNAME/nimbus.git
   cd nimbus
   ```

2. **Install dependencies:**
   We use `npm` workspaces. Install everything from the root:
   ```bash
   npm install
   ```

3. **Configure Environment Variables:**
   Copy the example environment file and update it with your local credentials:
   ```bash
   cp .env.example .env
   ```
   *(Ensure your local PostgreSQL and Redis instances are running and accessible as defined in `.env`)*

4. **Database Migration:**
   Apply the Prisma schema to your local database:
   ```bash
   npm run db:push
   ```

5. **Start the Development Server:**
   Run the frontend, backend, and all necessary services in parallel:
   ```bash
   npm run dev
   ```

## 🔄 Development Workflow

### Branching Strategy
- Create a new branch for every feature or bug fix.
- Use a descriptive naming convention: `feature/your-feature-name` or `fix/issue-description`.

### Making Changes
- Ensure your code follows the existing style and conventions.
- Write meaningful commit messages. We encourage using [Conventional Commits](https://www.conventionalcommits.org/).
- If you're adding a new feature, please update the documentation accordingly.

### Code Quality
Nimbus enforces code quality through ESLint and Prettier across all packages.
Before submitting a Pull Request, please run:
```bash
npm run lint
```
Ensure there are no linting errors or warnings.

## 🚀 Submitting a Pull Request

When you're ready to share your work:

1. **Push your branch** to your forked repository.
2. **Open a Pull Request** against the `main` branch of the upstream `tejasnasa/nimbus` repository.
3. **Provide a clear description**, giving as much context as possible. Link any relevant issues.
4. **Respond to feedback**. Maintainers will review your PR and may request changes. 

## 🐛 Reporting Bugs & Requesting Features

We use GitHub Issues to track public bugs and feature requests. 

- **Bug Reports:** Please provide a clear and concise description of the issue, steps to reproduce it, and any relevant logs or screenshots. 
- **Feature Requests:** Explain what the feature is, why it's needed, and how it would improve Nimbus.

## 🏗 Architecture Context

When navigating the codebase, it's helpful to understand the monorepo structure:
- `apps/web`: The Next.js 16 frontend application.
- `apps/api`: The Express & Socket.io backend server handling real-time synchronization.
- `packages/db`: Shared Prisma database schemas and client.
- `packages/ui`: Shared React components.

Thank you for your time and contributions! We're excited to see what you build. ☁️
