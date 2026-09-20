import type { Page } from "playwright";

import { type SemanticSnapshot, semanticSnapshotSchema } from "../domain/schema.js";

export interface SemanticCollectorOptions {
  readonly maxElements: number;
  readonly maxTextLength: number;
}

/**
 * Compact semantic representation of the rendered page.
 *
 * Raw HTML is deliberately not captured: the snapshot keeps role, accessible
 * name, text, a stable selector, geometry and the computed values the visual
 * rules need, and nothing else.
 */
export async function collectSemanticSnapshot(
  page: Page,
  options: SemanticCollectorOptions,
): Promise<SemanticSnapshot> {
  const raw = await page.evaluate(
    (opts) => {
      const SKIP_TAGS = new Set([
        "SCRIPT",
        "STYLE",
        "HEAD",
        "META",
        "LINK",
        "TITLE",
        "NOSCRIPT",
        "TEMPLATE",
        "BR",
        "WBR",
        "COL",
        "COLGROUP",
        "SOURCE",
        "TRACK",
        "PARAM",
        "BASE",
      ]);
      const INTERACTIVE_TAGS = new Set([
        "A",
        "BUTTON",
        "INPUT",
        "SELECT",
        "TEXTAREA",
        "SUMMARY",
        "DETAILS",
      ]);
      const INTERACTIVE_ROLES = new Set([
        "button",
        "link",
        "checkbox",
        "radio",
        "switch",
        "tab",
        "menuitem",
        "option",
        "textbox",
        "combobox",
        "searchbox",
        "slider",
        "spinbutton",
      ]);
      const ROLE_BY_TAG: Record<string, string> = {
        A: "link",
        BUTTON: "button",
        IMG: "img",
        INPUT: "textbox",
        SELECT: "combobox",
        TEXTAREA: "textbox",
        H1: "heading",
        H2: "heading",
        H3: "heading",
        H4: "heading",
        H5: "heading",
        H6: "heading",
        NAV: "navigation",
        MAIN: "main",
        HEADER: "banner",
        FOOTER: "contentinfo",
        ASIDE: "complementary",
        SECTION: "region",
        ARTICLE: "article",
        FORM: "form",
        DIALOG: "dialog",
        UL: "list",
        OL: "list",
        LI: "listitem",
        TABLE: "table",
        TR: "row",
        TD: "cell",
        TH: "columnheader",
        P: "paragraph",
        SUMMARY: "button",
        LABEL: "label",
        FIGURE: "figure",
        FIELDSET: "group",
        PROGRESS: "progressbar",
        OUTPUT: "status",
      };
      const INPUT_ROLE_BY_TYPE: Record<string, string> = {
        button: "button",
        submit: "button",
        reset: "button",
        image: "button",
        checkbox: "checkbox",
        radio: "radio",
        range: "slider",
        number: "spinbutton",
        search: "searchbox",
        email: "textbox",
        tel: "textbox",
        url: "textbox",
        password: "textbox",
        file: "button",
        color: "button",
        date: "textbox",
        time: "textbox",
        "datetime-local": "textbox",
        month: "textbox",
        week: "textbox",
      };

      const round1 = (value: number): number => Math.round(value * 10) / 10;
      const normalize = (value: string, max: number): string => {
        const collapsed = value.replace(/\s+/g, " ").trim();
        return collapsed.length > max ? `${collapsed.slice(0, Math.max(max - 1, 0))}…` : collapsed;
      };

      const selectorFor = (element: Element): string => {
        const id = element.getAttribute("id");
        if (id !== null && id !== "" && /^[A-Za-z][\w:-]*$/.test(id)) {
          try {
            if (document.querySelectorAll(`#${CSS.escape(id)}`).length === 1) {
              return `#${id}`;
            }
          } catch {
            /* fall through to a structural selector */
          }
        }
        const testId = element.getAttribute("data-testid");
        if (testId !== null && testId !== "") {
          return `${element.tagName.toLowerCase()}[data-testid="${testId}"]`;
        }
        const parts: string[] = [];
        let current: Element | null = element;
        let depth = 0;
        while (current !== null && current !== document.documentElement && depth < 6) {
          const tag = current.tagName.toLowerCase();
          const parent: Element | null = current.parentElement;
          if (parent === null) {
            parts.unshift(tag);
          } else {
            const sameTag = Array.from(parent.children).filter(
              (child) => child.tagName === current?.tagName,
            );
            parts.unshift(
              sameTag.length > 1 ? `${tag}:nth-of-type(${sameTag.indexOf(current) + 1})` : tag,
            );
          }
          current = current.parentElement;
          depth += 1;
        }
        return parts.join(" > ");
      };

      const roleFor = (element: Element): string => {
        const explicit = element.getAttribute("role");
        if (explicit !== null && explicit.trim() !== "") {
          return explicit.trim();
        }
        if (element instanceof HTMLInputElement) {
          return INPUT_ROLE_BY_TYPE[element.type] ?? "textbox";
        }
        if (element instanceof HTMLAnchorElement) {
          return element.hasAttribute("href") ? "link" : "generic";
        }
        return ROLE_BY_TAG[element.tagName] ?? "generic";
      };

      const accessibleNameFor = (element: Element): string => {
        const aria = element.getAttribute("aria-label");
        if (aria !== null && aria.trim() !== "") {
          return normalize(aria, opts.maxTextLength);
        }
        const labelledBy = element.getAttribute("aria-labelledby");
        if (labelledBy !== null && labelledBy.trim() !== "") {
          const text = labelledBy
            .split(/\s+/)
            .map((token) => document.getElementById(token)?.textContent ?? "")
            .join(" ")
            .trim();
          if (text !== "") {
            return normalize(text, opts.maxTextLength);
          }
        }
        if (element instanceof HTMLImageElement && element.alt !== "") {
          return normalize(element.alt, opts.maxTextLength);
        }
        if (
          element instanceof HTMLInputElement ||
          element instanceof HTMLSelectElement ||
          element instanceof HTMLTextAreaElement
        ) {
          const labels = element.labels;
          if (labels !== null && labels.length > 0) {
            const text = Array.from(labels)
              .map((label) => label.textContent ?? "")
              .join(" ")
              .trim();
            if (text !== "") {
              return normalize(text, opts.maxTextLength);
            }
          }
          const placeholder = element.getAttribute("placeholder");
          if (placeholder !== null && placeholder.trim() !== "") {
            return normalize(placeholder, opts.maxTextLength);
          }
          const title = element.getAttribute("title");
          if (title !== null && title.trim() !== "") {
            return normalize(title, opts.maxTextLength);
          }
          if (
            element instanceof HTMLInputElement &&
            (element.type === "submit" || element.type === "button")
          ) {
            return normalize(element.value, opts.maxTextLength);
          }
          return "";
        }
        const title = element.getAttribute("title");
        if (title !== null && title.trim() !== "") {
          return normalize(title, opts.maxTextLength);
        }
        return normalize(element.textContent ?? "", opts.maxTextLength);
      };

      const ownTextFor = (element: Element): string => {
        let text = "";
        for (const node of Array.from(element.childNodes)) {
          if (node.nodeType === Node.TEXT_NODE) {
            text += node.nodeValue ?? "";
          }
        }
        let result = normalize(text, opts.maxTextLength);
        if (result === "" && element.children.length === 0) {
          result = normalize(element.textContent ?? "", opts.maxTextLength);
        }
        return result;
      };

      const headingPattern = /^H[1-6]$/;
      const records: Record<string, unknown>[] = [];
      let interactiveCount = 0;
      let imageCount = 0;
      let headingCount = 0;
      let textCount = 0;

      const all = document.querySelectorAll("*");
      for (const element of Array.from(all)) {
        if (SKIP_TAGS.has(element.tagName)) {
          continue;
        }
        if (
          element.namespaceURI === "http://www.w3.org/2000/svg" &&
          element.tagName.toLowerCase() !== "svg"
        ) {
          continue;
        }
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const role = roleFor(element);
        const name = accessibleNameFor(element);
        const text = ownTextFor(element);
        const interactive =
          INTERACTIVE_TAGS.has(element.tagName) ||
          INTERACTIVE_ROLES.has(role) ||
          element.getAttribute("tabindex") !== null;
        const visible =
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number.parseFloat(style.opacity) > 0.05;
        const clippedX =
          element.scrollWidth > element.clientWidth + 1 && /hidden|clip/.test(style.overflowX);
        const clippedY =
          element.scrollHeight > element.clientHeight + 1 && /hidden|clip/.test(style.overflowY);

        if (interactive) {
          interactiveCount += 1;
        }
        if (element.tagName === "IMG") {
          imageCount += 1;
        }
        if (headingPattern.test(element.tagName)) {
          headingCount += 1;
        }
        if (text !== "") {
          textCount += 1;
        }

        const fontSize = Number.parseFloat(style.fontSize);
        const rawLineHeight = Number.parseFloat(style.lineHeight);
        const rawLetterSpacing = Number.parseFloat(style.letterSpacing);
        const naturalSize =
          element instanceof HTMLImageElement
            ? { width: element.naturalWidth, height: element.naturalHeight }
            : undefined;

        let domDepth = 0;
        let ancestor: Element | null = element.parentElement;
        while (ancestor !== null && domDepth < 64) {
          domDepth += 1;
          ancestor = ancestor.parentElement;
        }

        const record: Record<string, unknown> = {
          depth: domDepth,
          tag: element.tagName.toLowerCase(),
          role,
          name,
          text,
          selector: selectorFor(element),
          bbox: {
            x: round1(rect.left + window.scrollX),
            y: round1(rect.top + window.scrollY),
            width: round1(rect.width),
            height: round1(rect.height),
          },
          styles: {
            fontFamily: normalize(style.fontFamily, 120),
            fontSize: Number.isFinite(fontSize) ? round1(fontSize) : 0,
            fontWeight: Number.parseInt(style.fontWeight, 10) || 400,
            lineHeight: Number.isFinite(rawLineHeight)
              ? round1(rawLineHeight)
              : round1((Number.isFinite(fontSize) ? fontSize : 16) * 1.2),
            letterSpacing: Number.isFinite(rawLetterSpacing) ? round1(rawLetterSpacing) : 0,
            color: style.color,
            backgroundColor: style.backgroundColor,
            textAlign: style.textAlign,
            position: style.position,
            display: style.display,
            overflowX: style.overflowX,
            overflowY: style.overflowY,
            opacity: Number.isFinite(Number.parseFloat(style.opacity))
              ? round1(Number.parseFloat(style.opacity))
              : 1,
            visibility: style.visibility,
            zIndex: style.zIndex,
          },
          interactive,
          visible,
          hasAccessibleName: name !== "",
          clipped: clippedX || clippedY,
          overflows:
            element.scrollWidth > element.clientWidth + 1 ||
            element.scrollHeight > element.clientHeight + 1,
        };
        if (naturalSize !== undefined) {
          record.naturalSize = naturalSize;
        }
        records.push(record);
      }

      const documentElement = document.documentElement;
      const clientWidth = documentElement.clientWidth || window.innerWidth;
      const clientHeight = documentElement.clientHeight || window.innerHeight;
      const scrollWidth = Math.max(documentElement.scrollWidth, document.body?.scrollWidth ?? 0);

      const interesting = records.filter((record) => {
        const visible = record.visible === true;
        if (!visible) {
          return false;
        }
        const text = record.text as string;
        return (
          text !== "" ||
          record.interactive === true ||
          record.tag === "img" ||
          headingPattern.test((record.tag as string).toUpperCase())
        );
      });
      const kept = interesting
        .slice(0, opts.maxElements)
        .map((record, index) => ({ ...record, index }));
      const truncated = interesting.length > kept.length;

      return {
        capturedAt: new Date().toISOString(),
        document: {
          title: normalize(document.title, 200),
          lang: documentElement.lang ?? "",
          url: location.href,
          scrollWidth,
          scrollHeight: documentElement.scrollHeight,
          clientWidth,
          clientHeight,
          hasHorizontalOverflow: scrollWidth > clientWidth + 1,
          hasVerticalOverflow: documentElement.scrollHeight > clientHeight + 1,
        },
        counts: {
          elements: records.length,
          interactive: interactiveCount,
          images: imageCount,
          headings: headingCount,
          text: textCount,
        },
        nodes: kept,
        truncated,
      };
    },
    { maxElements: options.maxElements, maxTextLength: options.maxTextLength },
  );

  return semanticSnapshotSchema.parse(raw);
}
