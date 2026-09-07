import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import BusyButton from "@/components/BusyButton";

/**
 * B867. The things this component promises that a reviewer cannot see by
 * reading it: that a busy button is genuinely unpressable, that it says so to
 * somebody who cannot watch the spinner turn, and that the three
 * `<form method="post">` posts still render an ordinary submit button — their
 * whole design is that they work with JavaScript off, and nothing added here
 * may be load bearing for the submit itself.
 */
describe("BusyButton", () => {
  test("a busy button is disabled, so the second press cannot happen", () => {
    const html = renderToStaticMarkup(<BusyButton busy>Send</BusyButton>);
    expect(html).toContain("disabled");
  });

  test("it says it is busy to somebody who cannot see the spinner", () => {
    expect(renderToStaticMarkup(<BusyButton busy>Send</BusyButton>)).toContain(
      'aria-busy="true"',
    );
    expect(
      renderToStaticMarkup(<BusyButton busy={false}>Send</BusyButton>),
    ).not.toContain("aria-busy");
  });

  test("the spinner is there while busy and gone when it is not", () => {
    expect(renderToStaticMarkup(<BusyButton busy>Send</BusyButton>)).toContain(
      "animate-spin",
    );
    expect(
      renderToStaticMarkup(<BusyButton busy={false}>Send</BusyButton>),
    ).not.toContain("animate-spin");
  });

  test("somebody who asked for less movement still gets told", () => {
    // Silence is not the accessible answer here — it is the same "nothing
    // happened" the whole ticket is about.
    expect(renderToStaticMarkup(<BusyButton busy>Send</BusyButton>)).toContain(
      "motion-reduce:animate-pulse",
    );
  });

  test("busyLabel replaces the label only while busy", () => {
    expect(
      renderToStaticMarkup(
        <BusyButton busy={false} busyLabel="Sending…">
          Send
        </BusyButton>,
      ),
    ).toContain("Send");
    const working = renderToStaticMarkup(
      <BusyButton busy busyLabel="Sending…">
        Send
      </BusyButton>,
    );
    expect(working).toContain("Sending");
    expect(working).not.toContain(">Send<");
  });

  test("a caller's own disabled cannot overwrite the busy one", () => {
    // `{...rest}` used to be spread after `disabled` was computed, so a caller
    // passing `disabled={false}` handed back the double press this exists to
    // stop.
    expect(
      renderToStaticMarkup(
        <BusyButton busy disabled={false}>
          Send
        </BusyButton>,
      ),
    ).toContain("disabled");
  });

  test("idle, it is a plain submit button and nothing else", () => {
    const html = renderToStaticMarkup(
      <form action="/somewhere" method="post">
        <BusyButton type="submit">Send</BusyButton>
      </form>,
    );
    expect(html).toContain('type="submit"');
    expect(html).toContain("<button ");
    expect(html).not.toContain("disabled");
  });
});
