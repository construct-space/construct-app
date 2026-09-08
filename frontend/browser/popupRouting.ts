import type { BrowserPopupPayload } from "./pageBridge";

export function isExplicitBlankTarget(target: string | null | undefined): boolean {
  return `${target || ""}`.trim().toLowerCase() === "_blank";
}

export function shouldOpenPopupInNewTab(
  payload: BrowserPopupPayload,
  openExternalLinksInNewTab: boolean,
): boolean {
  if (`${payload.popupId || ""}`.trim()) return true;
  if (payload.via === "target-blank") return true;
  if (isExplicitBlankTarget(payload.target)) return true;
  return openExternalLinksInNewTab;
}
