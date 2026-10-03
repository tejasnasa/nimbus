/**
 * @module web/components/VantaClouds
 * @description Decorative animated cloud backdrop for the marketing hero,
 * painted by the Vanta CLOUDS2 effect. The hero renders identically without
 * it, so the layer carries no content of its own.
 *
 * @important `three` and `vanta` are fetched from a CDN at runtime rather than
 *            bundled, so the effect is strictly additive: the hero must render
 *            identically when the scripts are blocked, slow, or unsupported.
 *            Every failure path here is swallowed for that reason.
 *
 * @important The script tags carry SRI hashes. Changing either version means
 *            recomputing its hash in the same edit — a mismatched pair makes
 *            the browser refuse to execute the script, which fails silently
 *            because the rejection is swallowed below.
 *
 * @important CLOUDS2's fragment shader samples its noise texture as the cloud
 *            density term, so `texturePath` is load-bearing rather than
 *            decorative: with no texture bound the sampling term collapses to
 *            zero and the whole viewport renders as one solid cloud. The
 *            texture must also tile, because the shader wraps its sample
 *            coordinates through `fract()`.
 */
"use client";

import { useEffect, useRef } from "react";

/** Pinned CDN builds. The SRI hash, not the version string, is what is trusted. */
const THREE_URL =
  "https://cdnjs.cloudflare.com/ajax/libs/three.js/r134/three.min.js";
const THREE_SRI =
  "sha384-9EQoUIJYrv09/oYhSxnw1VpLcfPw3BM9dE7+D/3wGUPeLLa7F9Z6OAoD+i/M6FK9";
const CLOUDS_URL =
  "https://cdnjs.cloudflare.com/ajax/libs/vanta/0.5.24/vanta.clouds2.min.js";
const CLOUDS_SRI =
  "sha384-sWPw18v0tH/6EGaKPNJEfA7eFY8qunnvS4A1BhctKv+aXA5iIaDzwg7Io1coHOnO";

/** Sky palette and the tileable noise texture the shader samples. */
const SKY = {
  backgroundColor: 0x0A0A0D,
  skyColor: 0x1e0433,
  cloudColor: 0x3464c3,
  lightColor: 0xffffff,
  texturePath: "/noise.png",
};

/** The subset of the Vanta effect handle this module needs. */
interface VantaEffect {
  destroy: () => void;
}

declare global {
  interface Window {
    VANTA?: { CLOUDS2?: (options: Record<string, unknown>) => VantaEffect };
    THREE?: unknown;
  }
}

/** Resolves once both CDN scripts have run; cached for the document's lifetime. */
let scriptsReady: Promise<void> | null = null;

/**
 * Appends a script tag and resolves when it has executed.
 *
 * @param src - Absolute URL of the script.
 * @param integrity - SRI hash the browser verifies before executing.
 * @returns A promise that resolves on load and rejects on error.
 */
function loadScript(src: string, integrity: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.integrity = integrity;
    script.crossOrigin = "anonymous";
    // Loaded sequentially rather than in parallel: Vanta reads THREE off the
    // global when it constructs, so the order these execute in is load-bearing.
    script.async = false;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

/**
 * Loads THREE followed by the clouds effect, at most once per document.
 *
 * @returns A promise for the pair being ready to construct an effect.
 */
function loadVanta(): Promise<void> {
  if (!scriptsReady) {
    scriptsReady = loadScript(THREE_URL, THREE_SRI)
      .then(() => loadScript(CLOUDS_URL, CLOUDS_SRI))
      .catch((error: unknown) => {
        // Clear the cache so a later mount can retry a transient CDN failure.
        scriptsReady = null;
        throw error;
      });
  }
  return scriptsReady;
}

/**
 * Renders an empty layer for the clouds to paint into.
 *
 * @param props.className - Positioning utilities for the backdrop layer.
 * @returns A decorative element, or nothing visible when the effect cannot run.
 */
export default function VantaClouds({ className }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let effect: VantaEffect | null = null;
    let cancelled = false;

    void loadVanta()
      .then(() => {
        const CLOUDS2 = window.VANTA?.CLOUDS2;
        if (cancelled || !CLOUDS2 || !containerRef.current) return;
        effect = CLOUDS2({
          el: containerRef.current,
          THREE: window.THREE,
          mouseControls: true,
          touchControls: true,
          gyroControls: false,
          minHeight: 100,
          minWidth: 200,
          scale: 1,
          ...SKY,
        });
      })
      // Decorative only — a blocked CDN or absent WebGL leaves the hero intact.
      .catch(() => {});

    return () => {
      cancelled = true;
      effect?.destroy();
    };
  }, []);

  return <div ref={containerRef} aria-hidden className={className} />;
}
