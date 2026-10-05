import { randomUUID } from 'node:crypto';
import { promptFingerprint } from '@devdigest/reviewer-core';
import {
  PrBriefAnswer,
  type FeatureModelChoice,
  type LLMProvider,
  type PrBriefResponse,
  type StructuredResult,
} from '@devdigest/shared';
import { AppError, ConfigError, ExternalServiceError, NotFoundError } from '../../platform/errors.js';
import { TimeoutError, withTimeout } from '../../platform/resilience.js';
import { loadPromptTemplate } from '../../platform/prompts.js';
import { logPromptAssembly } from '../../platform/prompt-log.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { fitToBudget } from './budget.js';
import {
  BRIEF_INPUT_BUDGET_TOKENS,
  BRIEF_MAX_RETRIES,
  BRIEF_MAX_TOKENS,
  BRIEF_MODEL_DEADLINE_MS,
  BRIEF_MODEL_TIMEOUT_MS,
  BRIEF_SCHEMA_NAME,
} from './constants.js';
import {
  allowedFiles,
  callerFilesOf,
  changedLineRanges,
  toBriefRecord,
  toStoredBlast,
  toStoredIntent,
  validateAnswer,
} from './helpers.js';
import { renderBriefInput } from './render.js';
import type { BriefDeps, BriefFacts, BriefPullRecord, StoredBrief } from './types.js';

export class BriefService {
  constructor(private readonly deps: BriefDeps) {}

  async getForPull(workspaceId: string, prId: string): Promise<PrBriefResponse> {
    const pull = await this.requirePull(workspaceId, prId);
    const stored = await this.deps.store.get(prId);
    return { brief: stored ? toBriefRecord(stored, pull.headSha) : null };
  }

  async generate(
    workspaceId: string,
    prId: string,
    correlationId: string = randomUUID(),
  ): Promise<PrBriefResponse> {
    const startedAt = Date.now();
    const pull = await this.requirePull(workspaceId, prId);
    const choice = await resolveFeatureModel(this.deps, workspaceId, 'risk_brief');
    const llm = await this.resolveLlm(choice);

    const [files, intentResponse, blastResponse, documents] = await Promise.all([
      this.deps.pulls.listFiles(prId),
      this.deps.intent.getForPull(workspaceId, prId),
      this.deps.blast.forPull(workspaceId, prId),
      this.deps.context.resolveForWorkspace(workspaceId, pull.repoId),
    ]);

    const intent = toStoredIntent(intentResponse.intent);
    const blast = toStoredBlast(blastResponse);
    const facts: BriefFacts = {
      files: files.map((file) => ({
        path: file.path,
        additions: file.additions,
        deletions: file.deletions,
        role: this.deps.roles.classify(file.path),
        ranges: changedLineRanges(file.patch),
      })),
      intent,
      blast: blast === null ? null : { summary: blast.summary, callerFiles: callerFilesOf(blast) },
      title: pull.title,
      description: pull.body ?? '',
      documents,
    };

    const system = await loadPromptTemplate('brief.system.md');
    const fitted = fitToBudget(facts, {
      system,
      budget: BRIEF_INPUT_BUDGET_TOKENS,
      count: (text) => this.deps.tokenizer.count(text),
    });
    const input = renderBriefInput(fitted.facts);

    logPromptAssembly(
      this.deps.promptLog(),
      {
        purpose: 'brief',
        correlationId,
        prId,
        provider: choice.provider,
        model: choice.model,
      },
      [
        {
          name: 'system',
          source: 'prompt:brief.system.md',
          wrapped: false,
          chars: system.length,
          fingerprint: promptFingerprint(system),
        },
        ...input.sections,
      ],
    );

    const result = await this.callModel(llm, choice, system, input.user);

    const validated = validateAnswer(result.data, {
      allowed: allowedFiles(
        files.map((file) => file.path),
        blast,
      ),
      ranges: new Map(facts.files.map((file) => [file.path, file.ranges])),
    });

    const stored: StoredBrief = {
      pr_id: prId,
      head_sha: pull.headSha,
      summary: result.data.summary,
      risks: { risks: validated.risks },
      review_focus: validated.reviewFocus,
      intent,
      blast,
      provider: choice.provider,
      model: choice.model,
      tokens_in: result.tokensIn,
      tokens_out: result.tokensOut,
      cost_usd: result.costUsd,
      documents_read: fitted.facts.documents.map((doc) => doc.path),
    };
    await this.deps.store.upsert(prId, stored);

    this.deps.log.info(
      {
        event: 'brief.generated',
        prId,
        provider: choice.provider,
        model: choice.model,
        inputTokens: fitted.inputTokens,
        budget: BRIEF_INPUT_BUDGET_TOKENS,
        attempts: result.attempts,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        risksKept: validated.risks.length,
        risksDiscarded: validated.discarded.risks,
        focusKept: validated.reviewFocus.length,
        focusDiscarded: validated.discarded.reviewFocus,
        durationMs: Date.now() - startedAt,
      },
      'brief generated',
    );

    return { brief: toBriefRecord(stored, pull.headSha) };
  }

  private async requirePull(workspaceId: string, prId: string): Promise<BriefPullRecord> {
    const pull = await this.deps.pulls.getById(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    return pull;
  }

  private async resolveLlm(choice: FeatureModelChoice): Promise<LLMProvider> {
    try {
      return await this.deps.llm(choice.provider);
    } catch (err) {
      if (err instanceof ConfigError) {
        throw new AppError(
          'brief_model_unavailable',
          `${choice.provider} API key is not configured — add it under Settings → API Keys or pick another model in Settings → Models`,
          400,
        );
      }
      throw err;
    }
  }

  private async callModel(
    llm: LLMProvider,
    choice: FeatureModelChoice,
    system: string,
    user: string,
  ): Promise<StructuredResult<PrBriefAnswer>> {
    try {
      return await withTimeout(
        llm.completeStructured({
          model: choice.model,
          schema: PrBriefAnswer,
          schemaName: BRIEF_SCHEMA_NAME,
          temperature: 0,
          maxRetries: BRIEF_MAX_RETRIES,
          timeoutMs: BRIEF_MODEL_TIMEOUT_MS,
          maxTokens: BRIEF_MAX_TOKENS,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
        BRIEF_MODEL_DEADLINE_MS,
      );
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (err instanceof TimeoutError) {
        throw new ExternalServiceError('The brief model timed out.');
      }
      throw new ExternalServiceError(
        err instanceof Error ? err.message : 'The brief generation failed.',
      );
    }
  }
}
