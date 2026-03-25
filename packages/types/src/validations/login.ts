import { z } from "zod";

export const loginSchema = z.object({
  email: z.email({ message: "Enter a valid email." }).trim(),
  password: z
    .string()
    .min(8, { message: "Password must be at least 8 characters long" }),
});
