import { z } from 'zod';
import type { MergedPullWithFiles } from '@devdigest/shared';

/** GitHub's GraphQL connections accept at most 100 nodes per page. */
export const MERGED_PULLS_MAX = 100;
export const MERGED_PULL_FILES_PAGE = 100;

export const MERGED_PULLS_QUERY = `query ($owner: String!, $name: String!, $first: Int!, $files: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: MERGED, first: $first, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes {
        number
        title
        mergedAt
        author { login }
        files(first: $files) { totalCount nodes { path } }
      }
    }
  }
}`;

const MergedPullsResponse = z.object({
  repository: z
    .object({
      pullRequests: z.object({
        nodes: z
          .array(
            z
              .object({
                number: z.number().int(),
                title: z.string(),
                mergedAt: z.string().nullable(),
                author: z.object({ login: z.string() }).nullable(),
                files: z
                  .object({
                    totalCount: z.number().int(),
                    nodes: z.array(z.object({ path: z.string() }).nullable()).nullable(),
                  })
                  .nullable(),
              })
              .nullable(),
          )
          .nullable(),
      }),
    })
    .nullable(),
});

export function toMergedPulls(raw: unknown): MergedPullWithFiles[] {
  const { repository } = MergedPullsResponse.parse(raw);
  if (repository === null) throw new Error('GitHub repository is not accessible');

  const out: MergedPullWithFiles[] = [];
  for (const node of repository.pullRequests.nodes ?? []) {
    if (node === null || node.mergedAt === null) continue;
    const files: string[] = [];
    for (const f of node.files?.nodes ?? []) {
      if (f !== null) files.push(f.path);
    }
    out.push({
      number: node.number,
      title: node.title,
      author: node.author?.login ?? 'unknown',
      mergedAt: node.mergedAt,
      files,
      filesTruncated: (node.files?.totalCount ?? 0) > files.length,
    });
  }
  return out;
}
