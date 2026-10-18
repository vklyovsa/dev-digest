const MIN_SECRET_LENGTH = 8;

export function redactSecrets(text: string, secrets: (string | undefined)[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret && secret.length >= MIN_SECRET_LENGTH) out = out.split(secret).join('***');
  }
  return out;
}
