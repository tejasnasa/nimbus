/**
 * @module web/lib/passwordStrength
 * @description Pure strength estimate for a password as it is typed, used by
 * the signup and reset forms' meter. It counts four independent properties of
 * the string itself; it is a coarse guide, not a guarantee, and the schemas in
 * `@nimbus/types` remain the actual acceptance rules.
 */

/** A password's strength: score 0-4 with the label shown beside the meter. */
export interface PasswordStrength {
  /** Number of satisfied criteria, 0 to 4. */
  score: 0 | 1 | 2 | 3 | 4;
  /** Short human label for the score. */
  label: string;
}

const LABELS = ["Too short", "Weak", "Okay", "Good", "Strong"] as const;

/**
 * Scores a password: 8+ characters earns the first point, then mixed case, a digit, and a symbol or a
 * length of 14 or more.
 *
 * @param password - The password as typed.
 * @returns The score and its label; an empty string scores 0 with the hint
 * "At least 8 characters."
 */
export function scorePassword(password: string): PasswordStrength {
  if (password.length === 0) return { score: 0, label: "At least 8 characters." };
  if (password.length < 8) return { score: 0, label: LABELS[0] };
  let score = 1;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password) || password.length >= 14) score++;
  const clamped = score as PasswordStrength["score"];
  return { score: clamped, label: LABELS[clamped] };
}
