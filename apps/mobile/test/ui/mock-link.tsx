import { cloneElement, type ReactElement, type ReactNode } from "react";

/**
 * Test double for expo-router's `Link asChild` and its zoom helpers: pressing the child pushes the
 * href through the given push mock, like the real Link does on a native stack.
 */
export function makeLink(push: (href: unknown) => void) {
  function Link({ href, children }: { href: unknown; asChild?: boolean; children: ReactElement }) {
    return cloneElement(children as ReactElement<{ onPress?: () => void }>, {
      onPress: () => push(href),
    });
  }
  Link.AppleZoom = ({ children }: { children: ReactNode }) => children;
  Link.AppleZoomTarget = ({ children }: { children: ReactNode }) => children;
  return Link;
}
