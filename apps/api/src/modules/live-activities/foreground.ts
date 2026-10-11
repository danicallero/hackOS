import { valkey } from "../../lib/valkey.js";

/**
 * iOS devices whose app is mirroring the read model right now (#966). The
 * foreground app starts every desired Live Activity locally and registers
 * it (`PUT …/sessions`); a push-to-start sent in that same moment would put
 * a second activity of the same subject on the device, and the server can
 * address only one of them — the other stays until iOS removes it hours
 * later. So for a short window after the app reads its state, the worker
 * leaves starts to the app. Valkey is only an optimisation here: when it is
 * unavailable the worker starts remotely as before.
 */
const FOREGROUND_WINDOW_SECONDS = 30;

const key = (deviceRowId: number) => `live-activities:foreground:${deviceRowId}`;

export async function markDeviceForeground(deviceRowId: number): Promise<void> {
  try {
    await valkey.set(key(deviceRowId), "1", "EX", FOREGROUND_WINDOW_SECONDS);
  } catch (err) {
    console.warn("live-activities: foreground mark unavailable", err);
  }
}

/** The subset of `deviceRowIds` read by their app within the window. */
export async function foregroundDevices(deviceRowIds: number[]): Promise<Set<number>> {
  if (deviceRowIds.length === 0) return new Set();
  try {
    const values = await valkey.mget(deviceRowIds.map(key));
    return new Set(deviceRowIds.filter((_, index) => values[index] !== null));
  } catch (err) {
    console.warn("live-activities: foreground marks unavailable", err);
    return new Set();
  }
}
