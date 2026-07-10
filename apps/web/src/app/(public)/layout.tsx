export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <main className="min-h-dvh bg-background text-foreground">{children}</main>;
}
