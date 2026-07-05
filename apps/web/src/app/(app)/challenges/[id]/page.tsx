"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeftIcon, EyeIcon, EyeOffIcon, TrophyIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { type UseFormReturn, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { EmptyState } from "@/components/common/empty-state";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
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
import {
  type Challenge,
  challengeTone,
  fromDatetimeLocal,
  parseJsonField,
  toDatetimeLocal,
  toJsonText,
  visibilityTone,
} from "../shared";

const optionalPositiveInt = z
  .string()
  .refine((v) => v === "" || (/^\d+$/.test(v) && Number(v) > 0), "Must be a positive number");

const editSchema = z.object({
  title: z.string().min(1, "Required"),
  description: z.string().max(6000),
  criteria: z.string().max(6000),
  prizes: z.string().min(1),
  judgingPanelCriteria: z.string().min(1),
  maxPresentationSeconds: optionalPositiveInt,
});
type EditValues = z.infer<typeof editSchema>;

const publishSchema = z.object({
  availableFrom: z.string(),
});
type PublishValues = z.infer<typeof publishSchema>;

function toFormValues(challenge: Challenge): EditValues {
  return {
    title: challenge.title,
    description: challenge.description ?? "",
    criteria: challenge.criteria ?? "",
    prizes: toJsonText(challenge.prizes, []),
    judgingPanelCriteria: toJsonText(challenge.judging_panel_criteria, []),
    maxPresentationSeconds:
      challenge.max_presentation_seconds != null ? String(challenge.max_presentation_seconds) : "",
  };
}

export default function ChallengeDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const { canAny } = useSessionContext();
  const canAdmin = canAny(CAPABILITIES.SPONSORS_MANAGE, CAPABILITIES.QUEUE_ADMIN);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const data = await api.get<Challenge>(`/api/challenges/${id}`);
      setChallenge(data);
      setStatus("ready");
    } catch (err) {
      setErrorMsg(err instanceof ApiError ? err.message : "Could not load this challenge.");
      setStatus("error");
    }
  }, [id]);

  useEffect(() => {
    if (Number.isFinite(id)) void load();
    else setStatus("error");
  }, [id, load]);

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner className="size-6" />
      </div>
    );
  }

  if (status === "error" || !challenge) {
    return (
      <div className="space-y-6">
        <BackLink />
        <EmptyState
          icon={TrophyIcon}
          title="Challenge not found"
          description={errorMsg || "This challenge could not be loaded."}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <BackLink />
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{challenge.title}</h1>
        <StatusBadge tone={challengeTone(challenge.status)} className="capitalize">
          {challenge.status}
        </StatusBadge>
        <StatusBadge tone={visibilityTone(challenge.visibility)} className="capitalize">
          {challenge.visibility}
        </StatusBadge>
      </div>

      {canAdmin && <PublishCard challenge={challenge} onChanged={load} />}
      <EditCard challenge={challenge} onSaved={load} />
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/challenges"
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
    >
      <ArrowLeftIcon className="size-4" />
      Back to challenges
    </Link>
  );
}

function PublishCard({
  challenge,
  onChanged,
}: {
  challenge: Challenge;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const form = useForm<PublishValues>({
    resolver: zodResolver(publishSchema),
    defaultValues: { availableFrom: toDatetimeLocal(challenge.available_from) },
  });
  const { reset } = form;

  useEffect(() => {
    reset({ availableFrom: toDatetimeLocal(challenge.available_from) });
  }, [challenge, reset]);

  async function publish(values: PublishValues) {
    setBusy(true);
    try {
      await api.post<Challenge>(`/api/challenges/${challenge.id}/publish`, {
        availableFrom: fromDatetimeLocal(values.availableFrom),
      });
      await onChanged();
      toast.success("Challenge published.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not publish challenge.");
    } finally {
      setBusy(false);
    }
  }

  async function unpublish() {
    setBusy(true);
    try {
      await api.post<Challenge>(`/api/challenges/${challenge.id}/unpublish`);
      await onChanged();
      toast.success("Challenge hidden.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not hide challenge.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(publish)}>
        <SectionCard
          icon={challenge.status === "published" ? EyeIcon : EyeOffIcon}
          title="Public reveal"
          description="Publish this challenge to the public challenges route immediately or at a scheduled time."
          footer={
            <>
              {challenge.status === "published" && (
                <Button type="button" variant="outline" disabled={busy} onClick={unpublish}>
                  <EyeOffIcon className="size-4" />
                  Hide
                </Button>
              )}
              <SubmitButton pending={busy}>
                <EyeIcon className="size-4" />
                Publish
              </SubmitButton>
            </>
          }
        >
          <FormField
            control={form.control}
            name="availableFrom"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Reveal from</FormLabel>
                <FormControl>
                  <Input type="datetime-local" {...field} />
                </FormControl>
                <FormDescription>Leave blank to reveal immediately.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </SectionCard>
      </form>
    </Form>
  );
}

function EditCard({ challenge, onSaved }: { challenge: Challenge; onSaved: () => Promise<void> }) {
  const form = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: toFormValues(challenge),
  });
  const { reset } = form;

  useEffect(() => {
    reset(toFormValues(challenge));
  }, [challenge, reset]);

  async function onSubmit(values: EditValues) {
    try {
      await api.patch<Challenge>(`/api/challenges/${challenge.id}`, {
        title: values.title,
        description: values.description,
        criteria: values.criteria || null,
        prizes: parseJsonField(values.prizes, []),
        judgingPanelCriteria: parseJsonField(values.judgingPanelCriteria, []),
        maxPresentationSeconds: values.maxPresentationSeconds
          ? Number(values.maxPresentationSeconds)
          : null,
      });
      await onSaved();
      toast.success("Challenge updated.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save challenge.");
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <SectionCard
          icon={TrophyIcon}
          title="Challenge"
          description="Edit public content, prizes and the judging panel configuration."
          footer={<SubmitButton pending={form.formState.isSubmitting}>Save changes</SubmitButton>}
        >
          <FormField
            control={form.control}
            name="title"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Title</FormLabel>
                <FormControl>
                  <Input {...field} />
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
                  <Textarea rows={4} {...field} />
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
                  <Textarea rows={4} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="grid gap-5 lg:grid-cols-2">
            <JsonField form={form} name="prizes" label="Prizes JSON" />
            <JsonField form={form} name="judgingPanelCriteria" label="Judging panel JSON" />
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
        </SectionCard>
      </form>
    </Form>
  );
}

function JsonField({
  name,
  label,
  form,
}: {
  name: "prizes" | "judgingPanelCriteria";
  label: string;
  form: UseFormReturn<EditValues>;
}) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Textarea rows={10} className="font-mono text-sm" {...field} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
