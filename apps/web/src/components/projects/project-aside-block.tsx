/** One fact block of a project's aside (team, challenges, GitHub): a small heading, then the list. */
export function ProjectAsideBlock({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 space-y-2">
      <h2 className="type-meta font-medium text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}
