import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import PaymentCheckout from "@/components/PaymentCheckout";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

/**
 * B811 — under a provider the page has one button.
 *
 * The chooser used to be rendered and hidden with a `hidden` class, so a page
 * that shows one button carried three, two of them unreachable. `display:none`
 * keeps them out of the accessibility tree, which is why this was tidiness
 * rather than a bug — but the next reader of the component had to work out
 * that a rendered chooser is never usable, and a Playwright run against the
 * live site counted the DOM rather than the page.
 *
 * Counted as markup rather than by class, so re-hiding it a different way
 * fails here too.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

const payment = {
  id: "pay_1",
  credits: 10,
  amountRappen: 1000,
  status: "pending" as const,
  method: null,
  paidAt: null,
};

function render(provider: "stripe" | "manual"): string {
  return renderToStaticMarkup(
    <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
      <PaymentCheckout username="alex" payment={payment} provider={provider} />
    </LocaleProvider>,
  );
}

function buttons(markup: string): number {
  return (markup.match(/<button/g) ?? []).length;
}

describe("the payment page's method chooser", () => {
  test("is not in the page at all under a provider", () => {
    const markup = render("stripe");
    expect(buttons(markup)).toBe(1);
    expect(markup).not.toContain("aria-pressed");
  });

  test("is still there, and still choosable, with no provider", () => {
    const markup = render("manual");
    expect(buttons(markup)).toBe(3);
    expect(markup).toContain('aria-pressed="true"');
  });
});
