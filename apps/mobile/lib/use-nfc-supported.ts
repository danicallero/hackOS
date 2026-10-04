import { useEffect, useState } from "react";
import NfcManager from "react-native-nfc-manager";

// H22–H26: hide NFC actions until hardware support is confirmed.
export type NfcSupportStatus = "checking" | "supported" | "unsupported";

export function useNfcSupportStatus(): NfcSupportStatus {
  const [status, setStatus] = useState<NfcSupportStatus>("checking");
  useEffect(() => {
    let active = true;
    void NfcManager.isSupported()
      .then((value) => {
        if (active) setStatus(value ? "supported" : "unsupported");
      })
      .catch(() => {
        if (active) setStatus("unsupported");
      });
    return () => {
      active = false;
    };
  }, []);
  return status;
}

export function useNfcSupported() {
  return useNfcSupportStatus() === "supported";
}
