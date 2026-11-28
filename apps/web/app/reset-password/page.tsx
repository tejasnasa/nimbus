/**
 * @module web/app/reset-password/page
 * @description Landing page for the emailed reset link. Redirects to `/login`
 * when the `token` query parameter is missing; otherwise renders the
 * new-password form inside the shared status-page shell.
 */
import { redirect } from "next/navigation";
import { StatusShell } from "../../components/AuthParts";
import ResetPasswordForm from "../../components/ResetPasswordForm";

export default async function ResetPassword({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    redirect("/login");
  }

  return (
    <StatusShell>
      <ResetPasswordForm token={token} />
    </StatusShell>
  );
}
