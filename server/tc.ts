import { z } from 'zod'

export const PrImportSchema = z.object({
  repo: z.string().min(1, 'repo is required'),
  number: z.number().int().positive(),
  labels: z.array(z.string()),
  meta: z.unknown(),
  state: z.string(),
})

export type PrImport = z.infer<typeof PrImportSchema>

export function loadPrImport(json: string): PrImport {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch (cause) {
    throw new Error('bad import', { cause })
  }
  const result = PrImportSchema.safeParse(raw)
  if (!result.success) {
    throw new Error('bad import', { cause: result.error })
  }
  return result.data
}

export const DateRange = z
  .object({ from: z.string(), to: z.string() })
  .refine((v) => !(new Date(v.to) < new Date(v.from)), {
    message: 'to before from',
    path: ['to'],
  })

export function handleImport(json: string): PrImport {
  return loadPrImport(json)
}
