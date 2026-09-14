import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import PaymentCheckout from "@/components/PaymentCheckout";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

/**
 * B1411 — a Stripe `requested` row with no evidence of payment gets the Pay
 * button back, and the returning-from-Stripe poll (`?returned=1`) still shows
 * the no-button confirming panel while it runs.
 *
 * `requested` under Stripe only ever meant "a checkout session was offered".
 * Before this fix the page treated it as proof a payment might be settling
 * and rendered no control at all — the dead end this ticket reports.
 */
const params = vi.hoisted(() => ({ current: new URLSearchParams() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => params.current,
}));

const requestedPayment = {
  id: "pay_1",
  credits: 200,
  amountRappen: 3518,
  status: "requested" as const,
  method: null,
  paidAt: null,
};

function render(): string {
  return renderToStaticMarkup(
    <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
      <PaymentCheckout
        username="alex"
        payment={requestedPayment}
        provider="stripe"
      />
    </LocaleProvider>,
  );
}

describe("a Stripe payment stuck at requested", () => {
  test("offers Pay again when there is no evidence a payment happened", () => {
    params.current = new URLSearchParams();
    const markup = render();
    expect(markup).toContain("<button");
    expect(markup).toContain("Pay CHF");
    // Honest about the state: no button-less "confirming" claim.
    expect(markup).not.toContain("Confirming your payment");
  });

  test("still shows the no-button confirming panel just back from Stripe", () => {
    params.current = new URLSearchParams("returned=1");
    const markup = render();
    expect(markup).toContain("Confirming your payment");
    expect(markup).not.toContain("Pay CHF");
  });
});
