import { render } from "@testing-library/react-native";
import { Alert, type AlertButton } from "react-native";
import { ScannerCodeEntry } from "@/components/scanner-code-entry.ios";

jest.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));

function prompted() {
  const prompt = jest.spyOn(Alert, "prompt").mockImplementation(() => {});
  const buttons = () => prompt.mock.calls[0]?.[2] as AlertButton[];
  return { prompt, buttons };
}

afterEach(() => jest.restoreAllMocks());

it("opens UIKit's text-field alert and submits a trimmed upper-case code (H22)", async () => {
  const { prompt, buttons } = prompted();
  const onValue = jest.fn();
  const onClose = jest.fn();
  await render(<ScannerCodeEntry visible onValue={onValue} onClose={onClose} />);
  expect(prompt).toHaveBeenCalledTimes(1);
  expect(prompt.mock.calls[0]?.[0]).toBe("scannerManualEntryTitle");
  const [, submit] = buttons();
  (submit?.onPress as ((value?: string) => void) | undefined)?.("  badge-50 ");
  expect(onValue).toHaveBeenCalledWith("BADGE-50");
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("ignores an empty code and closes on cancel", async () => {
  const { buttons } = prompted();
  const onValue = jest.fn();
  const onClose = jest.fn();
  await render(<ScannerCodeEntry visible onValue={onValue} onClose={onClose} />);
  const [cancel, submit] = buttons();
  (submit?.onPress as ((value?: string) => void) | undefined)?.("   ");
  expect(onValue).not.toHaveBeenCalled();
  cancel?.onPress?.();
  expect(onClose).toHaveBeenCalledTimes(2);
});

it("does not prompt while hidden", async () => {
  const { prompt } = prompted();
  await render(<ScannerCodeEntry visible={false} onValue={jest.fn()} onClose={jest.fn()} />);
  expect(prompt).not.toHaveBeenCalled();
});
