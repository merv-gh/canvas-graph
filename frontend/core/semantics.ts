export type DataScale = 'small' | 'medium' | 'big' | 'huge';

export type SemanticFields = {
  Purpose?: string;
  Assumptions?: string;
  Limits?: string;
  WhatThen?: string;
  Observability?: string;
  FailureMode?: string;
  DataScale?: DataScale;
  FreshnessMs?: number;
};

export const mergeSemantics = <T extends SemanticFields>(base: SemanticFields, item: T): T =>
  ({ ...base, ...item });

export const hasCompleteSemantics = (item: SemanticFields) =>
  !!(item.Purpose && item.Assumptions && item.Limits && item.WhatThen && item.Observability);

export const hasFailurePlan = (item: SemanticFields) =>
  !!(item.FailureMode || item.WhatThen?.match(/retry|dlq|fallback|circuit|timeout|reconcile/i));

export const semanticTitle = (item: SemanticFields) => [
  item.Purpose && `Purpose: ${item.Purpose}`,
  item.Assumptions && `Assumptions: ${item.Assumptions}`,
  item.Limits && `Limits: ${item.Limits}`,
  item.WhatThen && `What then: ${item.WhatThen}`,
  item.Observability && `Observe: ${item.Observability}`,
  item.FailureMode && `If fails: ${item.FailureMode}`,
  item.DataScale && `Data scale: ${item.DataScale}`,
  item.FreshnessMs != null && `Freshness: ${item.FreshnessMs}ms`,
].filter(Boolean).join('\n');
