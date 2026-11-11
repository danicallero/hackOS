import { configure } from "@testing-library/dom";
import { act } from "react";
import { beforeEach } from "vitest";

// H13/H55: DOM-based component tests need the same event boundary as React renderers.
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

configure({
  eventWrapper: (callback) => {
    let result: unknown;
    act(() => {
      result = callback();
    });
    return result;
  },
});
