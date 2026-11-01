import { getByRole } from "@testing-library/dom";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QuestionField } from "./question-field";

vi.mock("@/lib/i18n", () => ({
  useLocale: () => ({ t: (key: string) => key }),
  getLanguage: () => "en",
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it("gives a score group the question context while preserving native button activation", async () => {
  const onChange = vi.fn();
  act(() =>
    root.render(
      <QuestionField
        question={{
          key: "quality",
          kind: "scale",
          label: { en: "Quality", es: "Quality", gl: "Quality" },
          description: { en: "Score the demo", es: "Score the demo", gl: "Score the demo" },
          min: 0,
          max: 3,
          required: true,
        }}
        value={2}
        disabled={false}
        onChange={onChange}
      />,
    ),
  );
  const groups = host.querySelectorAll('fieldset, [role="group"]');
  const scoreGroup = groups[1] as HTMLElement;
  expect(getByRole(scoreGroup, "button", { name: "2" }).getAttribute("aria-pressed")).toBe("true");
  expect(
    document.getElementById(scoreGroup.getAttribute("aria-labelledby") ?? "")?.textContent,
  ).toContain("Quality");
  expect(
    document.getElementById(scoreGroup.getAttribute("aria-describedby") ?? "")?.textContent,
  ).toBe("Score the demo");
  const user = userEvent.setup();
  getByRole(scoreGroup, "button", { name: "3" }).focus();
  await act(async () => user.keyboard(" "));
  expect(onChange).toHaveBeenCalledWith(3);
});

it("associates required text controls with their description and lease status without duplicate ids", () => {
  const question = {
    key: "notes",
    kind: "long_text" as const,
    maxLength: 1000,
    label: { en: "Notes", es: "Notes", gl: "Notes" },
    description: { en: "Explain the result", es: "Explain the result", gl: "Explain the result" },
    required: true,
  };
  act(() =>
    root.render(
      <>
        <QuestionField
          question={question}
          value="Draft"
          disabled={false}
          readOnly
          lockedMessage="Another judge is editing"
          onChange={() => {}}
        />
        <QuestionField question={question} value="Other" disabled={false} onChange={() => {}} />
      </>,
    ),
  );
  const fields = [...host.querySelectorAll("textarea")];
  expect(new Set(fields.map((field) => field.id)).size).toBe(2);
  const field = fields[0];
  expect(
    getByRole(host, "textbox", {
      name: "Notes",
      description: "Explain the result Another judge is editing",
    }),
  ).toBe(field);
  expect(field.getAttribute("aria-required")).toBe("true");
  expect(field.readOnly).toBe(true);
});

it("names checkbox collections by their question and each option by its own label", () => {
  act(() =>
    root.render(
      <QuestionField
        question={{
          key: "tags",
          kind: "multi_choice",
          required: false,
          label: { en: "Strengths", es: "Strengths", gl: "Strengths" },
          description: {
            en: "Choose all that apply",
            es: "Choose all that apply",
            gl: "Choose all that apply",
          },
          options: [{ value: "ux", label: { en: "Usability", es: "Usability", gl: "Usability" } }],
        }}
        value={[]}
        disabled
        onChange={() => {}}
      />,
    ),
  );
  getByRole(host, "group", { name: "Strengths" });
  const checkbox = getByRole(host, "checkbox", {
    name: "Usability",
    description: "Choose all that apply",
  });
  expect((checkbox as HTMLButtonElement).disabled).toBe(true);
});
