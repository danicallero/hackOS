import { screen } from "@testing-library/react-native";

import { MaintenanceScreen } from "@/components/maintenance-screen";
import { renderMobile } from "./render";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

jest.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));

describe("MaintenanceScreen (#539)", () => {
  it("blocks the app while a restore is running", async () => {
    await renderMobile(<MaintenanceScreen phase="restoring" />);
    expect(screen.getByText("maintenanceTitle")).toBeTruthy();
    expect(screen.getByText("maintenanceBody")).toBeTruthy();
  });

  it("asks for an administrator after a failed restore", async () => {
    await renderMobile(<MaintenanceScreen phase="failed" />);
    expect(screen.getByText("maintenanceFailedBody")).toBeTruthy();
  });
});
