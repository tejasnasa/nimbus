import SignupForm from "../components/SignupForm";
import { useSignupForm } from "../hooks/useSignupForm";

interface Props {
  openLogin?: () => void;
}

export default function SignupFormContainer({ openLogin }: Props) {
  const { register, firstError, isSubmitting, onSubmit } = useSignupForm();

  return (
    <SignupForm
      register={register}
      firstError={firstError}
      isSubmitting={isSubmitting}
      onSubmit={onSubmit}
      openLogin={openLogin}
    />
  );
}
