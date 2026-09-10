/**
 * Set an input's value the way a real keystroke does.
 *
 * `input.value = "x"` writes through the property descriptor React installs
 * on `HTMLInputElement.prototype` to track what it last wrote, so React sees
 * no change and a dispatched `input` event that follows is a no-op — the
 * component's state never moves, and a test built on it can pass while
 * testing nothing (B853). The native setter, read off the prototype before
 * React shadows it, is what fires React's own change detection.
 *
 * Callers still wrap the call in `act()` themselves — sync or async, alone or
 * alongside a submit — because that differs per test and is not this
 * helper's business.
 */
export function typeInto(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  // The ask field became a textarea in B1211; the native setter lives on
  // each element's own prototype, so pick the right one.
  const proto =
    el instanceof window.HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}
