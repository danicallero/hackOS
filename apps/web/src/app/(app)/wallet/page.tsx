import { redirect } from "next/navigation";

/**
 * Kept for shared links and the reminder email's Wallet buttons (H28, H52):
 * the Wallet is now a section of the profile. `?add=` survives the hop.
 */
export default async function WalletPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { add } = await searchParams;
  const params = new URLSearchParams({ tab: "wallet" });
  if (add === "apple" || add === "google") params.set("add", add);
  redirect(`/settings/profile?${params}`);
}
