import { Skeleton } from "@/components/ui/skeleton";

interface RuleSummaryProps {
  sentences: string[];
  userDescription?: string | null;
  isLoading?: boolean;
  testIdPrefix: string;
  emptyText?: string;
}

export function RuleSummary({
  sentences,
  userDescription,
  isLoading,
  testIdPrefix,
  emptyText = "No configuration to summarize.",
}: RuleSummaryProps) {
  return (
    <div className="space-y-2 max-w-md" data-testid={`${testIdPrefix}-container`}>
      {userDescription && userDescription.trim().length > 0 && (
        <div data-testid={`${testIdPrefix}-user-description`}>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            Description
          </p>
          <p className="text-sm text-foreground whitespace-pre-wrap break-words leading-snug">
            {userDescription}
          </p>
        </div>
      )}
      <div data-testid={`${testIdPrefix}-auto`}>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
          What this does
        </p>
        {isLoading ? (
          <div className="space-y-1 mt-1" data-testid={`${testIdPrefix}-loading`}>
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ) : sentences.length === 0 ? (
          <p
            className="text-sm text-muted-foreground italic break-words leading-snug"
            data-testid={`${testIdPrefix}-empty`}
          >
            {emptyText}
          </p>
        ) : (
          <ul
            className="text-sm text-foreground leading-snug space-y-0.5 break-words"
            data-testid={`${testIdPrefix}-sentences`}
          >
            {sentences.map((s, i) => (
              <li
                key={i}
                className="break-words"
                data-testid={`${testIdPrefix}-sentence-${i}`}
              >
                {s}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
