import { getByRole, queryByRole, waitFor } from "@testing-library/dom";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useForm } from "react-hook-form";
import { expect, it } from "vitest";
import { Form, FormControl, FormField, FormItem, FormMessage } from "../ui/form";

// H11/H12: compound pickers report completion without a DOM FocusEvent.
function Picker({ onBlur }: { onBlur?: () => void }) {
  return (
    <button type="button" onClick={() => onBlur?.()}>
      Close picker
    </button>
  );
}
function PickerForm() {
  const form = useForm({ defaultValues: { values: [] as string[] }, mode: "onBlur" });
  return (
    <Form {...form}>
      <FormField
        control={form.control}
        name="values"
        rules={{ required: "Choose a value" }}
        render={({ field }) => (
          <FormItem>
            <FormControl>
              <Picker onBlur={field.onBlur} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </Form>
  );
}
it("validates an eventless picker blur without throwing", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<PickerForm />));
    expect(queryByRole(container, "alert")).toBeNull();
    await act(async () =>
      userEvent.click(getByRole(container, "button", { name: "Close picker" })),
    );
    await waitFor(() => expect(getByRole(container, "alert").textContent).toBe("Choose a value"));
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
