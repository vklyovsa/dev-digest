const OPEN = "[[";
const CLOSE = "]]";
const TEXT_ATTRIBUTES = ["aria-label", "title", "alt", "placeholder"];
const LETTER = /\p{L}/u;

function mark(value: unknown): unknown {
  if (typeof value === "string") return `${OPEN}${value}${CLOSE}`;
  if (Array.isArray(value)) return value.map(mark);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, leaf]) => [key, mark(leaf)]));
  }
  return value;
}

export function markCatalog<T>(messages: T): T {
  return mark(messages) as T;
}

function stripSpans(text: string): string {
  let depth = 0;
  let kept = "";
  for (let i = 0; i < text.length; i++) {
    const pair = text.slice(i, i + 2);
    if (pair === OPEN) {
      depth++;
      i++;
    } else if (pair === CLOSE && depth > 0) {
      depth--;
      i++;
    } else if (depth === 0) {
      kept += text[i];
    }
  }
  return kept;
}

function collect(node: Node, out: string[]): void {
  if (node.nodeType === 3) {
    out.push(node.textContent ?? "");
    return;
  }
  if (node.nodeType !== 1) return;
  const element = node as Element;
  for (const name of TEXT_ATTRIBUTES) {
    const value = element.getAttribute(name);
    if (value !== null) out.push(value);
  }
  element.childNodes.forEach((child) => collect(child, out));
}

export function unmarkedStrings(root: HTMLElement, data: readonly string[]): string[] {
  const found: string[] = [];
  collect(root, found);
  return found
    .map((text) => data.reduce((rest, datum) => (datum ? rest.split(datum).join("") : rest), stripSpans(text)))
    .map((rest) => rest.trim())
    .filter((rest) => LETTER.test(rest));
}
