/**
 * Runs inside the page. Produces a compact, text-only outline of what a user can see and
 * interact with. Interactive elements get a `data-ai-ref` attribute so the agent can
 * address them in follow-up actions (refs are regenerated on every snapshot).
 */
export function pageSnapshotScript(maxChars: number) {
  const out: string[] = [];
  let n = 0;
  document.querySelectorAll("[data-ai-ref]").forEach((el) => el.removeAttribute("data-ai-ref"));

  const visible = (el: Element) => {
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const clean = (t: string | null | undefined, max = 120) => {
    const v = (t ?? "").replace(/\s+/g, " ").trim();
    return v.length > max ? v.slice(0, max) + "…" : v;
  };
  const labelFor = (el: HTMLElement) => {
    const aria = el.getAttribute("aria-label");
    if (aria) return aria;
    const labelledby = el.getAttribute("aria-labelledby");
    if (labelledby) return labelledby.split(" ").map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
    if ("labels" in el && (el as HTMLInputElement).labels?.length) return (el as HTMLInputElement).labels![0].textContent ?? "";
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") return (el as HTMLInputElement).placeholder || el.getAttribute("name") || "";
    return el.textContent || el.getAttribute("title") || "";
  };
  const isInteractive = (el: HTMLElement) => {
    const tag = el.tagName;
    if (["BUTTON", "SELECT", "TEXTAREA"].includes(tag)) return true;
    if (tag === "INPUT") return (el as HTMLInputElement).type !== "hidden";
    if (tag === "A" && el.hasAttribute("href")) return true;
    const role = el.getAttribute("role");
    return !!role && ["button", "link", "tab", "menuitem", "checkbox", "radio", "switch", "option", "combobox"].includes(role);
  };

  const describe = (el: HTMLElement) => {
    const ref = `e${++n}`;
    el.setAttribute("data-ai-ref", ref);
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute("role") || (tag === "a" ? "link" : tag === "select" ? "select" : tag === "textarea" ? "textarea" : tag === "input" ? `input[type=${(el as HTMLInputElement).type}]` : tag);
    const bits = [`[${ref}] ${role} "${clean(labelFor(el), 80)}"`];
    if (tag === "input" || tag === "textarea") {
      const v = (el as HTMLInputElement).value;
      const type = (el as HTMLInputElement).type;
      if (type === "checkbox" || type === "radio") bits.push((el as HTMLInputElement).checked ? "checked" : "unchecked");
      else bits.push(`value="${clean(v, 200)}"`);
    }
    if (tag === "select") {
      const sel = el as HTMLSelectElement;
      bits.push(`selected="${clean(sel.selectedOptions[0]?.textContent)}"`);
      bits.push(`options=[${Array.from(sel.options).map((o) => clean(o.textContent, 40)).join(" | ")}]`);
    }
    if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") bits.push("disabled");
    if ((el as HTMLInputElement).required || el.getAttribute("aria-required") === "true") bits.push("required");
    if (el.getAttribute("aria-invalid") === "true") bits.push("invalid");
    if (el.getAttribute("aria-selected") === "true" || el.getAttribute("aria-current")) bits.push("current");
    const href = el.getAttribute("href");
    if (href && tag === "a") bits.push(`href=${href}`);
    return bits.join(" ");
  };

  const walk = (node: Element, depth: number) => {
    if (out.join("\n").length > maxChars) return;
    if (!(node instanceof HTMLElement) || !visible(node)) return;
    if (["SCRIPT", "STYLE", "NOSCRIPT", "SVG"].includes(node.tagName) || node.tagName.toLowerCase() === "svg") return;
    const indent = "  ".repeat(Math.min(depth, 6));
    const role = node.getAttribute("role");

    if (role === "dialog" || role === "alertdialog") out.push(`${indent}<dialog "${clean(labelFor(node), 60)}">`);
    if (role === "alert" || role === "status" || node.hasAttribute("data-sonner-toast")) {
      const t = clean(node.textContent, 300);
      if (t) out.push(`${indent}(${role ?? "toast"}) ${t}`);
      if (role !== "dialog") return;
    }
    if (/^H[1-6]$/.test(node.tagName)) {
      out.push(`${indent}${"#".repeat(Number(node.tagName[1]))} ${clean(node.textContent)}`);
      return;
    }
    if (node.tagName === "TABLE") {
      const rows = Array.from(node.querySelectorAll("tr")).filter(visible);
      out.push(`${indent}table (${rows.length} rows):`);
      rows.slice(0, 30).forEach((tr) => {
        const cells = Array.from(tr.children).map((c) => {
          const inter = Array.from(c.querySelectorAll<HTMLElement>("a,button,input,select,[role=button]")).filter(visible);
          const txt = clean(c.textContent, 60);
          return inter.length ? `${txt} ${inter.map(describe).join(" ")}` : txt;
        });
        out.push(`${indent}  | ${cells.join(" | ")} |`);
      });
      if (rows.length > 30) out.push(`${indent}  … ${rows.length - 30} more rows`);
      return;
    }
    if (isInteractive(node)) {
      out.push(indent + describe(node));
      return;
    }
    // Leaf-ish text blocks.
    const ownText = Array.from(node.childNodes)
      .filter((c) => c.nodeType === Node.TEXT_NODE)
      .map((c) => c.textContent)
      .join(" ");
    const t = clean(ownText, 200);
    if (t) out.push(`${indent}${node.tagName === "LABEL" ? "label: " : ""}${t}`);
    for (const child of Array.from(node.children)) walk(child, depth + (t ? 1 : 0));
  };

  walk(document.body, 0);
  let text = out.join("\n");
  if (text.length > maxChars) text = text.slice(0, maxChars) + "\n… (truncated)";
  return { url: location.href, title: document.title, outline: text, viewport: `${innerWidth}x${innerHeight}` };
}
