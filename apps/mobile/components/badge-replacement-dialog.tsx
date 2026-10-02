// H22–H26: iOS uses its native Alert; Android supplies a Material dialog.
export function BadgeReplacementDialog(_props: {
  visible: boolean;
  onSelect: (method: "qr" | "nfc") => void;
  onClose: () => void;
}) {
  return null;
}
