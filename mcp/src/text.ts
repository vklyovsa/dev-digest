const NON_WHITESPACE_CONTROLS = /[\u0000-\u0008\u000e-\u001f\u007f]/g;
const HIGH_SURROGATE_MIN = 0xd800;
const HIGH_SURROGATE_MAX = 0xdbff;

export function clip(value: string, max: number): string {
  const flat = value.replace(NON_WHITESPACE_CONTROLS, '').replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  if (max < 1) return '';
  let end = max - 1;
  const last = flat.charCodeAt(end - 1);
  if (last >= HIGH_SURROGATE_MIN && last <= HIGH_SURROGATE_MAX) end -= 1;
  return `${flat.slice(0, end).trimEnd()}…`;
}

export function joinCapped(items: readonly string[], max: number): string {
  const shown = items.slice(0, max).join(', ');
  const rest = items.length - max;
  return rest > 0 ? `${shown}, +${rest} more` : shown;
}

export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function shrinkToFit<T>(
  count: number,
  render: (shown: number) => T,
  maxChars: number,
): { shown: number; value: T } {
  let shown = count;
  let value = render(shown);
  while (shown > 0 && JSON.stringify(value).length > maxChars) {
    shown -= 1;
    value = render(shown);
  }
  return { shown, value };
}
