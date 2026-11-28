/**
 * @module web/app/login/page
 * @description Sign-in page. A flex container for the two columns `FormSwitch`
 * renders (form cards and a decorative panel).
 */
import FormSwitch from "../../components/FormSwitch";

export default function Login() {
  return (
    <main className="flex min-h-dvh flex-wrap bg-(--background) font-sans text-(--foreground)">
      <FormSwitch />
    </main>
  );
}
