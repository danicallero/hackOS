import type { Metadata } from "next";
import { INDEXABLE_ROBOTS } from "@/lib/metadata";

export const metadata: Metadata = {
  title: "Horario",
  alternates: { canonical: "/horario" },
  robots: INDEXABLE_ROBOTS,
};

export default function ScheduleLayout({ children }: { children: React.ReactNode }) {
  return children;
}
