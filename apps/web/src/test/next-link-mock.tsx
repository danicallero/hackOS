import type { ReactNode } from "react";

// Plain-anchor stand-in for next/link: `vi.mock("next/link", () => import("@/test/next-link-mock"))`.
export default function Link({ href, children, ...rest }: { href: string; children: ReactNode }) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}
