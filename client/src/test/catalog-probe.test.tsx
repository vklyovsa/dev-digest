import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { NextIntlClientProvider, useTranslations } from "next-intl";
import { markCatalog, unmarkedStrings } from "./catalog-probe";

afterEach(cleanup);

const CATALOG = {
  probe: {
    title: "Probe heading",
    inner: "inner text",
    outer: "outer with {inner} inside",
    withData: "value is {name}",
    button: "Press",
    hint: "Hint text",
  },
};

const PATH = "src/a.ts";

function Probe({ literal }: { literal: boolean }) {
  const t = useTranslations("probe");
  return (
    <section>
      <h2>{t("title")}</h2>
      <p>{t("outer", { inner: t("inner") })}</p>
      <p>{t("withData", { name: PATH })}</p>
      <p>
        <span>{PATH}</span>:<span>{12}</span>
      </p>
      <button aria-label={t("button")} title={t("hint")}>
        {t("button")}
      </button>
      {literal ? (
        <>
          <p>Hardcoded</p>
          <button aria-label="Hardcoded label">{t("button")}</button>
        </>
      ) : null}
    </section>
  );
}

function renderProbe(literal: boolean) {
  const { container } = render(
    <NextIntlClientProvider locale="en" messages={markCatalog(CATALOG)}>
      <Probe literal={literal} />
    </NextIntlClientProvider>,
  );
  return container;
}

describe("markCatalog", () => {
  it("wraps every leaf string of a deep copy and leaves the original alone", () => {
    const original = { a: { b: "text with {x}", list: ["first", "second"] }, count: 3 };
    const marked = markCatalog(original);

    expect(marked).toEqual({ a: { b: "[[text with {x}]]", list: ["[[first]]", "[[second]]"] }, count: 3 });
    expect(original.a.b).toBe("text with {x}");
  });
});

describe("unmarkedStrings", () => {
  it("returns exactly the hardcoded word and the hardcoded aria-label", () => {
    const container = renderProbe(true);

    expect(unmarkedStrings(container, [PATH])).toEqual(["Hardcoded", "Hardcoded label"]);
  });

  it("returns nothing for catalog text, interpolated data, a nested message and a lone colon", () => {
    const container = renderProbe(false);

    expect(container.textContent).toContain(`${PATH}:12`);
    expect(container.textContent).toContain("[[outer with [[inner text]] inside]]");
    expect(unmarkedStrings(container, [PATH])).toEqual([]);
  });

  it("reports a data string that the caller did not declare", () => {
    const container = renderProbe(false);

    expect(unmarkedStrings(container, [])).toEqual([PATH]);
  });

  it("reads title, alt and placeholder values as well", () => {
    const { container } = render(
      <div>
        <button title="Literal title">{"1"}</button>
        <img alt="Literal alt" src="x.png" />
        <input placeholder="Literal placeholder" />
        <input placeholder="[[From catalog]]" />
      </div>,
    );

    expect(unmarkedStrings(container, [])).toEqual(["Literal title", "Literal alt", "Literal placeholder"]);
  });
});
