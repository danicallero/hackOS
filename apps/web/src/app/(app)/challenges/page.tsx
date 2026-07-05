"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { Question } from "@hackos/shared/questions";
import { zodResolver } from "@hookform/resolvers/zod";
import { LockIcon, PlusIcon, TrophyIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { type Column, DataTable } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { Modal } from "@/components/common/modal";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { SubmitButton } from "@/components/common/submit-button";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api } from "@/lib/api";
import { useSessionContext } from "@/lib/session";
import type { EnterpriseSummary } from "@/lib/types";
import { JudgingPanelBuilder, normalizePrizes, normalizeQuestions, PrizeBuilder } from "./builders";
import { type Challenge, challengeTone, type Prize, visibilityTone } from "./shared";

const optionalPositiveInt = z
  .string()
  .refine((v) => v === "" || (/^\d+$/.test(v) && Number(v) > 0), "Must be a positive number");

const createSchema = z.object({
  enterpriseId: z.string().min(1, "Required"),
  title: z.string().min(1, "Required"),
  description: z.string().max(6000),
  criteria: z.string().max(6000),
  maxPresentationSeconds: optionalPositiveInt,
});
type CreateValues = z.infer<typeof createSchema>;

const columns: Column<Challenge>[] = [
  {
    id: "title",
    header: "Challenge",
    sortValue: (c) => c.title.toLowerCase(),
    cell: (c) => <span className="font-medium">{c.title}</span>,
  },
  {
    id: "status",
    header: "Status",
    sortValue: (c) => c.status,
    cell: (c) => (
      <StatusBadge tone={challengeTone(c.status)} className="capitalize">
        {c.status}
      </StatusBadge>
    ),
  },
  {
    id: "visibility",
    header: "Visibility",
    sortValue: (c) => c.visibility,
    cell: (c) => (
      <StatusBadge tone={visibilityTone(c.visibility)} className="capitalize">
        {c.visibility}
      </StatusBadge>
    ),
  },
  {
    id: "reveal",
    header: "Reveal",
    sortValue: (c) => c.available_from ?? "",
    cell: (c) => (
      <span className="text-muted-foreground text-sm">
        {c.available_from ? new Date(c.available_from).toLocaleString() : "Immediate"}
      </span>
    ),
  },
];

export default function ChallengesPage() {
  const router = useRouter();
  const { canAny, me } = useSessionContext();
  const canAdmin = canAny(CAPABILITIES.SPONSORS_MANAGE, CAPABILITIES.QUEUE_ADMIN);
  const canSee = canAdmin || me?.role === "sponsor";
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    if (!canSee) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const path = canAdmin ? "/api/challenges" : "/api/challenges/mine";
      const res = await api.get<{ challenges: Challenge[] }>(path);
      setChallenges(res.challenges);
    } catch (err) {
      setChallenges([]);
      toast.error(err instanceof ApiError ? err.message : "Could not load challenges.");
    } finally {
      setLoading(false);
    }
  }, [canAdmin, canSee]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!canSee) {
    return (
      <div className="space-y-6">
        <PageHeader title="Challenges" />
        <EmptyState
          icon={LockIcon}
          title="You can't access challenges"
          description="Challenge access is available to admins and linked sponsor representatives."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={canAdmin ? "Challenges" : "My challenges"}
        description="Challenge content, prizes, judging panel configuration and public reveal."
        actions={
          canAdmin ? (
            <Button onClick={() => setCreateOpen(true)}>
              <PlusIcon className="size-4" />
              New challenge
            </Button>
          ) : undefined
        }
      />

      <DataTable
        columns={columns}
        data={challenges}
        getRowId={(c) => String(c.id)}
        onRowClick={(c) => router.push(`/challenges/${c.id}`)}
        searchable={(c) => `${c.title} ${c.description} ${c.criteria ?? ""}`}
        searchPlaceholder="Search challenges..."
        pageSize={15}
        loading={loading}
        empty={{
          icon: TrophyIcon,
          title: "No challenges yet",
          description: canAdmin
            ? "Create the first enterprise challenge template."
            : "Your enterprise has no challenge assigned yet.",
        }}
      />

      {canAdmin && (
        <CreateChallengeModal
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={async (created) => {
            setCreateOpen(false);
            await load();
            router.push(`/challenges/${created.id}`);
          }}
        />
      )}
    </div>
  );
}

function CreateChallengeModal({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (created: Challenge) => void | Promise<void>;
}) {
  const [enterprises, setEnterprises] = useState<EnterpriseSummary[]>([]);
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const form = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      enterpriseId: "",
      title: "",
      description: "",
      criteria: "",
      maxPresentationSeconds: "",
    },
  });
  const { reset } = form;

  useEffect(() => {
    if (!open) return;
    reset();
    setPrizes([]);
    setQuestions([]);
    api
      .get<{ enterprises: EnterpriseSummary[] }>("/api/enterprises")
      .then((res) => setEnterprises(res.enterprises))
      .catch((err) =>
        toast.error(err instanceof ApiError ? err.message : "Could not load enterprises."),
      );
  }, [open, reset]);

  async function onSubmit(values: CreateValues) {
    try {
      const normalizedQuestions = normalizeQuestions(questions);
      const created = await api.post<Challenge>("/api/challenges", {
        enterpriseId: Number(values.enterpriseId),
        title: values.title,
        description: values.description || undefined,
        criteria: values.criteria || null,
        prizes: normalizePrizes(prizes),
        judgingPanelCriteria: normalizedQuestions,
        maxPresentationSeconds: values.maxPresentationSeconds
          ? Number(values.maxPresentationSeconds)
          : null,
      });
      toast.success("Challenge created.");
      await onCreated(created);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Check the builder fields and try again.");
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      icon={TrophyIcon}
      title="New challenge"
      description="Create a hidden draft template associated with an enterprise."
      size="lg"
      footer={
        <SubmitButton form="create-challenge-form" pending={form.formState.isSubmitting}>
          Create challenge
        </SubmitButton>
      }
    >
      <Form {...form}>
        <form
          id="create-challenge-form"
          onSubmit={form.handleSubmit(onSubmit)}
          className="space-y-5"
        >
          <FormField
            control={form.control}
            name="enterpriseId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Enterprise ID</FormLabel>
                <FormControl>
                  <Input list="challenge-enterprises" inputMode="numeric" {...field} />
                </FormControl>
                <datalist id="challenge-enterprises">
                  {enterprises.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </datalist>
                <FormDescription>Choose the enterprise that owns this challenge.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="title"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Title</FormLabel>
                <FormControl>
                  <Input placeholder="Best AI Hack" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Description</FormLabel>
                <FormControl>
                  <Textarea rows={3} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="criteria"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Public criteria</FormLabel>
                <FormControl>
                  <Textarea rows={3} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="space-y-3 rounded-lg border p-4">
            <div>
              <h3 className="font-medium">Prizes</h3>
              <p className="text-muted-foreground text-sm text-pretty">
                Stored as JSON with a label and optional link for each prize.
              </p>
            </div>
            <PrizeBuilder value={prizes} onChange={setPrizes} />
          </div>
          <div className="space-y-3 rounded-lg border p-4">
            <div>
              <h3 className="font-medium">Judging panel</h3>
              <p className="text-muted-foreground text-sm text-pretty">
                Define the fields judges will fill in for this challenge.
              </p>
            </div>
            <JudgingPanelBuilder value={questions} onChange={setQuestions} />
          </div>
          <FormField
            control={form.control}
            name="maxPresentationSeconds"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Max presentation seconds</FormLabel>
                <FormControl>
                  <Input inputMode="numeric" placeholder="Optional" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </form>
      </Form>
    </Modal>
  );
}
