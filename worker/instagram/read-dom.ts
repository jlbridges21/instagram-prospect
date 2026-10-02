import type { Page } from "playwright";
import { NavigationError } from "./errors";
import type { DomSnapshot } from "./types";

const NAVIGATION_TIMEOUT_MS = 25_000;

export const READ_DOM_SOURCE = `() => {
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
  const norm = (value) => String(value || "").replace(/\\s+/g, " ").trim();
  const undouble = (value) => {
    const text = norm(value);
    const half = Math.floor(text.length / 2);
    if (half > 2 && text.slice(0, half).toLowerCase() === text.slice(half).toLowerCase()) return text.slice(0, half);
    return text;
  };
  const labelledBy = (el) => {
    const ids = el.getAttribute("aria-labelledby");
    if (!ids) return "";
    return undouble(ids.split(/\\s+/).map((id) => {
      const node = document.getElementById(id);
      return node ? node.textContent || "" : "";
    }).join(" "));
  };
  const directText = (el) => {
    let text = "";
    for (const node of el.childNodes) {
      if (node.nodeType === 3) text += node.textContent || "";
    }
    return undouble(text);
  };
  const namesOf = (el) => [el.getAttribute("aria-label"), labelledBy(el), el.getAttribute("title"), directText(el), el.innerText || ""]
    .map((value) => undouble(value || ""))
    .filter((value) => value && value.length <= 80);
  const interesting = (el) => namesOf(el).some((name) => {
    if (/^followed by\\b/i.test(name)) return true;
    if (/\\d/.test(name) && /follower|following/i.test(name) && name.length <= 40) return true;
    return /^(follow|follow back|following|unfollow|requested|message|messages|options|more)$/i.test(name);
  });
  const inDialog = (el) => Boolean(el.closest("[role='dialog'], [aria-modal='true']"));
  const inSuggestion = (el) => {
    const box = el.closest("section, aside, [role='complementary']");
    if (!box) return false;
    const heading = box.querySelector("h1, h2, h3, h4, [role='heading']");
    const label = norm((box.getAttribute("aria-label") || "") + " " + (heading ? heading.textContent || "" : ""));
    return /suggested for you|suggestions for you/i.test(label);
  };
  const pathUser = ((location.pathname.match(/^\\/([A-Za-z0-9._]{1,30})\\/?$/) || [])[1] || "").toLowerCase();
  const heading = pathUser
    ? [...document.querySelectorAll("h1, h2, h3, [role='heading']")].find((node) => undouble(node.innerText || node.textContent || "").toLowerCase() === pathUser) || null
    : null;
  const options = [...document.querySelectorAll("button, [role='button'], a, [tabindex]")].find((node) => namesOf(node).some((name) => /^options$/i.test(name))) || null;
  const ancestorSet = (node) => {
    const seen = new Set();
    let current = node;
    while (current) {
      seen.add(current);
      current = current.parentElement;
    }
    return seen;
  };
  let region = null;
  if (heading && options) {
    const seen = ancestorSet(heading);
    let current = options;
    while (current) {
      if (seen.has(current)) {
        region = current;
        break;
      }
      current = current.parentElement;
    }
  }
  if (!region) region = (heading && heading.parentElement) || header || document.querySelector("main");
  const exactAction = (name) => /^(follow|follow back|following|requested)$/i.test(name);
  const hasRelationship = (root) => [...root.querySelectorAll("button, [role='button'], a")].some((el) => {
    if (inDialog(el) || inSuggestion(el)) return false;
    const tag = el.tagName;
    const role = (el.getAttribute("role") || "").toLowerCase();
    const href = (el.getAttribute("href") || "").split("?")[0];
    const button = tag === "BUTTON" || role === "button";
    const actionAnchor = tag === "A" && !/\\/(followers|following|posts)\\/?$/i.test(href);
    if (!button && !actionAnchor) return false;
    return namesOf(el).some(exactAction);
  });
  let hops = 0;
  while (region && region.parentElement && region.parentElement !== document.body && hops < 5 && !hasRelationship(region)) {
    if (inSuggestion(region.parentElement)) break;
    region = region.parentElement;
    hops += 1;
  }
  const toCandidate = (el, scope) => {
    const tag = el.tagName.toLowerCase();
    const role = (el.getAttribute("role") || "").toLowerCase();
    const href = el.getAttribute("href") || "";
    const statsLink = tag === "a" && /\\/(followers|following|posts)\\/?$/i.test(href.split("?")[0]);
    return {
      tag,
      role,
      text: (directText(el) || undouble(el.innerText || "")).slice(0, 80),
      ariaLabel: undouble(el.getAttribute("aria-label") || labelledBy(el)).slice(0, 80),
      title: undouble(el.getAttribute("title") || "").slice(0, 80),
      href,
      tabIndex: el.getAttribute("tabindex") || "",
      scope,
      isInteractive: tag === "button" || role === "button" || (tag === "a" && !statsLink),
      besideOptions: Boolean(options && options.parentElement && options.parentElement.contains(el)),
    };
  };
  const collect = (root, scope, skipInside) => {
    if (!root) return [];
    const picked = [];
    const nodes = [...root.querySelectorAll("button, [role='button'], a, [tabindex], div, span")];
    for (const el of nodes) {
      if (skipInside && skipInside.contains(el)) continue;
      if (inDialog(el) || inSuggestion(el)) continue;
      if (!interesting(el)) continue;
      const tag = el.tagName;
      const role = (el.getAttribute("role") || "").toLowerCase();
      const interactive = tag === "BUTTON" || role === "button" || tag === "A";
      if (!interactive) {
        const wrapsAction = [...el.querySelectorAll("button, [role='button']")].length > 0;
        if (wrapsAction) continue;
      }
      picked.push(toCandidate(el, scope));
      if (picked.length >= 25) break;
    }
    return picked;
  };
  const relationshipCandidates = [...collect(region, "primary", null), ...collect(document.body, "outside", region)].slice(0, 40);
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
    relationshipCandidates,
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
