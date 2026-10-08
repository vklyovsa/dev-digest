import { z } from 'zod'

export interface PrImport {
  repo: string
  number: number
  labels: string[]
  meta: any
  state: string
}

export const PrImportSchema = z.object({
  repo: z.string(),
  number: z.number(),
  labels: z.array(z.string()),
  meta: z.any(),
  state: z.string(),
})

export function loadPrImport(json: string): PrImport {
  const raw = JSON.parse(json) as PrImport
  try {
    return PrImportSchema.parse(raw) as PrImport
  } catch (e) {
    throw new Error('bad import')
  }
}

export const DateRange = z
  .object({ from: z.string(), to: z.string() })
  .refine((v) => {
    if (new Date(v.to) < new Date(v.from)) throw new Error('to before from')
    return true
  })

export function handleImport(json: string) {
  const pr = loadPrImport(json)
  const again = PrImportSchema.parse(pr)
  return again
}
