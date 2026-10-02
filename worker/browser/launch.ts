import fs from "node:fs";
import { chromium, type BrowserContext, type Page } from "playwright";
import { browserProfileDir } from "../paths";
import { log } from "../logger";

export async function launchBrowser(): Promise<{ context: BrowserContext; page: Page }> {
  const profile = browserProfileDir();
  fs.mkdirSync(profile, { recursive: true });
  const headless = process.env.WORKER_HEADLESS === "true";
  const channel = process.env.WORKER_BROWSER_CHANNEL?.trim() || "chrome";
  const options = {
    headless,
    viewport: { width: 1280, height: 800 },
    acceptDownloads: false,
  };
  try {
    const context = await chromium.launchPersistentContext(profile, { ...options, channel });
    const page = context.pages()[0] ?? (await context.newPage());
    log("info", "browser_launched", { channel, headless });
    return { context, page };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Chrome channel failed.";
    log("warn", "browser_channel_failed", { channel, message });
    if (/existing browser session|profile is already in use/i.test(message)) {
      throw new Error(
        "The dedicated browser profile is already open. Close that ShootPortal browser window, then start the worker again.",
      );
    }
    try {
      const context = await chromium.launchPersistentContext(profile, options);
      const page = context.pages()[0] ?? (await context.newPage());
      log("info", "browser_launched", { channel: "chromium", headless });
      return { context, page };
    } catch (fallback) {
      const fallbackMessage = fallback instanceof Error ? fallback.message : "Chromium fallback failed.";
      throw new Error(
        `Could not launch ${channel}. ${fallbackMessage} Install Google Chrome, or run npx playwright install chromium.`,
      );
    }
  }
}
