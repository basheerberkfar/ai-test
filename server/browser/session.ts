import fs from "node:fs";
import path from "node:path";
import puppeteer, { type Browser, type BrowserContext, type CDPSession, type Page } from "puppeteer-core";
import { settings } from "../config.js";
import { pageSnapshotScript } from "./snapshot.js";

export type NetworkEntry = { method: string; url: string; path: string; status: number; requestBody?: string; responseBody?: string; ms: number };
export type ConsoleEntry = { level: string; text: string };

function findChrome(): string {
  if (settings.chromePath) return settings.chromePath;
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  const found = candidates.find((c) => fs.existsSync(c));
  if (!found) throw new Error("No Chrome/Chromium found. Set CHROME_PATH in .env.");
  return found;
}

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    if (b?.connected) return b;
  }
  browserPromise = puppeteer.launch({
    executablePath: findChrome(),
    headless: settings.headless,
    args: ["--no-first-run", "--no-default-browser-check", "--disable-extensions", "--window-size=1366,900"],
    defaultViewport: { width: 1366, height: 860 },
  });
  return browserPromise;
}

/** e.g. "Chrome/131.0.6778.85" — recorded with every run for reproducibility. */
export async function browserVersion() {
  return (await getBrowser()).version();
}

export async function closeBrowser() {
  const b = await browserPromise?.catch(() => null);
  browserPromise = null;
  await b?.close().catch(() => {});
}

/**
 * One isolated browser session (fresh incognito context: no cookies, no storage) driven via CDP.
 * Collects console errors and API traffic so the agent and the report can use them as evidence.
 */
export class BrowserSession {
  page!: Page;
  private context!: BrowserContext;
  private cdp!: CDPSession;
  private network: NetworkEntry[] = [];
  private consoleLog: ConsoleEntry[] = [];
  private netCursor = 0;
  private consoleCursor = 0;

  constructor(private allowedOrigins: string[], private apiPathPrefix: string) {}

  async open() {
    const browser = await getBrowser();
    this.context = await browser.createBrowserContext();
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(15_000);
    this.cdp = await this.page.createCDPSession();
    // tsx/esbuild may wrap functions with __name(); define it so serialized functions run in the page.
    await this.page.evaluateOnNewDocument("globalThis.__name = (f) => f;");

    const started = new Map<string, number>();
    this.page.on("request", (req) => started.set(req.url() + req.method(), Date.now()));
    this.page.on("response", async (res) => {
      const req = res.request();
      const url = new URL(res.url());
      if (!url.pathname.startsWith(this.apiPathPrefix)) return;
      let body = "";
      try {
        body = res.status() === 204 ? "" : (await res.text()).slice(0, 1500);
      } catch {}
      this.network.push({
        method: req.method(),
        url: res.url(),
        path: url.pathname + url.search,
        status: res.status(),
        requestBody: req.postData()?.slice(0, 1500),
        responseBody: body,
        ms: Date.now() - (started.get(req.url() + req.method()) ?? Date.now()),
      });
    });
    this.page.on("requestfailed", (req) => {
      const url = new URL(req.url());
      if (url.pathname.startsWith(this.apiPathPrefix))
        this.network.push({ method: req.method(), url: req.url(), path: url.pathname, status: 0, responseBody: `FAILED: ${req.failure()?.errorText}`, ms: 0 });
    });
    this.page.on("console", (msg) => {
      if (msg.type() === "error" || msg.type() === "warn") this.consoleLog.push({ level: msg.type(), text: msg.text().slice(0, 500) });
    });
    this.page.on("pageerror", (err) => this.consoleLog.push({ level: "pageerror", text: String((err as Error)?.message ?? err).slice(0, 500) }));
  }

  async close() {
    await this.context?.close().catch(() => {});
  }

  /** New network/console activity since the last call. */
  drainActivity() {
    const net = this.network.slice(this.netCursor);
    const con = this.consoleLog.slice(this.consoleCursor);
    this.netCursor = this.network.length;
    this.consoleCursor = this.consoleLog.length;
    return { network: net, console: con };
  }

  assertAllowed(url: string) {
    const origin = new URL(url).origin;
    if (!this.allowedOrigins.includes(origin)) throw new Error(`Navigation to ${origin} is not allowed (not an authorized test environment).`);
  }

  async settle(ms = 600) {
    await Promise.race([this.page.waitForNetworkIdle({ idleTime: 300, timeout: 4000 }).catch(() => {}), new Promise((r) => setTimeout(r, 4000))]);
    await new Promise((r) => setTimeout(r, ms));
    // If an action navigated away from the authorized environment, return.
    const current = this.page.url();
    if (current.startsWith("http") && !this.allowedOrigins.includes(new URL(current).origin)) {
      await this.page.goBack().catch(() => {});
      throw new Error("The action navigated outside the authorized environment; navigation was reverted.");
    }
  }

  async snapshot(maxChars = 9000) {
    return this.page.evaluate(pageSnapshotScript, maxChars);
  }

  private async el(ref: string) {
    const handle = await this.page.$(`[data-ai-ref="${ref.replace(/"/g, "")}"]`);
    if (!handle) throw new Error(`Element ${ref} not found. The page may have changed; take a new snapshot.`);
    return handle;
  }

  async navigate(target: string, baseUrl: string) {
    const url = new URL(target, baseUrl).toString();
    this.assertAllowed(url);
    await this.page.goto(url, { waitUntil: "domcontentloaded" });
    await this.settle();
  }

  async click(ref: string, times = 1, intervalMs = 60) {
    const h = await this.el(ref);
    await h.scrollIntoView().catch(() => {});
    for (let i = 0; i < times; i++) {
      await h.click({ delay: 20 }).catch(async (e) => {
        if (i === 0) throw e; // subsequent rapid clicks may hit a detached/disabled element; that is expected
      });
      if (i < times - 1) await new Promise((r) => setTimeout(r, intervalMs));
    }
    await this.settle();
  }

  /** Types into a field. Returns true when the field is a password input (callers must not log the value). */
  async type(ref: string, text: string, clear = true, pressEnter = false): Promise<boolean> {
    const h = await this.el(ref);
    const isPassword = await h.evaluate((el) => (el as HTMLInputElement).type === "password");
    await h.scrollIntoView().catch(() => {});
    await h.click({ count: clear ? 3 : 1 });
    if (clear) {
      await this.page.keyboard.down("Control");
      await this.page.keyboard.press("A");
      await this.page.keyboard.up("Control");
      await this.page.keyboard.press("Backspace");
    }
    const isDate = await h.evaluate((el) => (el as HTMLInputElement).type === "date");
    if (isDate) {
      // Native date inputs ignore typed ISO strings in some locales; set the value like a user picker would.
      await h.evaluate((el, v) => {
        const input = el as HTMLInputElement;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
        setter.call(input, v);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }, text);
    } else if (text.length > 400) {
      await this.page.keyboard.sendCharacter(text);
    } else {
      await h.type(text, { delay: 5 });
    }
    if (pressEnter) await this.page.keyboard.press("Enter");
    await this.settle(pressEnter ? 600 : 150);
    return isPassword;
  }

  async select(ref: string, option: string) {
    const h = await this.el(ref);
    const value = await h.evaluate((el, opt) => {
      const sel = el as HTMLSelectElement;
      const match = Array.from(sel.options).find((o) => o.value === opt || o.textContent?.trim().toLowerCase() === opt.trim().toLowerCase());
      return match?.value ?? null;
    }, option);
    if (value === null) throw new Error(`Option "${option}" not found in ${ref}.`);
    await h.select(value);
    await this.settle(300);
  }

  async pressKey(key: string) {
    await this.page.keyboard.press(key as any);
    await this.settle(300);
  }

  async reload() {
    await this.page.reload({ waitUntil: "domcontentloaded" });
    await this.settle();
  }

  async back() {
    await this.page.goBack({ waitUntil: "domcontentloaded" }).catch(() => {});
    await this.settle();
  }

  async setViewport(width: number, height: number) {
    await this.page.setViewport({ width: Math.max(320, Math.min(width, 2560)), height: Math.max(480, Math.min(height, 1600)) });
    await this.settle(300);
  }

  async setNetwork(mode: "online" | "offline" | "slow-3g") {
    const conditions =
      mode === "offline"
        ? { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 }
        : mode === "slow-3g"
          ? { offline: false, latency: 2000, downloadThroughput: 50_000, uploadThroughput: 50_000 }
          : { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 };
    await this.cdp.send("Network.emulateNetworkConditions", conditions);
  }

  /** Sends an API request from inside the page, reusing the current user's session token. */
  async apiRequest(method: string, apiPath: string, body: unknown, tokenKey: string) {
    // Normalize first so "/api/demo/../x" cannot escape the allowed prefix.
    const normalized = new URL(apiPath, "http://x").pathname;
    if (!normalized.startsWith(this.apiPathPrefix) || /^[a-z]+:/i.test(apiPath)) throw new Error(`Only paths under ${this.apiPathPrefix} may be requested.`);
    return this.page.evaluate(
      async (m, p, b, key) => {
        let token: string | null = null;
        try {
          const raw = localStorage.getItem(key);
          token = raw ? (JSON.parse(raw).token ?? raw) : null;
        } catch {
          token = localStorage.getItem(key);
        }
        const res = await fetch(p, {
          method: m,
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: b === undefined || b === null || m === "GET" ? undefined : JSON.stringify(b),
        });
        const text = await res.text();
        return { status: res.status, body: text.slice(0, 4000), authenticated: !!token };
      },
      method.toUpperCase(),
      apiPath,
      body as any,
      tokenKey,
    );
  }

  async screenshot(file: string, fullPage = false) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const buf = await this.page.screenshot({ type: "jpeg", quality: 65, fullPage });
    fs.writeFileSync(file, buf);
    return Buffer.from(buf).toString("base64");
  }
}
