import type { Metadata } from "next";
import { INDEXABLE_ROBOTS } from "@/lib/metadata";

export const metadata: Metadata = {
  title: "Horario",
  alternates: { canonical: "/timetable" },
  robots: INDEXABLE_ROBOTS,
};

export default function TimetableLayout({ children }: { children: React.ReactNode }) {
  return children;
}
