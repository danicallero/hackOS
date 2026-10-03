import { useEffect, useState } from "react";
import NfcManager from "react-native-nfc-manager";

// H22–H26: hide NFC actions until hardware support is confirmed.
export function useNfcSupported() {
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    let active = true;
    void NfcManager.isSupported()
      .then((value) => {
        if (active) setSupported(value);
      })
      .catch(() => {
        if (active) setSupported(false);
      });
    return () => {
      active = false;
    };
  }, []);
  return supported;
}
