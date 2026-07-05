import { Button } from "@/components/ui/button";
import { Spinner } from "./spinner";

type ButtonProps = React.ComponentProps<typeof Button>;

/**
 * Form submit button with a built-in pending state. Every form in the app uses
 * this so loading feedback is identical everywhere (disabled + spinner).
 */
export function SubmitButton({
  pending,
  children,
  disabled,
  ...props
}: ButtonProps & { pending?: boolean }) {
  return (
    <Button type="submit" disabled={pending || disabled} {...props}>
      {pending && <Spinner />}
      {children}
    </Button>
  );
}
