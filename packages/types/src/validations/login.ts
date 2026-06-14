import { z } from "zod";

export const loginSchema = z.object({
  email: z.email({ message: "Enter a valid email." }).trim(),
  password: z
    .string()
    .min(8, { message: "Password must be at least 8 characters long" }),
});

export const resetSchema = z
  .object({
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const forgotSchema = z.object({
  email: z.email("Enter a valid email address"),
});
