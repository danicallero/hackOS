"use client";

import { ActivityIcon, CpuIcon, KeyRoundIcon, MoreHorizontalIcon, UsersIcon } from "lucide-react";
import { useState } from "react";
import { type Column, DataTable } from "@/components/common/data-table";
import { DonutChart } from "@/components/common/donut-chart";
import { EmptyState } from "@/components/common/empty-state";
import { Modal } from "@/components/common/modal";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { StatCard } from "@/components/common/stat-card";
import { StatusBadge } from "@/components/common/status-badge";
import { TrendChart } from "@/components/common/trend-chart";
import { UsageMeter } from "@/components/common/usage-meter";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Tone } from "@/lib/tones";

// ── sample data (demonstration only) ────────────────────────────────────────
interface Container {
  id: string;
  name: string;
  state: "Running" | "Exited";
  status: string;
  image: string;
}
const CONTAINERS: Container[] = [
  {
    id: "1",
    name: "hackos-api-1",
    state: "Running",
    status: "Up 2 minutes",
    image: "hackos-api:latest",
  },
  {
    id: "2",
    name: "hackos-web-1",
    state: "Running",
    status: "Up 8 minutes",
    image: "hackos-web:0.1.0",
  },
  {
    id: "3",
    name: "hackos-migrate-1",
    state: "Exited",
    status: "Exited (0)",
    image: "hackos-api:latest",
  },
  {
    id: "4",
    name: "hackos-valkey-1",
    state: "Running",
    status: "Up 9 hours",
    image: "valkey:8-alpine",
  },
  {
    id: "5",
    name: "hackos-postgres-1",
    state: "Running",
    status: "Up 9 hours",
    image: "postgres:17-alpine",
  },
];

const TREND = Array.from({ length: 12 }, (_, i) => ({
  t: `${i * 2}:00`,
  cpu: Math.round(20 + 30 * Math.abs(Math.sin(i / 2))),
  mem: Math.round(40 + 15 * Math.abs(Math.cos(i / 3))),
}));

const DONUT = [
  { key: "M", label: "M", value: 42 },
  { key: "L", label: "L", value: 30 },
  { key: "S", label: "S", value: 18 },
  { key: "XL", label: "XL", value: 10 },
];

const TONES: Tone[] = ["neutral", "brand", "success", "warning", "danger", "info"];

export default function ComponentsShowcasePage() {
  const [modalOpen, setModalOpen] = useState(false);

  const columns: Column<Container>[] = [
    {
      id: "name",
      header: "Name",
      cell: (r) => <span className="font-medium">{r.name}</span>,
      sortValue: (r) => r.name,
    },
    {
      id: "state",
      header: "State",
      cell: (r) => (
        <StatusBadge tone={r.state === "Running" ? "success" : "neutral"}>{r.state}</StatusBadge>
      ),
      sortValue: (r) => r.state,
    },
    { id: "status", header: "Status", cell: (r) => r.status },
    {
      id: "image",
      header: "Image",
      cell: (r) => <span className="text-muted-foreground">{r.image}</span>,
    },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Component library"
        description="The shared, prop-configurable building blocks used across hackOS."
      />

      {/* Stat cards */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Participants"
          value="248"
          icon={UsersIcon}
          delta={{ value: "+12", direction: "up" }}
          hint="vs. last hour"
        />
        <StatCard
          label="CPU"
          value="34%"
          icon={CpuIcon}
          footer={<UsageMeter value={34} tone="info" />}
        />
        <StatCard
          label="Memory"
          value="2.9 / 7.9 GiB"
          icon={ActivityIcon}
          footer={<UsageMeter value={2.9} max={7.9} tone="danger" />}
        />
      </section>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Usage" description="Area trend, multiple series (tone-colored).">
          <TrendChart
            data={TREND}
            index="t"
            series={[
              { key: "cpu", label: "CPU %", tone: "info" },
              { key: "mem", label: "Mem %", tone: "danger" },
            ]}
            showLegend
          />
        </SectionCard>
        <SectionCard title="Shirt sizes" description="Donut with centered total.">
          <DonutChart data={DONUT} centerLabel="orders" centerValue="100" />
        </SectionCard>
      </div>

      {/* Table */}
      <SectionCard
        title="Containers"
        description="DataTable: search, sortable columns, row actions."
        bodyClassName="p-0"
      >
        <DataTable
          columns={columns}
          data={CONTAINERS}
          getRowId={(r) => r.id}
          searchable={(r) => `${r.name} ${r.image} ${r.state}`}
          searchPlaceholder="Filter by name…"
          pageSize={4}
          rowActions={() => (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8">
                  <MoreHorizontalIcon className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem>View logs</DropdownMenuItem>
                <DropdownMenuItem>Restart</DropdownMenuItem>
                <DropdownMenuItem variant="destructive">Remove</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        />
      </SectionCard>

      {/* Badges + empty + modal */}
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Status badges" description="Every tone, one component.">
          <div className="flex flex-wrap gap-2">
            {TONES.map((t) => (
              <StatusBadge key={t} tone={t}>
                {t}
              </StatusBadge>
            ))}
          </div>
        </SectionCard>
        <SectionCard
          title="Modal + empty state"
          description="Reusable dialog and zero-states."
          action={
            <Button size="sm" onClick={() => setModalOpen(true)}>
              Open modal
            </Button>
          }
        >
          <EmptyState
            icon={KeyRoundIcon}
            title="No API keys found"
            description="Keys you generate will appear here."
          />
        </SectionCard>
      </div>

      <Modal
        open={modalOpen}
        onOpenChange={setModalOpen}
        title="Confirm action"
        description="This is the shared Modal component — title, body and footer are props."
        icon={ActivityIcon}
        footer={
          <>
            <Button variant="outline" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => setModalOpen(false)}>Confirm</Button>
          </>
        }
      >
        <p className="text-muted-foreground text-sm">Body content goes here.</p>
      </Modal>
    </div>
  );
}
