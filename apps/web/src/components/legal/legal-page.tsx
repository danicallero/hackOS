import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Brand } from "@/components/common/brand";
import { ThemeToggle } from "@/components/common/theme-toggle";
import { Button } from "@/components/ui/button";

export function LegalPage({
  title,
  description,
  updatedAt,
  children,
}: {
  title: string;
  description: string;
  updatedAt: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <Link href="/" aria-label="Ir al inicio">
            <Brand />
          </Link>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/">
                <ArrowLeftIcon className="size-4" aria-hidden="true" />
                Volver al inicio
              </Link>
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-12 sm:px-8 sm:py-16">
        <header className="border-b pb-8">
          <p className="text-muted-foreground text-sm">Información legal</p>
          <h1 className="mt-2 text-balance text-3xl font-semibold sm:text-4xl">{title}</h1>
          <p className="text-muted-foreground mt-4 max-w-2xl text-pretty text-base leading-7">
            {description}
          </p>
          <p className="text-muted-foreground mt-4 text-sm">Última actualización: {updatedAt}</p>
        </header>

        <article className="space-y-10 py-10">{children}</article>
      </main>

      <footer className="text-muted-foreground border-t px-5 py-8 text-center text-sm">
        <nav aria-label="Enlaces legales" className="flex flex-wrap justify-center gap-x-5 gap-y-2">
          <Link className="underline underline-offset-4 hover:text-foreground" href="/terms">
            Términos y condiciones
          </Link>
          <Link className="underline underline-offset-4 hover:text-foreground" href="/privacy">
            Política de privacidad
          </Link>
        </nav>
      </footer>
    </div>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-balance text-xl font-semibold sm:text-2xl">{title}</h2>
      <div className="text-muted-foreground space-y-4 text-pretty leading-7 [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-4 [&_h3]:text-foreground [&_h3]:font-medium [&_li]:pl-1 [&_ol]:ml-5 [&_ol]:list-decimal [&_ol]:space-y-2 [&_strong]:text-foreground [&_ul]:ml-5 [&_ul]:list-disc [&_ul]:space-y-2">
        {children}
      </div>
    </section>
  );
}
