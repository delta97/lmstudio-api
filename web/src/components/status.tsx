/**
 * Status badge components. The underlying data/types/helpers live in
 * `@/lib/status`.
 */

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  DECIDED_BY_LABEL,
  SEVERITY_META,
  VERDICT_META,
  type Severity,
  type VerdictValue,
} from "@/lib/status";
import type { UrlComparisonItem } from "@/lib/types";

export function VerdictBadge({
  verdict,
  className,
  withIcon = true,
}: {
  verdict: VerdictValue;
  className?: string;
  withIcon?: boolean;
}) {
  const meta = VERDICT_META[verdict];
  const Icon = meta.Icon;
  return (
    <Badge variant="outline" className={cn(meta.chip, className)}>
      {withIcon ? <Icon data-icon="inline-start" /> : null}
      {meta.label}
    </Badge>
  );
}

export function DecidedByBadge({
  decidedBy,
  className,
}: {
  decidedBy: UrlComparisonItem["decidedBy"];
  className?: string;
}) {
  return (
    <Badge
      variant="secondary"
      className={cn("font-mono text-[0.7rem] lowercase", className)}
    >
      {DECIDED_BY_LABEL[decidedBy] ?? decidedBy}
    </Badge>
  );
}

export function SeverityBadge({
  severity,
  className,
}: {
  severity: Severity;
  className?: string;
}) {
  const meta = SEVERITY_META[severity];
  return (
    <Badge variant="outline" className={cn(meta.chip, className)}>
      <span className={cn("size-1.5 rounded-full", meta.dot)} aria-hidden />
      {meta.label}
    </Badge>
  );
}
