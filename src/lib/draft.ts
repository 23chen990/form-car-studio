import type { Draft, EditField, Target } from "../../shared/types";

export const KEEP_CURRENT = "keep" as const;
export const EMPTY_TARGET: Target = {
  bodyColor: KEEP_CURRENT,
  wheelColor: KEEP_CURRENT,
};

function fieldIsKnown(value: string | undefined): value is string {
  return (
    typeof value === "string" && value.length > 0 && value !== KEEP_CURRENT
  );
}

/** Replace one draft field. A value matching the verified base means no override. */
export function selectColor(
  target: Target,
  field: EditField,
  value: string,
  verifiedBase?: Partial<Target>,
): Target {
  const next: Target = { ...target };
  const currentBase = verifiedBase?.[field];
  next[field] =
    currentBase && value !== KEEP_CURRENT && value === currentBase
      ? KEEP_CURRENT
      : value;
  return next;
}

export function countChanges(target: Target): number {
  return [target.bodyColor, target.wheelColor].filter(fieldIsKnown).length;
}

export function hasChanges(target: Target): boolean {
  return countChanges(target) > 0;
}

export function changedFields(target: Target): EditField[] {
  return (["bodyColor", "wheelColor"] as EditField[]).filter((field) =>
    fieldIsKnown(target[field]),
  );
}

export function changeSummary(
  target: Target,
  verifiedBase?: Partial<Target>,
): Array<{ field: EditField; from: string; to: string }> {
  return changedFields(target).map((field) => ({
    field,
    from: verifiedBase?.[field] ?? "Current appearance",
    to: target[field],
  }));
}

export function draftFor(
  projectDraft: Draft | null | undefined,
  fallback: Draft,
): Draft {
  return projectDraft
    ? { ...projectDraft, target: { ...EMPTY_TARGET, ...projectDraft.target } }
    : fallback;
}
