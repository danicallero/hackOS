import { vi } from "vitest";
/** External Google calls only; database and cryptographic signing stay real (H28). */
export const googleProviderFetch = vi.fn(async (url: string, _init?: RequestInit) => {
  if (url === "https://oauth2.googleapis.com/token")
    return new Response(JSON.stringify({ access_token: "test-token", expires_in: 3600 }), {
      status: 200,
    });
  return new Response("{}", { status: 200 });
});
export function stubGoogleProvider(): void {
  googleProviderFetch.mockClear();
  vi.stubGlobal("fetch", googleProviderFetch);
}
export function lastGoogleObject(): {
  id: string;
  classId: string;
  barcode: { value: string };
  validTimeInterval: unknown;
} {
  const calls = googleProviderFetch.mock.calls.filter(
    ([url, init]) => url.includes("/eventTicketObject/") && init?.method === "PATCH",
  );
  return JSON.parse(calls[calls.length - 1]![1]!.body as string);
}
