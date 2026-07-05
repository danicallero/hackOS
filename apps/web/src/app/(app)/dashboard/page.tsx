"use client";

import { KeyRoundIcon, ShieldIcon, UserCheckIcon } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useMe } from "@/lib/session";

export default function DashboardPage() {
  const me = useMe();
  if (!me) return null;

  const stats = [
    {
      label: "Account role",
      value: me.role,
      hint: "Illustrative only — access is by capability",
      icon: ShieldIcon,
    },
    {
      label: "Email",
      value: me.emailVerified ? "Verified" : "Unverified",
      hint: me.email,
      icon: UserCheckIcon,
    },
    {
      label: "Capabilities",
      value: String(me.capabilities.length),
      hint: "Granted permission groups",
      icon: KeyRoundIcon,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome${me.name ? `, ${me.name}` : ""}`}
        description="Your hackOS control center."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-muted-foreground text-sm font-medium">{s.label}</CardTitle>
              <s.icon className="text-muted-foreground size-4" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold capitalize">{s.value}</div>
              <p className="text-muted-foreground mt-1 truncate text-xs">{s.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {me.capabilities.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your capabilities</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {me.capabilities.map((c) => (
              <Badge key={c} variant="secondary" className="font-mono">
                {c}
              </Badge>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
