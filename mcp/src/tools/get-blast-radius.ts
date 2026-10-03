import { ToolError } from '../errors.js';

export const BLAST_RADIUS_NOT_IMPLEMENTED =
  'get_blast_radius is not implemented yet in this DevDigest build. Do not retry. No other tool on this server returns impact data; tell the user it is unavailable.';

export function getBlastRadius(): never {
  throw new ToolError(BLAST_RADIUS_NOT_IMPLEMENTED);
}
