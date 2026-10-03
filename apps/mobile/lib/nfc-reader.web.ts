export function startNfcRead(_message: string) {
  return {
    result: Promise.reject<string | null>(new Error("scannerNfcUnavailable")),
    cancel: () => {},
  };
}
