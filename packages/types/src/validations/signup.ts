/**
 * @module validations/signup
 * @description Zod schema for account signup with password strength rules.
 */

import { z } from "zod";

/** Signup form payload — password must contain a letter, number, and special char. */
export const signupSchema = z.object({
  name: z
    .string()
    .min(2, { error: "Full name must be at least 2 characters long." }),
  email: z.email({ error: "Enter a valid email." }).trim(),
  password: z
    .string()
    .min(8, { error: "Password must be at least 8 characters long" })
    .regex(/[a-zA-Z]/, {
      error: "Password must contain at least one letter.",
    })
    .regex(/[0-9]/, {
      error: "Password must contain at least one number.",
    })
    .regex(/[^a-zA-Z0-9]/, {
      error: "Password must contain at least one special character.",
    })
    .trim(),
});
