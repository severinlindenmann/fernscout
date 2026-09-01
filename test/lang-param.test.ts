import { describe, expect, test } from "vitest";
import { NextRequest } from "next/server";
import { default as proxy } from "@/proxy";
import { LOCALE_COOKIE, PATH_HEADER } from "@/lib/requestKeys";

/**
 * `?lang=` — a shareable link in a particular language.
 *
 * The property that matters is that it works on the **first** request. A
 * cookie set only on the response would leave the page rendering that same
 * request reading the old value, so somebody following a German link would get
 * English once and German afterwards — which looks like the feature is broken
 * rather than slow.
 */

function get(url: string, cookie?: string) {
  const request = new NextRequest(new URL(url, "https://example.test"), {
    headers: cookie ? { cookie } : undefined,
  });
  const response = proxy(request);
  return { request, response };
}

describe("the lang parameter", () => {
  test("is carried on the same request, not only the next one", () => {
    const { request } = get("/example?lang=en");
    expect(request.cookies.get(LOCALE_COOKIE)?.value).toBe("en");
  });

  test("is remembered, so the next page needs no parameter", () => {
    const { response } = get("/example?lang=hu");
    const set = response.cookies.get(LOCALE_COOKIE);
    expect(set?.value).toBe("hu");
    expect(set?.path).toBe("/");
    expect(set?.maxAge).toBeGreaterThan(60 * 60 * 24 * 300);
  });

  test("normalises what a link might carry", () => {
    for (const [given, expected] of [
      ["DE", "de"],
      ["de-CH", "de"],
      [" hu ", "hu"],
      ["en-GB", "en"],
    ]) {
      expect(get(`/example?lang=${encodeURIComponent(given)}`).request.cookies.get(
        LOCALE_COOKIE,
      )?.value).toBe(expected);
    }
  });

  test("ignores anything that is not a language code", () => {
    for (const bad of ["", "1", "../de", "%00", "englishplease"]) {
      const { response } = get(`/example?lang=${encodeURIComponent(bad)}`);
      expect(response.cookies.get(LOCALE_COOKIE)).toBeUndefined();
    }
  });

  test("leaves a request with no parameter alone", () => {
    const { response } = get("/example");
    expect(response.cookies.get(LOCALE_COOKIE)).toBeUndefined();
  });

  test("a parameter overrides a cookie already set", () => {
    const { request } = get("/example?lang=hu", `${LOCALE_COOKIE}=de`);
    expect(request.cookies.get(LOCALE_COOKIE)?.value).toBe("hu");
  });

  /**
   * Middleware carries the request; whether a journal offers the language is
   * decided where its config is readable. So an unoffered code is accepted
   * here and falls back downstream — asserted in the layout's own behaviour.
   */
  test("does not decide whether a journal speaks the language", () => {
    const { request } = get("/example?lang=zz");
    expect(request.cookies.get(LOCALE_COOKIE)?.value).toBe("zz");
  });
});

/**
 * The path travels with the request so the root layout can tell whose journal
 * it is rendering. See `localeForPath`.
 */
describe("the path header", () => {
  test("is set on every request, parameter or not", () => {
    expect(get("/bea/trips").request.headers.get(PATH_HEADER)).toBe("/bea/trips");
    expect(get("/example?lang=de").request.headers.get(PATH_HEADER)).toBe("/example");
  });

  test("carries the path, never the query", () => {
    expect(get("/example?lang=de&x=1").request.headers.get(PATH_HEADER)).toBe("/example");
  });
});
