import type { EvalRunCompare, EvalSkillRunCompare } from "@devdigest/shared";

export type CompareInput =
  | { kind: "agent"; data: EvalRunCompare; none: string }
  | { kind: "skill"; data: EvalSkillRunCompare; hostNames: ReadonlyMap<string, string>; none: string };

export interface CompareConfigRow {
  id: "provider" | "model" | "skills" | "hostAgent" | "hostVersion";
  from: string;
  to: string;
}

export interface CompareView {
  baseVersion: number;
  headVersion: number;
  baseText: string;
  headText: string;
  sameText: boolean;
  configRows: CompareConfigRow[];
}

/** What the dialog body shows of either response: the versions, the two texts and the configuration that differs. */
export function compareView(input: CompareInput): CompareView {
  if (input.kind === "agent") {
    const { base, head } = input.data;
    const skills = (side: { skills: string[] }) => (side.skills.length > 0 ? side.skills.join(", ") : input.none);
    const rows: CompareConfigRow[] = [
      { id: "provider", from: base.provider, to: head.provider },
      { id: "model", from: base.model, to: head.model },
      { id: "skills", from: skills(base), to: skills(head) },
    ];
    return {
      baseVersion: base.agent_version,
      headVersion: head.agent_version,
      baseText: base.system_prompt,
      headText: head.system_prompt,
      sameText: base.system_prompt === head.system_prompt,
      configRows: rows.filter((r) => r.from !== r.to),
    };
  }
  const { base, head } = input.data;
  const host = (id: string) => input.hostNames.get(id) ?? id;
  const rows: CompareConfigRow[] = [
    { id: "hostAgent", from: host(base.agent_id), to: host(head.agent_id) },
    { id: "hostVersion", from: `v${base.agent_version}`, to: `v${head.agent_version}` },
    { id: "provider", from: base.provider, to: head.provider },
    { id: "model", from: base.model, to: head.model },
  ];
  return {
    baseVersion: base.skill_version,
    headVersion: head.skill_version,
    baseText: base.skill_body,
    headText: head.skill_body,
    sameText: base.skill_version === head.skill_version,
    configRows: rows.filter((r) => r.from !== r.to),
  };
}
