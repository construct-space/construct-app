import { describe, expect, it } from "vitest";
import {
  isExplicitBlankTarget,
  shouldOpenPopupInNewTab,
} from "./popupRouting";
import type { BrowserPopupPayload } from "./pageBridge";

function payload(overrides: Partial<BrowserPopupPayload> = {}): BrowserPopupPayload {
  return {
    tabId: "t1",
    webviewLabel: "tab-t1",
    url: "https://example.com",
    popupId: null,
    target: null,
    via: "target-blank",
    ...overrides,
  };
}

describe("popup routing", () => {
  it("treats _blank target values case-insensitively", () => {
    expect(isExplicitBlankTarget("_blank")).toBe(true);
    expect(isExplicitBlankTarget("_BLANK")).toBe(true);
    expect(isExplicitBlankTarget(" _Blank ")).toBe(true);
    expect(isExplicitBlankTarget("_self")).toBe(false);
  });

  it("always opens explicit _blank links in a new tab", () => {
    expect(
      shouldOpenPopupInNewTab(
        payload({ via: "target-blank", target: "_blank" }),
        false,
      ),
    ).toBe(true);
    expect(
      shouldOpenPopupInNewTab(
        payload({ via: "target-blank", target: "_BLANK" }),
        false,
      ),
    ).toBe(true);
  });

  it("always opens popup-backed window.open calls in a new tab", () => {
    expect(
      shouldOpenPopupInNewTab(
        payload({ via: "window.open", popupId: "popup-1", target: "named" }),
        false,
      ),
    ).toBe(true);
  });

  it("falls back to browser settings for ordinary links", () => {
    const externalLink = payload({ via: "window.open", popupId: null, target: null });
    expect(shouldOpenPopupInNewTab(externalLink, false)).toBe(false);
    expect(shouldOpenPopupInNewTab(externalLink, true)).toBe(true);
  });
});
