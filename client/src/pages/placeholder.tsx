import { Construction } from "lucide-react";

export default function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-[60vh] gap-4 text-muted-foreground" data-testid="placeholder-page">
      <Construction className="h-12 w-12" />
      <h1 className="text-xl font-semibold text-foreground" data-testid="text-page-title">{title}</h1>
      <p className="text-sm">This page is coming soon.</p>
    </div>
  );
}
