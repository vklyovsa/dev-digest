import type { SmartDiffRole } from "@devdigest/shared";

export type DiffOrder = "smart" | "original";

export const ROLE_META: Record<
  SmartDiffRole,
  { labelKey: string; descriptionKey: string; swatch: string; defaultOpen: boolean }
> = {
  core: { labelKey: "coreLabel", descriptionKey: "coreDescription", swatch: "var(--accent)", defaultOpen: true },
  tests: { labelKey: "testsLabel", descriptionKey: "testsDescription", swatch: "var(--ok)", defaultOpen: true },
  wiring: { labelKey: "wiringLabel", descriptionKey: "wiringDescription", swatch: "var(--warn)", defaultOpen: true },
  docs: { labelKey: "docsLabel", descriptionKey: "docsDescription", swatch: "var(--text-secondary)", defaultOpen: false },
  boilerplate: {
    labelKey: "boilerplateLabel",
    descriptionKey: "boilerplateDescription",
    swatch: "var(--text-muted)",
    defaultOpen: false,
  },
};
