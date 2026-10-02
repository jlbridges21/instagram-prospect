import type { Page } from "playwright";
import { NavigationError } from "./errors";
import type { DomSnapshot } from "./types";

const NAVIGATION_TIMEOUT_MS = 25_000;

const READ_DOM_SOURCE = `() => {
  const textOf = (node) => (node.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 180);
  const buttonOf = (button) => {
    const text = (button.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 80);
    const label = (button.getAttribute("aria-label") || "").trim().slice(0, 80);
    return { name: label || text, text, label };
  };
  const links = [...document.querySelectorAll("a")].slice(0, 250).map((anchor) => {
    const titled = anchor.querySelector("[title]");
    return {
      href: anchor.getAttribute("href") || "",
      text: textOf(anchor),
      label: (anchor.getAttribute("aria-label") || "").trim(),
      title: (anchor.getAttribute("title") || (titled && titled.getAttribute("title")) || "").trim(),
    };
  });
  const buttons = [...document.querySelectorAll("button, [role='button']")].slice(0, 80).map(buttonOf).filter((button) => button.name);
  const header = document.querySelector("header");
  const headerButtons = header ? [...header.querySelectorAll("button, [role='button']")].slice(0, 20).map(buttonOf).filter((button) => button.name) : [];
  const headerLines = header ? (header.innerText || "").split(/\\n+/).map((line) => line.trim()).filter(Boolean).slice(0, 40) : [];
  const meta = document.querySelector('meta[property="og:description"]') || document.querySelector('meta[name="description"]');
  const images = [...document.querySelectorAll("img")].slice(0, 20).map((image) => ({
    alt: image.alt || "",
    src: image.currentSrc || image.src || "",
  }));
  const textboxes = [...document.querySelectorAll("textarea, [role='textbox'], input[type='text']")]
    .slice(0, 10)
    .map((box) => ({
      name: (box.getAttribute("aria-label") || box.getAttribute("placeholder") || "").trim(),
      value: "value" in box ? String(box.value || "") : (box.textContent || ""),
    }));
  const articles = [...document.querySelectorAll("article")].slice(0, 20).map((article) => ({
    text: textOf(article).slice(0, 240),
    links: [...article.querySelectorAll("a")].slice(0, 12).map((anchor) => ({
      href: anchor.getAttribute("href") || "",
      text: textOf(anchor),
    })),
  }));
  const threadMessages = [...document.querySelectorAll("[data-message], [role='row'], [role='listitem']")]
    .slice(0, 30)
    .map((node) => textOf(node))
    .filter(Boolean);
  const bioNode = document.querySelector("[data-bio]");
  return {
    url: location.href,
    title: document.title,
    bodyText: (document.body && document.body.innerText || "").slice(0, 4000),
    links,
    buttons,
    images,
    textboxes,
    articles,
    hasPasswordField: Boolean(document.querySelector("input[type='password']")),
    threadMessages,
    bioText: (bioNode && bioNode.textContent || "").trim().slice(0, 500) || null,
    headerLines,
    headerButtons,
    metaDescription: meta ? (meta.getAttribute("content") || "").slice(0, 500) : null,
    profileIsPrivate: /this account is private/i.test(document.body && document.body.innerText || ""),
  };
}`;

export async function readDom(page: Page): Promise<DomSnapshot> {
  const read = new Function(`return (${READ_DOM_SOURCE})();`) as () => DomSnapshot;
  return page.evaluate(read);
}

export async function openUrl(page: Page, url: string) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
  } catch {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
    } catch {
      throw new NavigationError(`Could not open the page.`);
    }
  }
}
