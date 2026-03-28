import Link from "next/link";
import Cloud from "@nimbus/ui/icons/Cloud";

export default function LandingPage() {
  return (
    <main className="min-h-dvh bg-(--background) text-(--foreground) overflow-x-hidden">
      {/* ─── Navigation ─────────────────────────────── */}
      <nav className="fixed top-0 left-0 right-0 z-50 backdrop-blur-xl bg-(--background)/70 border-b border-(--border)">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2.5 font-semibold text-lg group"
          >
            <div className="flex size-9 items-center justify-center rounded-lg text-(--primary-foreground) group-hover:scale-110 transition-transform duration-300">
              <Cloud />
            </div>
            <span className="tracking-tight">Nimbus</span>
          </Link>

          <div className="hidden md:flex items-center gap-8 text-sm text-(--muted-foreground)">
            <a
              href="#features"
              className="hover:text-(--foreground) transition-colors duration-200"
            >
              Features
            </a>
            <a
              href="#preview"
              className="hover:text-(--foreground) transition-colors duration-200"
            >
              Preview
            </a>
            <a
              href="#how-it-works"
              className="hover:text-(--foreground) transition-colors duration-200"
            >
              How It Works
            </a>
            <a
              href="#testimonials"
              className="hover:text-(--foreground) transition-colors duration-200"
            >
              Testimonials
            </a>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="px-5 py-2.5 text-sm font-medium rounded-lg bg-(--primary) text-(--primary-foreground) hover:opacity-90 active:translate-y-0.5 transition-all duration-200"
            >
              Sign Up Now
            </Link>
          </div>
        </div>
      </nav>

      {/* ─── Hero Section ────────────────────────────── */}
      <section className="relative pt-40 pb-32 px-6">
        {/* Gradient orbs */}
        <div className="absolute top-20 left-1/4 w-96 h-96 bg-(--primary)/20 rounded-full blur-3xl animate-pulse pointer-events-none" />
        <div
          className="absolute top-40 right-1/4 w-80 h-80 bg-(--chart-2)/15 rounded-full blur-3xl animate-pulse pointer-events-none"
          style={{ animationDelay: "1s" }}
        />
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[600px] h-40 bg-(--primary)/10 rounded-full blur-3xl pointer-events-none" />

        <div className="max-w-5xl mx-auto text-center relative">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 mb-8 rounded-full border border-(--border) bg-(--card)/50 backdrop-blur-sm text-sm text-(--muted-foreground) animate-fade-in">
            <span className="w-2 h-2 rounded-full bg-(--chart-2) animate-pulse" />
            Now in Public Beta
          </div>

          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.1] mb-6 animate-slide-up">
            Where Teams Build,{" "}
            <span className="text-transparent bg-clip-text bg-linear-to-r from-(--primary) via-(--chart-2) to-(--sidebar-primary)">
              Chat & Collaborate
            </span>{" "}
            in Real Time
          </h1>

          <p
            className="text-lg sm:text-xl text-(--muted-foreground) max-w-2xl mx-auto mb-10 leading-relaxed animate-slide-up"
            style={{ animationDelay: "0.1s" }}
          >
            Nimbus brings your entire workflow into one space — real-time
            messaging, collaborative documents, and workspace management, all
            designed for developer teams.
          </p>

          <div
            className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-slide-up"
            style={{ animationDelay: "0.2s" }}
          >
            <Link
              href="/login"
              className="px-8 py-3.5 text-base font-medium rounded-xl bg-(--primary) text-(--primary-foreground) hover:opacity-90 active:translate-y-0.5 transition-all duration-200 shadow-lg shadow-(--primary)/25"
            >
              Start Collaborating — Free
            </Link>
            <a
              href="#preview"
              className="px-8 py-3.5 text-base font-medium rounded-xl border border-(--border) text-(--muted-foreground) hover:text-(--foreground) hover:border-(--muted-foreground) transition-all duration-200"
            >
              See It In Action ↓
            </a>
          </div>

          {/* Stats */}
          <div
            className="flex items-center justify-center gap-12 mt-16 text-sm text-(--muted-foreground) animate-slide-up"
            style={{ animationDelay: "0.3s" }}
          >
            <div className="flex flex-col items-center gap-1">
              <span className="text-3xl font-bold text-(--foreground)">
                50+
              </span>
              <span>Active Teams</span>
            </div>
            <div className="w-px h-10 bg-(--border)" />
            <div className="flex flex-col items-center gap-1">
              <span className="text-3xl font-bold text-(--foreground)">
                10k+
              </span>
              <span>Messages Sent</span>
            </div>
            <div className="w-px h-10 bg-(--border)" />
            <div className="flex flex-col items-center gap-1">
              <span className="text-3xl font-bold text-(--foreground)">
                99.9%
              </span>
              <span>Uptime</span>
            </div>
          </div>
        </div>
      </section>

      {/* ─── App Preview (Hero Image Placeholder) ──── */}
      <section id="preview" className="relative px-6 pb-32">
        <div className="max-w-6xl mx-auto">
          <div className="relative rounded-2xl border border-(--border) bg-(--card)/50 backdrop-blur-sm overflow-hidden shadow-2xl shadow-(--primary)/5">
            {/* Browser chrome */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-(--border) bg-(--card)/80">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-(--destructive)/60" />
                <div className="w-3 h-3 rounded-full bg-(--chart-1)/60" />
                <div className="w-3 h-3 rounded-full bg-(--chart-2)/60" />
              </div>
              <div className="flex-1 flex justify-center">
                <div className="px-4 py-1 rounded-md bg-(--secondary) text-xs text-(--muted-foreground)">
                  nimbus.app/workspace
                </div>
              </div>
            </div>
            {/* IMAGE PLACEHOLDER — App Screenshot */}
            <div
              className="w-full aspect-video bg-(--secondary)/30 flex items-center justify-center"
              id="hero-image-placeholder"
            >
              <div className="text-center text-(--muted-foreground)">
                <div className="text-5xl mb-3 opacity-40">📸</div>
                <p className="text-sm font-medium">App Screenshot</p>
                <p className="text-xs opacity-60 mt-1">
                  Replace with actual workspace screenshot (1920×1080)
                </p>
              </div>
            </div>
          </div>
          {/* Glow effect under the preview */}
          <div className="absolute bottom-20 left-1/2 -translate-x-1/2 w-3/4 h-32 bg-(--primary)/10 rounded-full blur-3xl pointer-events-none" />
        </div>
      </section>

      {/* ─── Features Grid ───────────────────────────── */}
      <section id="features" className="px-6 py-32 relative">
        <div className="absolute inset-0 bg-linear-to-b from-transparent via-(--card)/30 to-transparent pointer-events-none" />

        <div className="max-w-7xl mx-auto relative">
          <div className="text-center mb-16">
            <span className="inline-block px-3 py-1 mb-4 text-xs font-medium tracking-widest uppercase text-(--primary) border border-(--primary)/30 rounded-full">
              Features
            </span>
            <h2 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4">
              Everything Your Team Needs
            </h2>
            <p className="text-lg text-(--muted-foreground) max-w-xl mx-auto">
              From instant messaging to collaborative docs — Nimbus gives your
              team a unified space to create, communicate, and ship.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Feature 1 */}
            <div className="group p-8 rounded-2xl border border-(--border) bg-(--card)/40 backdrop-blur-sm hover:border-(--primary)/50 hover:bg-(--card)/80 transition-all duration-300 hover:-translate-y-1">
              <div className="w-12 h-12 rounded-xl bg-(--primary)/15 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform duration-300">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="w-6 h-6 text-(--primary)"
                >
                  <path d="M6.45455 19L2 22.5V4C2 3.44772 2.44772 3 3 3H21C21.5523 3 22 3.44772 22 4V18C22 18.5523 21.5523 19 21 19H6.45455ZM7 10V12H9V10H7ZM11 10V12H13V10H11ZM15 10V12H17V10H15Z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold mb-2">
                Real-Time Messaging
              </h3>
              <p className="text-sm text-(--muted-foreground) leading-relaxed">
                Instant messaging with live updates. See who&apos;s online,
                typing indicators, and threaded conversations — all in real-time
                via WebSockets.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="group p-8 rounded-2xl border border-(--border) bg-(--card)/40 backdrop-blur-sm hover:border-(--primary)/50 hover:bg-(--card)/80 transition-all duration-300 hover:-translate-y-1">
              <div className="w-12 h-12 rounded-xl bg-(--chart-2)/15 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform duration-300">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="w-6 h-6 text-(--chart-2)"
                >
                  <path d="M21 6.75736L19 8.75736V4H10V9H5V20H19V17.2426L21 15.2426V21C21 21.5523 20.5523 22 20 22H4C3.44772 22 3 21.5523 3 21V8L9.00319 2H20C20.5523 2 21 2.44772 21 3V6.75736ZM21.7782 8.80761L23.1924 10.2218L15.4142 18L13.9979 17.9979L14 16.5858L21.7782 8.80761Z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold mb-2">
                Collaborative Documents
              </h3>
              <p className="text-sm text-(--muted-foreground) leading-relaxed">
                Edit documents together in real-time. Multiple cursors, live
                syncing, and tab-based document management built right into your
                workspace.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="group p-8 rounded-2xl border border-(--border) bg-(--card)/40 backdrop-blur-sm hover:border-(--primary)/50 hover:bg-(--card)/80 transition-all duration-300 hover:-translate-y-1">
              <div className="w-12 h-12 rounded-xl bg-(--sidebar-primary)/15 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform duration-300">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="w-6 h-6 text-(--sidebar-primary)"
                >
                  <path d="M2 22C2 17.5817 5.58172 14 10 14C14.4183 14 18 17.5817 18 22H2ZM10 13C6.685 13 4 10.315 4 7C4 3.685 6.685 1 10 1C13.315 1 16 3.685 16 7C16 10.315 13.315 13 10 13ZM18 14.1696C20.8377 15.578 22.8601 18.3522 23 21.6L23.0044 22H20C20 18.9398 18.7617 16.163 16.7917 14.1445C17.1703 14.1126 17.5706 14.0942 18 14.0942L18 14.1696ZM18 13C15.7909 13 14 11.2091 14 9C14 6.79086 15.7909 5 18 5C20.2091 5 22 6.79086 22 9C22 11.2091 20.2091 13 18 13Z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold mb-2">Team Workspaces</h3>
              <p className="text-sm text-(--muted-foreground) leading-relaxed">
                Organize your projects into workspaces. Invite team members with
                a code, manage roles, and keep everything scoped and accessible.
              </p>
            </div>

            {/* Feature 4 */}
            <div className="group p-8 rounded-2xl border border-(--border) bg-(--card)/40 backdrop-blur-sm hover:border-(--primary)/50 hover:bg-(--card)/80 transition-all duration-300 hover:-translate-y-1">
              <div className="w-12 h-12 rounded-xl bg-(--chart-1)/15 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform duration-300">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="w-6 h-6 text-(--chart-1)"
                >
                  <path d="M12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22ZM12 16C14.2091 16 16 14.2091 16 12C16 9.79086 14.2091 8 12 8C9.79086 8 8 9.79086 8 12C8 14.2091 9.79086 16 12 16Z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold mb-2">Live Presence</h3>
              <p className="text-sm text-(--muted-foreground) leading-relaxed">
                Always know who&apos;s online. See live presence indicators,
                avatar groups, and activity status across your entire workspace.
              </p>
            </div>

            {/* Feature 5 */}
            <div className="group p-8 rounded-2xl border border-(--border) bg-(--card)/40 backdrop-blur-sm hover:border-(--primary)/50 hover:bg-(--card)/80 transition-all duration-300 hover:-translate-y-1">
              <div className="w-12 h-12 rounded-xl bg-(--destructive)/15 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform duration-300">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="w-6 h-6 text-(--destructive)"
                >
                  <path d="M18 8H20C20.5523 8 21 8.44772 21 9V21C21 21.5523 20.5523 22 20 22H4C3.44772 22 3 21.5523 3 21V9C3 8.44772 3.44772 8 4 8H6V7C6 3.68629 8.68629 1 12 1C15.3137 1 18 3.68629 18 7V8ZM11 15.7324V18H13V15.7324C13.5978 15.3866 14 14.7403 14 14C14 12.8954 13.1046 12 12 12C10.8954 12 10 12.8954 10 14C10 14.7403 10.4022 15.3866 11 15.7324ZM16 8V7C16 4.79086 14.2091 3 12 3C9.79086 3 8 4.79086 8 7V8H16Z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold mb-2">Secure by Design</h3>
              <p className="text-sm text-(--muted-foreground) leading-relaxed">
                Built with BetterAuth for enterprise-grade security. Session
                management, encrypted credentials, and role-based access
                control.
              </p>
            </div>

            {/* Feature 6 */}
            <div className="group p-8 rounded-2xl border border-(--border) bg-(--card)/40 backdrop-blur-sm hover:border-(--primary)/50 hover:bg-(--card)/80 transition-all duration-300 hover:-translate-y-1">
              <div className="w-12 h-12 rounded-xl bg-(--ring)/20 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform duration-300">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="w-6 h-6 text-(--ring)"
                >
                  <path d="M13 10H18L12 16.5L6 10H11V4H13V10ZM4 19H20V12H22V20C22 20.5523 21.5523 21 21 21H3C2.44772 21 2 20.5523 2 20V12H4V19Z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold mb-2">Instant Setup</h3>
              <p className="text-sm text-(--muted-foreground) leading-relaxed">
                Create a workspace and start collaborating in under a minute. No
                complicated setup, no credit card — just sign up and go.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Feature Deep Dive ───────────────────────── */}
      <section className="px-6 py-32">
        <div className="max-w-7xl mx-auto space-y-32">
          {/* Deep dive 1: Messaging */}
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <span className="inline-block px-3 py-1 mb-4 text-xs font-medium tracking-widest uppercase text-(--primary) border border-(--primary)/30 rounded-full">
                Messaging
              </span>
              <h3 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
                Conversations That Flow Naturally
              </h3>
              <p className="text-(--muted-foreground) leading-relaxed mb-6">
                Nimbus chat isn&apos;t just another messaging tool. It&apos;s
                built from the ground up with Socket.IO for zero-latency
                communication. Messages appear instantly, with typing indicators
                and presence awareness that make remote collaboration feel like
                sitting next to your teammates.
              </p>
              <ul className="space-y-3">
                <li className="flex items-center gap-3 text-sm">
                  <span className="w-5 h-5 rounded-full bg-(--chart-2)/20 flex items-center justify-center shrink-0">
                    <span className="w-2 h-2 rounded-full bg-(--chart-2)" />
                  </span>
                  Instant message delivery via WebSockets
                </li>
                <li className="flex items-center gap-3 text-sm">
                  <span className="w-5 h-5 rounded-full bg-(--chart-2)/20 flex items-center justify-center shrink-0">
                    <span className="w-2 h-2 rounded-full bg-(--chart-2)" />
                  </span>
                  Typing indicators & read receipts
                </li>
                <li className="flex items-center gap-3 text-sm">
                  <span className="w-5 h-5 rounded-full bg-(--chart-2)/20 flex items-center justify-center shrink-0">
                    <span className="w-2 h-2 rounded-full bg-(--chart-2)" />
                  </span>
                  Persistent history across sessions
                </li>
              </ul>
            </div>
            {/* IMAGE PLACEHOLDER — Chat Feature */}
            <div
              className="rounded-2xl border border-(--border) bg-(--card)/40 overflow-hidden"
              id="chat-feature-image-placeholder"
            >
              <div className="w-full aspect-4/3 bg-(--secondary)/30 flex items-center justify-center">
                <div className="text-center text-(--muted-foreground)">
                  <div className="text-4xl mb-3 opacity-40">💬</div>
                  <p className="text-sm font-medium">Chat Feature Screenshot</p>
                  <p className="text-xs opacity-60 mt-1">
                    Replace with messaging UI screenshot
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Deep dive 2: Documents */}
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            {/* IMAGE PLACEHOLDER — Document Editor */}
            <div
              className="rounded-2xl border border-(--border) bg-(--card)/40 overflow-hidden order-2 lg:order-1"
              id="doc-feature-image-placeholder"
            >
              <div className="w-full aspect-4/3 bg-(--secondary)/30 flex items-center justify-center">
                <div className="text-center text-(--muted-foreground)">
                  <div className="text-4xl mb-3 opacity-40">📝</div>
                  <p className="text-sm font-medium">
                    Document Editor Screenshot
                  </p>
                  <p className="text-xs opacity-60 mt-1">
                    Replace with editor UI screenshot
                  </p>
                </div>
              </div>
            </div>
            <div className="order-1 lg:order-2">
              <span className="inline-block px-3 py-1 mb-4 text-xs font-medium tracking-widest uppercase text-(--chart-2) border border-(--chart-2)/30 rounded-full">
                Documents
              </span>
              <h3 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
                Write Together, Build Faster
              </h3>
              <p className="text-(--muted-foreground) leading-relaxed mb-6">
                The built-in collaborative editor lets your team work on specs,
                notes, and documentation side-by-side with chat. Tab management
                keeps multiple docs organized, and real-time sync means everyone
                sees every change as it happens.
              </p>
              <ul className="space-y-3">
                <li className="flex items-center gap-3 text-sm">
                  <span className="w-5 h-5 rounded-full bg-(--primary)/20 flex items-center justify-center shrink-0">
                    <span className="w-2 h-2 rounded-full bg-(--primary)" />
                  </span>
                  Multi-cursor collaborative editing
                </li>
                <li className="flex items-center gap-3 text-sm">
                  <span className="w-5 h-5 rounded-full bg-(--primary)/20 flex items-center justify-center shrink-0">
                    <span className="w-2 h-2 rounded-full bg-(--primary)" />
                  </span>
                  Tab-based document management
                </li>
                <li className="flex items-center gap-3 text-sm">
                  <span className="w-5 h-5 rounded-full bg-(--primary)/20 flex items-center justify-center shrink-0">
                    <span className="w-2 h-2 rounded-full bg-(--primary)" />
                  </span>
                  Auto-save & version history
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ─── How It Works ────────────────────────────── */}
      <section id="how-it-works" className="px-6 py-32 relative">
        <div className="absolute inset-0 bg-linear-to-b from-transparent via-(--card)/30 to-transparent pointer-events-none" />

        <div className="max-w-5xl mx-auto relative">
          <div className="text-center mb-16">
            <span className="inline-block px-3 py-1 mb-4 text-xs font-medium tracking-widest uppercase text-(--chart-2) border border-(--chart-2)/30 rounded-full">
              How It Works
            </span>
            <h2 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4">
              Up and Running in 3 Steps
            </h2>
            <p className="text-lg text-(--muted-foreground) max-w-xl mx-auto">
              No complex onboarding. No enterprise sales calls. Just start
              building with your team.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {/* Step 1 */}
            <div className="relative p-8 rounded-2xl border border-(--border) bg-(--card)/40 backdrop-blur-sm text-center group hover:border-(--primary)/40 transition-all duration-300">
              <div className="w-14 h-14 rounded-2xl bg-linear-to-br from-(--primary) to-(--sidebar-primary) flex items-center justify-center mx-auto mb-6 text-xl font-bold text-(--primary-foreground) group-hover:scale-110 transition-transform duration-300">
                1
              </div>
              <h3 className="text-lg font-semibold mb-2">
                Create Your Account
              </h3>
              <p className="text-sm text-(--muted-foreground) leading-relaxed">
                Sign up with your email in seconds. No credit card, no phone
                verification — just your name and password.
              </p>
            </div>

            {/* Step 2 */}
            <div className="relative p-8 rounded-2xl border border-(--border) bg-(--card)/40 backdrop-blur-sm text-center group hover:border-(--primary)/40 transition-all duration-300">
              <div className="w-14 h-14 rounded-2xl bg-linear-to-br from-(--primary) to-(--sidebar-primary) flex items-center justify-center mx-auto mb-6 text-xl font-bold text-(--primary-foreground) group-hover:scale-110 transition-transform duration-300">
                2
              </div>
              <h3 className="text-lg font-semibold mb-2">Set Up a Workspace</h3>
              <p className="text-sm text-(--muted-foreground) leading-relaxed">
                Create a workspace for your project. Give it a name, add a
                description, and share the invite code with your team.
              </p>
            </div>

            {/* Step 3 */}
            <div className="relative p-8 rounded-2xl border border-(--border) bg-(--card)/40 backdrop-blur-sm text-center group hover:border-(--primary)/40 transition-all duration-300">
              <div className="w-14 h-14 rounded-2xl bg-linear-to-br from-(--primary) to-(--sidebar-primary) flex items-center justify-center mx-auto mb-6 text-xl font-bold text-(--primary-foreground) group-hover:scale-110 transition-transform duration-300">
                3
              </div>
              <h3 className="text-lg font-semibold mb-2">
                Start Collaborating
              </h3>
              <p className="text-sm text-(--muted-foreground) leading-relaxed">
                Chat, edit docs, and ship features — all from one unified
                workspace. Everything updates in real-time.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Testimonials ────────────────────────────── */}
      <section id="testimonials" className="px-6 py-32">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <span className="inline-block px-3 py-1 mb-4 text-xs font-medium tracking-widest uppercase text-(--sidebar-primary) border border-(--sidebar-primary)/30 rounded-full">
              Testimonials
            </span>
            <h2 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4">
              Loved by Developer Teams
            </h2>
            <p className="text-lg text-(--muted-foreground) max-w-xl mx-auto">
              See what teams are saying about building with Nimbus.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {/* Testimonial 1 */}
            <div className="p-8 rounded-2xl border border-(--border) bg-(--card)/40 backdrop-blur-sm hover:border-(--primary)/30 transition-all duration-300">
              <div className="flex items-center gap-1 mb-4">
                {[...Array(5)].map((_, i) => (
                  <svg
                    key={i}
                    className="w-4 h-4 text-(--chart-1)"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M12 18.26L4.94658 22.2082L6.52121 14.2799L0.587213 8.7918L8.61493 7.84006L12 0.5L15.3851 7.84006L23.4128 8.7918L17.4788 14.2799L19.0534 22.2082L12 18.26Z" />
                  </svg>
                ))}
              </div>
              <p className="text-sm text-(--muted-foreground) leading-relaxed mb-6">
                &ldquo;Nimbus replaced three tools we were juggling. The
                real-time chat and docs in one workspace is a game-changer for
                our team&apos;s productivity.&rdquo;
              </p>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-(--primary)/20 flex items-center justify-center text-sm font-semibold text-(--primary)">
                  AK
                </div>
                <div>
                  <p className="text-sm font-medium">Alex Kim</p>
                  <p className="text-xs text-(--muted-foreground)">
                    Engineering Lead, Vertex Labs
                  </p>
                </div>
              </div>
            </div>

            {/* Testimonial 2 */}
            <div className="p-8 rounded-2xl border border-(--border) bg-(--card)/40 backdrop-blur-sm hover:border-(--primary)/30 transition-all duration-300">
              <div className="flex items-center gap-1 mb-4">
                {[...Array(5)].map((_, i) => (
                  <svg
                    key={i}
                    className="w-4 h-4 text-(--chart-1)"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M12 18.26L4.94658 22.2082L6.52121 14.2799L0.587213 8.7918L8.61493 7.84006L12 0.5L15.3851 7.84006L23.4128 8.7918L17.4788 14.2799L19.0534 22.2082L12 18.26Z" />
                  </svg>
                ))}
              </div>
              <p className="text-sm text-(--muted-foreground) leading-relaxed mb-6">
                &ldquo;The collaborative editor is incredibly smooth. It feels
                like Google Docs but designed specifically for developers. We
                use it for all our specs now.&rdquo;
              </p>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-(--chart-2)/20 flex items-center justify-center text-sm font-semibold text-(--chart-2)">
                  SP
                </div>
                <div>
                  <p className="text-sm font-medium">Sarah Patel</p>
                  <p className="text-xs text-(--muted-foreground)">
                    Fullstack Dev, NovaSoft
                  </p>
                </div>
              </div>
            </div>

            {/* Testimonial 3 */}
            <div className="p-8 rounded-2xl border border-(--border) bg-(--card)/40 backdrop-blur-sm hover:border-(--primary)/30 transition-all duration-300">
              <div className="flex items-center gap-1 mb-4">
                {[...Array(5)].map((_, i) => (
                  <svg
                    key={i}
                    className="w-4 h-4 text-(--chart-1)"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M12 18.26L4.94658 22.2082L6.52121 14.2799L0.587213 8.7918L8.61493 7.84006L12 0.5L15.3851 7.84006L23.4128 8.7918L17.4788 14.2799L19.0534 22.2082L12 18.26Z" />
                  </svg>
                ))}
              </div>
              <p className="text-sm text-(--muted-foreground) leading-relaxed mb-6">
                &ldquo;Setting up a workspace takes seconds and the invite
                system is so simple. Even our non-technical PM jumped in and
                started collaborating immediately.&rdquo;
              </p>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-(--sidebar-primary)/20 flex items-center justify-center text-sm font-semibold text-(--sidebar-primary)">
                  JR
                </div>
                <div>
                  <p className="text-sm font-medium">Jake Rivera</p>
                  <p className="text-xs text-(--muted-foreground)">
                    CTO, Pulse Studios
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── CTA Section ─────────────────────────────── */}
      <section className="px-6 py-32 relative">
        <div className="absolute inset-0 bg-linear-to-t from-(--primary)/5 via-transparent to-transparent pointer-events-none" />

        <div className="max-w-3xl mx-auto text-center relative">
          <h2 className="text-4xl sm:text-5xl font-bold tracking-tight mb-6">
            Ready to Build{" "}
            <span className="text-transparent bg-clip-text bg-linear-to-r from-(--primary) to-(--sidebar-primary)">
              Together
            </span>
            ?
          </h2>
          <p className="text-lg text-(--muted-foreground) mb-10 max-w-lg mx-auto">
            Join the teams already shipping faster with Nimbus. Free to start,
            no strings attached.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/login"
              className="px-8 py-4 text-base font-medium rounded-xl bg-(--primary) text-(--primary-foreground) hover:opacity-90 active:translate-y-0.5 transition-all duration-200 shadow-lg shadow-(--primary)/25"
            >
              Get Started for Free →
            </Link>
          </div>
        </div>
      </section>

      {/* ─── Footer ──────────────────────────────────── */}
      <footer className="border-t border-(--border) bg-(--card)/20">
        <div className="max-w-7xl mx-auto px-6 py-16">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-12">
            {/* Brand */}
            <div className="lg:col-span-1">
              <Link
                href="/"
                className="flex items-center gap-2.5 font-semibold text-lg mb-4"
              >
                <div className="flex size-8 items-center justify-center rounded-lg text-(--primary-foreground)">
                  <Cloud />
                </div>
                Nimbus
              </Link>
              <p className="text-sm text-(--muted-foreground) leading-relaxed">
                Communication and collaboration platform built for developer
                teams.
              </p>
            </div>

            {/* Product */}
            <div>
              <h4 className="font-semibold text-sm mb-4 uppercase tracking-wider text-(--muted-foreground)">
                Product
              </h4>
              <ul className="space-y-3 text-sm">
                <li>
                  <a
                    href="#features"
                    className="text-(--muted-foreground) hover:text-(--foreground) transition-colors"
                  >
                    Features
                  </a>
                </li>
                <li>
                  <a
                    href="#preview"
                    className="text-(--muted-foreground) hover:text-(--foreground) transition-colors"
                  >
                    Preview
                  </a>
                </li>
                <li>
                  <a
                    href="#how-it-works"
                    className="text-(--muted-foreground) hover:text-(--foreground) transition-colors"
                  >
                    How It Works
                  </a>
                </li>
                <li>
                  <a
                    href="#"
                    className="text-(--muted-foreground) hover:text-(--foreground) transition-colors"
                  >
                    Changelog
                  </a>
                </li>
              </ul>
            </div>

            {/* Resources */}
            <div>
              <h4 className="font-semibold text-sm mb-4 uppercase tracking-wider text-(--muted-foreground)">
                Resources
              </h4>
              <ul className="space-y-3 text-sm">
                <li>
                  <a
                    href="#"
                    className="text-(--muted-foreground) hover:text-(--foreground) transition-colors"
                  >
                    Documentation
                  </a>
                </li>
                <li>
                  <a
                    href="#"
                    className="text-(--muted-foreground) hover:text-(--foreground) transition-colors"
                  >
                    Community
                  </a>
                </li>
                <li>
                  <a
                    href="#"
                    className="text-(--muted-foreground) hover:text-(--foreground) transition-colors"
                  >
                    API Reference
                  </a>
                </li>
                <li>
                  <a
                    href="#"
                    className="text-(--muted-foreground) hover:text-(--foreground) transition-colors"
                  >
                    Support
                  </a>
                </li>
              </ul>
            </div>

            {/* Legal */}
            <div>
              <h4 className="font-semibold text-sm mb-4 uppercase tracking-wider text-(--muted-foreground)">
                Legal
              </h4>
              <ul className="space-y-3 text-sm">
                <li>
                  <a
                    href="#"
                    className="text-(--muted-foreground) hover:text-(--foreground) transition-colors"
                  >
                    Privacy Policy
                  </a>
                </li>
                <li>
                  <a
                    href="#"
                    className="text-(--muted-foreground) hover:text-(--foreground) transition-colors"
                  >
                    Terms of Service
                  </a>
                </li>
                <li>
                  <a
                    href="#"
                    className="text-(--muted-foreground) hover:text-(--foreground) transition-colors"
                  >
                    Cookie Policy
                  </a>
                </li>
              </ul>
            </div>
          </div>

          <div className="mt-12 pt-8 border-t border-(--border) flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-(--muted-foreground)">
            <p>Made by Tejas Nasa.</p>
            <div className="flex items-center gap-6">
              <a
                href="https://github.com/tejasnasa/nimbus"
                className="hover:text-(--foreground) transition-colors"
                aria-label="GitHub"
              >
                <svg
                  className="w-5 h-5"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M12 2C6.47715 2 2 6.47715 2 12C2 16.4183 4.86648 20.1668 8.83882 21.489C9.33882 21.589 9.52148 21.274 9.52148 21.007V19.1697C6.72613 19.7827 6.13932 17.7827 6.13932 17.7827C5.68446 16.618 5.02877 16.3048 5.02877 16.3048C4.12124 15.6727 5.09719 15.6855 5.09719 15.6855C6.10148 15.756 6.63032 16.736 6.63032 16.736C7.52148 18.2824 8.97032 17.8473 9.55948 17.5855C9.64948 16.927 9.92948 16.4905 10.2395 16.2441C7.96948 15.9934 5.58948 15.0656 5.58948 11.2418C5.58948 10.1383 5.98148 9.23401 6.64948 8.52401C6.54648 8.27301 6.20148 7.24065 6.74648 5.85234C6.74648 5.85234 7.58648 5.58534 9.49948 6.88634C10.2995 6.66634 11.1495 6.55634 11.9995 6.55234C12.8495 6.55634 13.6995 6.66634 14.4995 6.88634C16.4125 5.58534 17.2515 5.85234 17.2515 5.85234C17.7975 7.24065 17.4525 8.27301 17.3495 8.52401C18.0185 9.23401 18.4085 10.1383 18.4085 11.2418C18.4085 15.0768 16.0245 15.9898 13.7475 16.2327C14.1355 16.5472 14.4895 17.163 14.4895 18.098V21.007C14.4895 21.277 14.6695 21.596 15.1795 21.487C19.1474 20.1614 22 16.4149 22 12C22 6.47715 17.5228 2 12 2Z" />
                </svg>
              </a>
              <a
                href="https://twitter.com/tejasnasa"
                className="hover:text-(--foreground) transition-colors"
                aria-label="Twitter"
              >
                <svg
                  className="w-5 h-5"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M18.2048 2.25H21.5128L14.2858 10.51L22.7878 21.75H16.1308L10.9168 14.933L4.95084 21.75H1.64084L9.37084 12.915L1.21484 2.25H8.04084L12.7538 8.481L18.2048 2.25ZM17.0438 19.77H18.8768L7.04484 4.126H5.07784L17.0438 19.77Z" />
                </svg>
              </a>
              <a
                href="https://www.linkedin.com/in/tejasnasa/"
                className="hover:text-(--foreground) transition-colors"
                aria-label="Linkedin"
              >
                <svg
                  className="w-5 h-5"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M20.317 4.3698C18.7873 3.71042 17.147 3.24078 15.4319 3C15.4007 3.00665 15.3695 3.02121 15.354 3.05032C15.1473 3.42077 14.9182 3.91001 14.7547 4.2993C12.9242 4.07302 11.1039 4.07302 9.30373 4.2993C9.14022 3.90132 8.90263 3.42077 8.69469 3.05032C8.67919 3.02254 8.64799 3.00798 8.61679 3C6.9025 3.23945 5.26219 3.70909 3.7317 4.36847C3.71872 4.37445 3.70699 4.38442 3.69901 4.39702C0.541397 9.18455 -0.323695 13.8541 0.100695 18.4648C0.103 18.4914 0.118493 18.5167 0.139697 18.5313C2.18193 20.0127 4.17174 20.927 6.12228 21.5522C6.15348 21.5622 6.18601 21.5502 6.20671 21.5249C6.66843 20.8956 7.08061 20.2287 7.43354 19.5252C7.45524 19.4827 7.43487 19.4327 7.39015 19.4152C6.72893 19.1695 6.09695 18.8675 5.48973 18.5239C5.44126 18.4965 5.4375 18.4283 5.48223 18.3963C5.60811 18.3028 5.73404 18.2054 5.85409 18.1073C5.87604 18.0898 5.90721 18.0861 5.93272 18.097C10.0219 19.9479 14.4317 19.9479 18.4743 18.097C18.4998 18.0849 18.531 18.0886 18.5541 18.1061C18.6742 18.2042 18.8001 18.3028 18.9272 18.3963C18.9719 18.4283 18.9694 18.4965 18.9209 18.5239C18.3137 18.8737 17.6818 19.1695 17.0193 19.414C16.9746 19.4315 16.955 19.4827 16.9767 19.5252C17.3371 20.2275 17.7493 20.8944 18.2023 21.5237C18.2218 21.5502 18.2556 21.5622 18.2868 21.5522C20.2487 20.927 22.2385 20.0127 24.2808 18.5313C24.3033 18.5167 24.3175 18.4927 24.3198 18.4661C24.8223 13.1352 23.4672 8.50505 20.3482 4.39835C20.3415 4.38442 20.3298 4.37445 20.317 4.3698ZM8.06819 15.6813C6.87585 15.6813 5.90094 14.6048 5.90094 13.2866C5.90094 11.9683 6.85759 10.8918 8.06819 10.8918C9.28879 10.8918 10.2549 11.978 10.2355 13.2866C10.2355 14.6048 9.27932 15.6813 8.06819 15.6813ZM16.3583 15.6813C15.1659 15.6813 14.191 14.6048 14.191 13.2866C14.191 11.9683 15.1477 10.8918 16.3583 10.8918C17.5789 10.8918 18.545 11.978 18.5256 13.2866C18.5256 14.6048 17.5789 15.6813 16.3583 15.6813Z" />
                </svg>
              </a>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}
