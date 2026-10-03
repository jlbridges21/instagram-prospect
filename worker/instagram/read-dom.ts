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
  const boxOf = (el) => {
    if (!el || !el.getBoundingClientRect) return null;
    const rect = el.getBoundingClientRect();
    if (!rect || rect.width < 1 || rect.height < 1) return null;
    return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
  };
  const exactLabel = (value) => {
    const text = undouble(value || "");
    if (/^follow$/i.test(text)) return "Follow";
    if (/^follow back$/i.test(text)) return "Follow Back";
    if (/^following$/i.test(text)) return "Following";
    if (/^requested$/i.test(text)) return "Requested";
    return "";
  };
  const clickable = (node) => {
    if (!node || !node.tagName) return false;
    const tag = node.tagName.toLowerCase();
    const role = (node.getAttribute("role") || "").toLowerCase();
    const tab = node.getAttribute("tabindex");
    if (tag === "button" || role === "button" || tag === "a") return true;
    return tab !== null && tab !== "" && Number(tab) >= 0 && (role === "button" || role === "link");
  };
  const ancestorOf = (el) => {
    let node = el;
    for (let depth = 0; node && depth < 6; depth += 1) {
      if (clickable(node)) {
        return {
          tag: node.tagName.toLowerCase(),
          role: (node.getAttribute("role") || "").toLowerCase(),
          text: undouble(node.innerText || node.textContent || "").slice(0, 80),
          ariaLabel: undouble(node.getAttribute("aria-label") || "").slice(0, 80),
          href: node.getAttribute("href") || "",
          box: boxOf(node),
        };
      }
      node = node.parentElement;
    }
    return null;
  };
  const inSuggested = (el) => {
    let node = el.parentElement;
    while (node) {
      if (/suggested/i.test(node.getAttribute("aria-label") || "")) return true;
      for (const child of node.children || []) {
        if (/^H[1-4]$/.test(child.tagName) && /suggested/i.test(norm(child.textContent || ""))) return true;
      }
      node = node.parentElement;
    }
    return false;
  };
  const otherProfile = (el) => {
    let node = el.parentElement;
    for (let depth = 0; node && depth < 8; depth += 1) {
      if (node.tagName === "A") {
        const match = (node.getAttribute("href") || "").match(/^\\/([A-Za-z0-9._]{1,30})\\/?$/);
        if (match && match[1].toLowerCase() !== pathUser) return match[1].toLowerCase();
      }
      node = node.parentElement;
    }
    return null;
  };
  const exactRelationshipHits = [];
  for (const el of document.querySelectorAll("button, [role='button'], a, div, span")) {
    const text = directText(el);
    const aria = undouble(el.getAttribute("aria-label") || "");
    const titleAttr = undouble(el.getAttribute("title") || "");
    const label = exactLabel(text) || exactLabel(aria) || exactLabel(titleAttr);
    if (!label) continue;
    const nested = [...el.querySelectorAll("span, div, a, button")].some((child) => exactLabel(directText(child)) === label || exactLabel(child.getAttribute("aria-label") || "") === label);
    if (nested) continue;
    const box = boxOf(el);
    if (!box) continue;
    exactRelationshipHits.push({
      label,
      tag: el.tagName.toLowerCase(),
      role: (el.getAttribute("role") || "").toLowerCase(),
      text: text.slice(0, 80),
      ariaLabel: aria.slice(0, 80),
      title: titleAttr.slice(0, 80),
      href: el.getAttribute("href") || "",
      tabIndex: el.getAttribute("tabindex") || "",
      box,
      inSuggestion: inSuggested(el),
      inDialog: inDialog(el),
      otherUsername: otherProfile(el),
      ancestor: ancestorOf(el),
    });
    if (exactRelationshipHits.length >= 30) break;
  }
  const exactMessage = (value) => {
    const text = undouble(value || "");
    if (/^message\\.\\.\\.$/i.test(text)) return "Message...";
    if (/^message$/i.test(text)) return "Message";
    return "";
  };
  const inNavigation = (el) => Boolean(el && el.closest && el.closest("nav, [role='navigation']"));
  const messageActionHits = [];
  for (const el of document.querySelectorAll("button, [role='button'], a, div, span")) {
    const text = directText(el);
    const aria = undouble(el.getAttribute("aria-label") || "");
    const label = exactMessage(text) || exactMessage(aria);
    if (!label) continue;
    const nested = [...el.querySelectorAll("span, div, a, button")].some((child) => exactMessage(directText(child)) === label || exactMessage(child.getAttribute("aria-label") || "") === label);
    if (nested) continue;
    const box = boxOf(el);
    if (!box) continue;
    const ancestor = ancestorOf(el);
    messageActionHits.push({
      label,
      tag: el.tagName.toLowerCase(),
      role: (el.getAttribute("role") || "").toLowerCase(),
      text: text.slice(0, 80),
      ariaLabel: aria.slice(0, 80),
      inSuggestion: inSuggested(el),
      inNavigation: inNavigation(el),
      inDialog: inDialog(el),
      box,
      ancestor: ancestor ? { tag: ancestor.tag, role: ancestor.role, box: ancestor.box } : null,
    });
    if (messageActionHits.length >= 30) break;
  }
  const composerCandidates = [...document.querySelectorAll("textarea, [role='textbox'], [contenteditable='true']")].slice(0, 15).map((box) => {
    const rect = box.getBoundingClientRect();
    const dialog = box.closest("[role='dialog']");
    const inDirect = /\\/direct\\//.test(location.pathname);
    return {
      tag: box.tagName.toLowerCase(),
      role: (box.getAttribute("role") || "").toLowerCase(),
      ariaLabel: undouble(box.getAttribute("aria-label") || "").slice(0, 80),
      placeholder: undouble(box.getAttribute("placeholder") || "").slice(0, 80),
      contentEditable: box.getAttribute("contenteditable") === "true",
      value: ("value" in box ? String(box.value || "") : (box.innerText || box.textContent || "")).trim().slice(0, 2000),
      box: rect && rect.width >= 1 ? { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) } : null,
      inConversation: Boolean(dialog) || inDirect || Boolean(box.closest("footer, form")),
    };
  });
  const dialog = document.querySelector("[role='dialog']");
  const directMain = /\\/direct\\//.test(location.pathname) ? document.querySelector("main") : null;
  const headerRoot = dialog || directMain;
  const headingNode = headerRoot ? headerRoot.querySelector("h1, h2, [role='heading']") : null;
  const conversationHeader = headingNode ? undouble(headingNode.textContent || "").slice(0, 80) : "";
  const suggestedProfiles = suggestedProfileCards();
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
    exactRelationshipHits,
    messageActionHits,
    composerCandidates,
    conversationHeader,
    usernameBox: boxOf(heading),
    optionsBox: boxOf(options),
    metaDescription: meta ? (meta.getAttribute("content") || "").slice(0, 500) : null,
    profileIsPrivate: /this account is private/i.test(document.body && document.body.innerText || ""),
    profileImageUrl: profileAvatarUrl(),
    suggestedProfiles,
  };
  function suggestedProfileCards() {
    const found = [];
    const seen = {};
    const markers = [...document.querySelectorAll("body *")].filter((el) => {
      if (el.closest("nav, [role='navigation']")) return false;
      if (el.children && el.children.length > 6) return false;
      const text = (el.textContent || "").replace(/\\s+/g, " ").trim();
      return text === "Suggested for you" || text === "Suggested accounts";
    }).slice(0, 8);
    for (const marker of markers) {
      let scope = marker.parentElement;
      for (let depth = 0; depth < 6 && scope; depth += 1) {
        const links = [...scope.querySelectorAll("a[href]")];
        let added = 0;
        for (const link of links) {
          if (link.closest("nav, [role='navigation']")) continue;
          const username = usernameFromSuggestedHref(link.getAttribute("href") || "");
          if (!username || seen[username]) continue;
          seen[username] = true;
          found.push({ username, href: link.getAttribute("href") || "" });
          added += 1;
          if (found.length >= 20) return found;
        }
        if (added > 0) break;
        scope = scope.parentElement;
      }
    }
    return found;
  }
  function usernameFromSuggestedHref(href) {
    try {
      const path = new URL(href, location.origin).pathname;
      const part = (path.split("/").filter(Boolean)[0] || "").toLowerCase();
      if (!part || /^(explore|reels|p|reel|stories|direct|accounts|about|legal)$/.test(part)) return "";
      if (!/^[a-z0-9._]{1,30}$/.test(part)) return "";
      return part;
    } catch (error) {
      return "";
    }
  }
  function profileAvatarUrl() {
    const images = [...document.querySelectorAll("img")].filter((image) => {
      if (image.closest("nav, [role='navigation']")) return false;
      const alt = (image.alt || "").toLowerCase();
      if (!alt.includes("profile picture")) return false;
      if (alt.includes("your profile picture")) return false;
      const box = image.getBoundingClientRect();
      return box.width >= 24 && box.width <= 240;
    });
    const named = pathUser ? images.find((image) => (image.alt || "").toLowerCase().includes(pathUser)) : null;
    const near = heading ? images.find((image) => Math.abs(image.getBoundingClientRect().y - heading.getBoundingClientRect().y) < 240) : null;
    const chosen = named || near;
    if (!chosen) return null;
    return (chosen.currentSrc || chosen.src || "").slice(0, 1000) || null;
  }
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
