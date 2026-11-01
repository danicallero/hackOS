import { getByRole, queryByRole, waitFor } from "@testing-library/dom";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EntityCombobox } from "./entity-combobox";
import { FileUploadField } from "./file-upload-field";
import { MultiSelect } from "./multi-select";

vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/env", () => ({ API_URL: "https://api.test" }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  HTMLElement.prototype.scrollIntoView ??= () => {};
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const options = [
  { value: "alpha", label: "Alpha" },
  { value: "beta", label: "Beta" },
];
for (const kind of ["entity", "multi"]) {
  it(`${kind} picker opens from ArrowDown, describes the actual popup and restores focus on Escape`, async () => {
    const onChange = vi.fn();
    await act(async () =>
      root.render(
        <>
          <label htmlFor="picker" id="picker-label">
            Category
          </label>
          {kind === "entity" ? (
            <EntityCombobox
              id="picker"
              aria-labelledby="picker-label"
              options={options}
              getId={(item) => item.value}
              getLabel={(item) => item.label}
              value=""
              onChange={onChange}
            />
          ) : (
            <MultiSelect
              id="picker"
              aria-labelledby="picker-label"
              options={options}
              value={[]}
              onChange={onChange}
            />
          )}
        </>,
      ),
    );
    const user = userEvent.setup();
    const trigger = getByRole(host, "combobox", { name: "Category" });
    await act(async () => user.tab());
    await act(async () => user.keyboard("{ArrowDown}"));
    const dialog = getByRole(document.body, "dialog");
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    expect(trigger.getAttribute("aria-controls")).toBe(dialog.id);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(
      getByRole(dialog, "combobox", { name: "genericSearchPlaceholder" }),
    );
    await act(async () => user.keyboard("{ArrowDown}{Enter}"));
    expect(onChange).toHaveBeenCalledWith(kind === "entity" ? "beta" : ["beta"]);
    if (kind === "multi") await act(async () => user.keyboard("{Escape}"));
    await waitFor(() => expect(queryByRole(document.body, "dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });
}

it("file upload presents one visible keyboard target, with error/name metadata", async () => {
  await act(async () =>
    root.render(
      <>
        <label htmlFor="cv" id="cv-label">
          CV
        </label>
        <FileUploadField
          id="cv"
          aria-labelledby="cv-label"
          aria-describedby="cv-help"
          uploadPath="/upload"
          fieldKey="cv"
          value=""
          onChange={() => {}}
        />
        <p id="cv-help">PDF file</p>
        <button type="button">Next</button>
      </>,
    ),
  );
  const user = userEvent.setup();
  await act(async () => user.tab());
  expect(document.activeElement).toBe(
    getByRole(host, "button", { name: "CV", description: "PDF file" }),
  );
  await act(async () => user.tab());
  expect(document.activeElement).toBe(getByRole(host, "button", { name: "Next" }));
});

it("upload validation marks the control invalid even when the parent has no error", async () => {
  await act(async () =>
    root.render(
      <FileUploadField
        id="cv"
        aria-label="CV"
        aria-invalid={false}
        allowedTypes={[".pdf"]}
        uploadPath="/upload"
        fieldKey="cv"
        value=""
        onChange={() => {}}
      />,
    ),
  );
  const input = host.querySelector('input[type="file"]') as HTMLInputElement;
  await act(async () =>
    userEvent
      .setup({ applyAccept: false })
      .upload(input, new File(["content"], "image.png", { type: "image/png" })),
  );
  const button = getByRole(host, "button", { name: "CV" });
  expect(button.getAttribute("aria-invalid")).toBe("true");
  expect(button.getAttribute("aria-describedby")).toBe(getByRole(host, "alert").id);
});
