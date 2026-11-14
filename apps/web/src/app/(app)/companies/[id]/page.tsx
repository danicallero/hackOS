"use client";

import { useParams } from "next/navigation";
import { CompanyProfile } from "@/components/sponsors/company-profile";

export default function CompanyPage() {
  const params = useParams<{ id: string }>();
  return <CompanyProfile id={Number(params.id)} />;
}
