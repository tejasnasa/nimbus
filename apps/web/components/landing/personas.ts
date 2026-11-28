/**
 * @module web/components/landing/personas
 * @description Colours for the sample people shown in the landing page's
 * product previews, as CSS variable references from the shared tokens.
 */

/** Sample names used across the previews. */
export type Persona = "Priya" | "Marco" | "Aiko" | "Sam" | "Nimbus";

/** Colour per sample name. */
export const PERSONA_COLOR: Record<Persona, string> = {
  Priya: "var(--pink)",
  Marco: "var(--sky)",
  Aiko: "var(--amber)",
  Sam: "var(--lilac)",
  Nimbus: "var(--lime)",
};
