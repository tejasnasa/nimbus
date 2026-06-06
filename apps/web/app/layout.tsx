import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import { SocketProvider } from "../providers/socketProvider";
import "./globals.css";

const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://nimbus.tejasnasa.me"),
  title: "Nimbus - Realtime Collaborative Workspace with AI & Voice Chat",
  description:
    "Real-time collaborative workspace with rich Markdown documents, infinite canvas whiteboards, voice chat, and AI document generation.",
  keywords: [
    "collaborative workspace",
    "real-time collaboration",
    "markdown editor",
    "canvas whiteboard",
    "team workspace",
    "voice chat",
    "AI document generation",
    "multitasking workspace",
  ],
  applicationName: "Nimbus",
  openGraph: {
    type: "website",
    url: "https://nimbus.tejasnasa.me",
    title: "Nimbus - Realtime Collaborative Workspace with AI & Voice Chat",
    description:
      "Real-time collaborative workspace with rich Markdown documents, infinite canvas whiteboards, voice chat, and AI document generation.",
    siteName: "Nimbus",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Nimbus Collaborative Workspace",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Nimbus - Realtime Collaborative Workspace with AI & Voice Chat",
    description:
      "Real-time collaborative workspace with rich Markdown documents, infinite canvas whiteboards, voice chat, and AI document generation.",
    images: ["/og-image.png"],
    creator: "@tejasnasa",
  },
  alternates: {
    canonical: "https://nimbus.tejasnasa.me",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
    },
  },
  other: {
    "application-name": "Nimbus",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={jetBrainsMono.className}>
        <SocketProvider>
          {children}
          <Analytics />
          <SpeedInsights />
        </SocketProvider>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify([
              {
                "@context": "https://schema.org",
                "@type": "WebSite",
                name: "Nimbus",
                url: "https://nimbus.tejasnasa.me",
              },
              {
                "@context": "https://schema.org",
                "@type": "WebApplication",
                name: "Nimbus",
                url: "https://nimbus.tejasnasa.me",
                description:
                  "Real-time collaborative workspace with rich Markdown documents, infinite canvas whiteboards, voice chat, and AI document generation.",
                applicationCategory: "ProductivityApplication",
                operatingSystem: "Web",
              },
            ]),
          }}
        />
      </body>
    </html>
  );
}
