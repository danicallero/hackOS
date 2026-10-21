import type { ReactNode } from "react";
import { View } from "react-native";
import { PeopleFinderPane } from "@/components/people-finder-pane";
import type { PaneBarButton, PaneBarMenu } from "@/lib/pane-header-items";
import type { ScannerPerson } from "@/lib/scanner-types";

export interface PanePeopleStackProps {
  /** Two-pane layout is active; otherwise only `children` render. */
  enabled: boolean;
  open: boolean;
  onClose: () => void;
  onSelect: (person: ScannerPerson) => void;
  backLabel: string;
  requireBadge?: boolean;
  /** The pane's own title and trailing header items (the native stack draws them in its bar). */
  rootTitle?: string;
  rootHeaderRight?: Array<PaneBarButton | PaneBarMenu>;
  children: ReactNode;
}

/** False here: the pane draws its own header. The iOS file mounts a real native stack instead. */
export const NATIVE_PANE_STACK = false;

/**
 * H22-H26, H55: a scanner pane with the people finder over it. Android and web draw the finder as
 * an RN panel sliding over the pane (`PeopleFinderPane`); iOS uses a native navigation stack
 * (`pane-people-stack.ios.tsx`). The pane underneath stays mounted either way.
 */
export function PanePeopleStack({
  backLabel,
  children,
  enabled,
  onClose,
  onSelect,
  open,
  requireBadge,
}: PanePeopleStackProps) {
  return (
    <View style={{ flex: 1 }}>
      {children}
      {enabled ? (
        <PeopleFinderPane
          backLabel={backLabel}
          onClose={onClose}
          onSelect={onSelect}
          open={open}
          requireBadge={requireBadge}
        />
      ) : null}
    </View>
  );
}
