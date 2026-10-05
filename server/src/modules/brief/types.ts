import type {
  BlastRadius,
  Intent,
  LLMProvider,
  PrBriefRecord,
  ReviewFocusItem,
  Risk,
  SmartDiffRole,
} from '@devdigest/shared';
import type { PromptLog } from '../../platform/prompt-log.js';

export interface LineRange {
  start: number;
  end: number;
}

export interface AnswerCheck {
  allowed: ReadonlySet<string>;
  ranges: ReadonlyMap<string, LineRange[]>;
}

export interface ValidatedAnswer {
  risks: Risk[];
  reviewFocus: ReviewFocusItem[];
  discarded: { risks: number; reviewFocus: number };
}

export interface DiffStatFile {
  path: string;
  additions: number;
  deletions: number;
  role: SmartDiffRole;
  ranges: LineRange[];
}

export interface WorkspaceDocumentLike {
  path: string;
  text: string;
}

export interface BriefFacts {
  files: DiffStatFile[];
  intent: Intent | null;
  blast: { summary: string; callerFiles: string[] } | null;
  title: string;
  description: string;
  documents: WorkspaceDocumentLike[];
}

export interface BriefTokenCounter {
  count(text: string): number;
}

export type StoredBrief = Omit<PrBriefRecord, 'stale'>;

export interface BriefPullRecord {
  id: string;
  repoId: string;
  title: string;
  body: string | null;
  headSha: string;
}

export interface BriefPullFile {
  path: string;
  additions: number;
  deletions: number;
  patch: string | null;
}

export interface BriefPullsReader {
  getById(workspaceId: string, prId: string): Promise<BriefPullRecord | undefined>;
  listFiles(prId: string): Promise<BriefPullFile[]>;
}

export interface BriefIntentReader {
  getForPull(workspaceId: string, prId: string): Promise<{ intent: Intent | null }>;
}

export interface BriefBlastReader {
  forPull(workspaceId: string, prId: string): Promise<BlastRadius>;
}

export interface BriefContextReader {
  resolveForWorkspace(workspaceId: string, repoId: string): Promise<WorkspaceDocumentLike[]>;
}

export interface BriefRoleReader {
  classify(path: string): SmartDiffRole;
}

export interface BriefStore {
  get(prId: string): Promise<StoredBrief | undefined>;
  upsert(prId: string, brief: StoredBrief): Promise<void>;
}

export interface BriefSettingsReader {
  listForWorkspace(workspaceId: string): Promise<{ key: string; value: unknown }[]>;
}

export interface BriefLogger {
  info(obj: unknown, msg?: string): void;
}

export interface BriefDeps {
  readonly store: BriefStore;
  readonly pulls: BriefPullsReader;
  readonly intent: BriefIntentReader;
  readonly blast: BriefBlastReader;
  readonly context: BriefContextReader;
  readonly roles: BriefRoleReader;
  readonly settingsRepo: BriefSettingsReader;
  readonly tokenizer: BriefTokenCounter;
  readonly log: BriefLogger;
  llm(id: 'openai' | 'anthropic' | 'openrouter'): Promise<LLMProvider>;
  promptLog(): PromptLog;
}
