import Link from "next/link";
import Cloud from "@nimbus/ui/icons/Cloud";
import Chat from "@nimbus/ui/icons/Chat";
import CreateDocument from "@nimbus/ui/icons/CreateDocument";
import People from "@nimbus/ui/icons/People";
import Presence from "@nimbus/ui/icons/Presence";
import Lock from "@nimbus/ui/icons/Lock";
import Eye from "@nimbus/ui/icons/Eye";
import Star from "@nimbus/ui/icons/Star";
import Github from "@nimbus/ui/icons/Github";
import Twitter from "@nimbus/ui/icons/Twitter";
import Linkedin from "@nimbus/ui/icons/Linkedin";

export default function LandingPage() {
  return (
    <main className="min-h-dvh bg-(--background) text-(--foreground) overflow-x-hidden">
      <div className="absolute inset-0 bg-grid opacity-20 pointer-events-none" />

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
              className="px-5 py-2.5 text-sm font-medium rounded-xl bg-(--primary) text-(--primary-foreground) hover:opacity-90 active:translate-y-0.5 transition-all duration-200 shadow-lg shadow-(--primary)/20"
            >
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      <section className="relative pt-40 pb-32 px-6">
        <div className="absolute top-20 left-1/4 w-96 h-96 bg-(--primary)/20 rounded-full blur-3xl animate-pulse-glow pointer-events-none" />
        <div
          className="absolute top-40 right-1/4 w-80 h-80 bg-(--chart-2)/15 rounded-full blur-3xl animate-pulse-glow pointer-events-none"
          style={{ animationDelay: "1s" }}
        />
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-150 h-40 bg-(--primary)/10 rounded-full blur-3xl pointer-events-none" />

        <div className="max-w-5xl mx-auto text-center relative">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 mb-8 rounded-full border border-(--border) bg-(--card)/50 backdrop-blur-sm text-sm text-(--muted-foreground) animate-fade-in">
            <span className="w-2 h-2 rounded-full bg-(--chart-2) animate-pulse" />
            Now with AI-Powered NimbusBot
          </div>

          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.1] mb-6 animate-slide-up">
            Where Teams Build,{" "}
            <span className="text-gradient">Chat & Collaborate</span> in Real
            Time
          </h1>

          <p
            className="text-lg sm:text-xl text-(--muted-foreground) max-w-2xl mx-auto mb-10 leading-relaxed animate-slide-up"
            style={{ animationDelay: "0.1s" }}
          >
            Nimbus brings your entire workflow into one space — real-time
            messaging, markdown docs, canvas whiteboards, an AI assistant, and
            workspace management, all designed for developer teams.
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

      <section id="preview" className="relative px-6 pb-32">
        <div className="max-w-6xl mx-auto">
          <div className="relative rounded-2xl border border-(--border) bg-(--card)/50 backdrop-blur-sm overflow-hidden shadow-2xl shadow-(--primary)/5">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-(--border) bg-(--card)/80">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-(--destructive)/60" />
                <div className="w-3 h-3 rounded-full bg-(--chart-1)/60" />
                <div className="w-3 h-3 rounded-full bg-(--chart-2)/60" />
              </div>
              <div className="flex-1 flex justify-center">
                <div className="px-4 py-1 rounded-lg bg-(--secondary) text-xs text-(--muted-foreground)">
                  nimbus.app/workspace
                </div>
              </div>
            </div>
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
          <div className="absolute bottom-20 left-1/2 -translate-x-1/2 w-3/4 h-32 bg-(--primary)/10 rounded-full blur-3xl pointer-events-none" />
        </div>
      </section>

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
            <div className="group p-8 rounded-2xl border border-(--border) bg-(--card)/40 backdrop-blur-sm hover:border-(--primary)/50 hover:bg-(--card)/80 transition-all duration-300 hover:-translate-y-1">
              <div className="w-12 h-12 rounded-xl bg-(--primary)/15 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform duration-300">
                <Chat className="w-6 h-6 text-(--primary)" />
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

            <div className="group p-8 rounded-2xl border border-(--border) bg-(--card)/40 backdrop-blur-sm hover:border-(--primary)/50 hover:bg-(--card)/80 transition-all duration-300 hover:-translate-y-1">
              <div className="w-12 h-12 rounded-xl bg-(--chart-2)/15 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform duration-300">
                <CreateDocument className="w-6 h-6 text-(--chart-2)" />
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

            <div className="group p-8 rounded-2xl border border-(--border) bg-(--card)/40 backdrop-blur-sm hover:border-(--primary)/50 hover:bg-(--card)/80 transition-all duration-300 hover:-translate-y-1">
              <div className="w-12 h-12 rounded-xl bg-(--sidebar-primary)/15 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform duration-300">
                <People className="w-6 h-6 text-(--sidebar-primary)" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Team Workspaces</h3>
              <p className="text-sm text-(--muted-foreground) leading-relaxed">
                Organize your projects into workspaces. Invite team members with
                a code, manage roles, and keep everything scoped and accessible.
              </p>
            </div>

            <div className="group p-8 rounded-2xl border border-(--border) bg-(--card)/40 backdrop-blur-sm hover:border-(--primary)/50 hover:bg-(--card)/80 transition-all duration-300 hover:-translate-y-1">
              <div className="w-12 h-12 rounded-xl bg-(--chart-1)/15 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform duration-300">
                <Presence className="w-6 h-6 text-(--chart-1)" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Live Presence</h3>
              <p className="text-sm text-(--muted-foreground) leading-relaxed">
                Always know who&apos;s online. See live presence indicators,
                avatar groups, and activity status across your entire workspace.
              </p>
            </div>

            <div className="group p-8 rounded-2xl border border-(--border) bg-(--card)/40 backdrop-blur-sm hover:border-(--primary)/50 hover:bg-(--card)/80 transition-all duration-300 hover:-translate-y-1">
              <div className="w-12 h-12 rounded-xl bg-(--destructive)/15 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform duration-300">
                <Lock className="w-6 h-6 text-(--destructive)" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Secure by Design</h3>
              <p className="text-sm text-(--muted-foreground) leading-relaxed">
                Built with BetterAuth for enterprise-grade security. Session
                management, encrypted credentials, and role-based access
                control.
              </p>
            </div>

            <div className="group p-8 rounded-2xl border border-(--border) bg-(--card)/40 backdrop-blur-sm hover:border-(--primary)/50 hover:bg-(--card)/80 transition-all duration-300 hover:-translate-y-1">
              <div className="w-12 h-12 rounded-xl bg-linear-to-br from-(--primary)/20 to-(--chart-2)/20 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform duration-300">
                <Eye className="w-6 h-6 text-gradient" />
              </div>
              <h3 className="text-xl font-semibold mb-2">AI Assistant</h3>
              <p className="text-sm text-(--muted-foreground) leading-relaxed">
                @NimbusBot is your built-in AI assistant. Ask questions, get
                summaries, brainstorm ideas — right inside your workspace chat.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="px-6 py-32">
        <div className="max-w-7xl mx-auto space-y-32">
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
                  Built-in AI with @NimbusBot
                </li>
              </ul>
            </div>
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

          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div
              className="rounded-2xl border border-(--border) bg-(--card)/40 overflow-hidden order-2 lg:order-1"
              id="doc-feature-image-placeholder"
            >
              <div className="w-full aspect-4/3 bg-(--secondary)/30 flex items-center justify-center">
                <div className="text-center text-(--muted-foreground)">
                  <div className="text-4xl mb-3 opacity-40">📝</div>
                  <p className="text-sm font-medium">
                    Markdown Editor Screenshot
                  </p>
                  <p className="text-xs opacity-60 mt-1">
                    Replace with markdown UI screenshot
                  </p>
                </div>
              </div>
            </div>
            <div className="order-1 lg:order-2">
              <span className="inline-block px-3 py-1 mb-4 text-xs font-medium tracking-widest uppercase text-(--chart-2) border border-(--chart-2)/30 rounded-full">
                Markdown
              </span>
              <h3 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
                Write Together, Build Faster
              </h3>
              <p className="text-(--muted-foreground) leading-relaxed mb-6">
                The built-in collaborative markdown editor lets your team work
                on specs, notes, and documentation side-by-side with chat. Get
                real-time updates and seamless team collaboration via Yjs.
              </p>
              <ul className="space-y-3">
                <li className="flex items-center gap-3 text-sm">
                  <span className="w-5 h-5 rounded-full bg-(--chart-2)/20 flex items-center justify-center shrink-0">
                    <span className="w-2 h-2 rounded-full bg-(--chart-2)" />
                  </span>
                  Rich Markdown editing experience
                </li>
                <li className="flex items-center gap-3 text-sm">
                  <span className="w-5 h-5 rounded-full bg-(--chart-2)/20 flex items-center justify-center shrink-0">
                    <span className="w-2 h-2 rounded-full bg-(--chart-2)" />
                  </span>
                  Real-time Yjs collaboration
                </li>
                <li className="flex items-center gap-3 text-sm">
                  <span className="w-5 h-5 rounded-full bg-(--chart-2)/20 flex items-center justify-center shrink-0">
                    <span className="w-2 h-2 rounded-full bg-(--chart-2)" />
                  </span>
                  Side-by-side with messaging
                </li>
              </ul>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <span className="inline-block px-3 py-1 mb-4 text-xs font-medium tracking-widest uppercase text-(--chart-1) border border-(--chart-1)/30 rounded-full">
                Canvas
              </span>
              <h3 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
                Brainstorm Visually
              </h3>
              <p className="text-(--muted-foreground) leading-relaxed mb-6">
                Sometimes words aren&apos;t enough. Switch to an
                Excalidraw-powered canvas mode to sketch out architectures, draw
                flowcharts, or wireframe UI together in real-time.
              </p>
              <ul className="space-y-3">
                <li className="flex items-center gap-3 text-sm">
                  <span className="w-5 h-5 rounded-full bg-(--chart-1)/20 flex items-center justify-center shrink-0">
                    <span className="w-2 h-2 rounded-full bg-(--chart-1)" />
                  </span>
                  Infinite whiteboard powered by Excalidraw
                </li>
                <li className="flex items-center gap-3 text-sm">
                  <span className="w-5 h-5 rounded-full bg-(--chart-1)/20 flex items-center justify-center shrink-0">
                    <span className="w-2 h-2 rounded-full bg-(--chart-1)" />
                  </span>
                  Real-time multiplayer drawing
                </li>
                <li className="flex items-center gap-3 text-sm">
                  <span className="w-5 h-5 rounded-full bg-(--chart-1)/20 flex items-center justify-center shrink-0">
                    <span className="w-2 h-2 rounded-full bg-(--chart-1)" />
                  </span>
                  Tab-based document management
                </li>
              </ul>
            </div>
            <div
              className="rounded-2xl border border-(--border) bg-(--card)/40 overflow-hidden"
              id="canvas-feature-image-placeholder"
            >
              <div className="w-full aspect-4/3 bg-(--secondary)/30 flex items-center justify-center">
                <div className="text-center text-(--muted-foreground)">
                  <div className="text-4xl mb-3 opacity-40">🎨</div>
                  <p className="text-sm font-medium">
                    Canvas Editor Screenshot
                  </p>
                  <p className="text-xs opacity-60 mt-1">
                    Replace with Excalidraw UI screenshot
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

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

            <div className="relative p-8 rounded-2xl border border-(--border) bg-(--card)/40 backdrop-blur-sm text-center group hover:border-(--primary)/40 transition-all duration-300">
              <div className="w-14 h-14 rounded-2xl bg-linear-to-br from-(--primary) to-(--sidebar-primary) flex items-center justify-center mx-auto mb-6 text-xl font-bold text-(--primary-foreground) group-hover:scale-110 transition-transform duration-300">
                3
              </div>
              <h3 className="text-lg font-semibold mb-2">
                Start Collaborating
              </h3>
              <p className="text-sm text-(--muted-foreground) leading-relaxed">
                Chat, edit docs, ask @NimbusBot, and ship features — all from
                one unified workspace. Everything updates in real-time.
              </p>
            </div>
          </div>
        </div>
      </section>

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
            <div className="p-8 rounded-2xl border border-(--border) bg-(--card)/40 backdrop-blur-sm hover:border-(--primary)/30 transition-all duration-300">
              <div className="flex items-center gap-1 mb-4">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} classname="w-4 h-4 text-yellow-300" />
                ))}
              </div>
              <p className="text-sm text-(--muted-foreground) leading-relaxed mb-6">
                &ldquo;Nimbus replaced three tools we were juggling. The
                real-time chat and docs in one workspace is a game-changer for
                our team&apos;s productivity.&rdquo;
              </p>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-(--primary)/20 flex items-center justify-center text-sm font-semibold text-(--primary)">
                  MB
                </div>
                <div>
                  <p className="text-sm font-medium">Manas Bawari</p>
                  <p className="text-xs text-(--muted-foreground)">
                    Fullstack Dev
                  </p>
                </div>
              </div>
            </div>

            <div className="p-8 rounded-2xl border border-(--border) bg-(--card)/40 backdrop-blur-sm hover:border-(--primary)/30 transition-all duration-300">
              <div className="flex items-center gap-1 mb-4">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} classname="w-4 h-4 text-yellow-300" />
                ))}
              </div>
              <p className="text-sm text-(--muted-foreground) leading-relaxed mb-6">
                &ldquo;The collaborative editor is incredibly smooth. It feels
                like Google Docs but designed specifically for developers. We
                use it for all our specs now.&rdquo;
              </p>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-(--chart-2)/20 flex items-center justify-center text-sm font-semibold text-(--chart-2)">
                  PM
                </div>
                <div>
                  <p className="text-sm font-medium">Prantik Maitra</p>
                  <p className="text-xs text-(--muted-foreground)">
                    Machine Learning Engineer
                  </p>
                </div>
              </div>
            </div>

            <div className="p-8 rounded-2xl border border-(--border) bg-(--card)/40 backdrop-blur-sm hover:border-(--primary)/30 transition-all duration-300">
              <div className="flex items-center gap-1 mb-4">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} classname="w-4 h-4 text-yellow-300" />
                ))}
              </div>
              <p className="text-sm text-(--muted-foreground) leading-relaxed mb-6">
                &ldquo;The AI assistant built right into chat is genius. We ask
                @NimbusBot to summarize discussions, and it saves us so much
                time in stand-ups.&rdquo;
              </p>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-(--sidebar-primary)/20 flex items-center justify-center text-sm font-semibold text-(--sidebar-primary)">
                  RR
                </div>
                <div>
                  <p className="text-sm font-medium">Ritik Raj</p>
                  <p className="text-xs text-(--muted-foreground)">
                    Product Engineer
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="px-6 py-32 relative">
        <div className="absolute inset-0 bg-linear-to-t from-(--primary)/5 via-transparent to-transparent pointer-events-none" />

        <div className="max-w-3xl mx-auto text-center relative">
          <h2 className="text-4xl sm:text-5xl font-bold tracking-tight mb-6">
            Ready to Build <span className="text-gradient">Together</span>?
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

      <footer className="border-t border-(--border) bg-(--card)/20">
        <div className="max-w-7xl mx-auto px-6 py-16">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-12">
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
                teams. Powered by AI.
              </p>
            </div>

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
                <Github className="w-5 h-5" />
              </a>
              <a
                href="https://twitter.com/tejasnasa"
                className="hover:text-(--foreground) transition-colors"
                aria-label="Twitter"
              >
                <Twitter className="w-5 h-5" />
              </a>
              <a
                href="https://www.linkedin.com/in/tejasnasa/"
                className="hover:text-(--foreground) transition-colors"
                aria-label="Linkedin"
              >
                <Linkedin className="w-5 h-5" />
              </a>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}
