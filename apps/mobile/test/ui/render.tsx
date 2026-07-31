import { render } from "@testing-library/react-native";
import type { ReactElement } from "react";

/** Keep native UI tests on one render entry point as providers are added. */
export async function renderMobile(ui: ReactElement) {
  return render(ui);
}
