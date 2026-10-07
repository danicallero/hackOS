import { Button } from "@/components/ui/button";

type ButtonProps = React.ComponentProps<typeof Button>;

/**
 * Form submit button with a built-in pending state. Every form in the app uses
 * this so loading feedback is identical everywhere (disabled + spinner).
 */
export function SubmitButton({
  pending,
  children,
  ...props
}: ButtonProps & {
  /** Shows the spinner and disables the button (in addition to `disabled`). */
  pending?: boolean;
}) {
  return (
    <Button type="submit" {...props} loading={pending}>
      {children}
    </Button>
  );
}
