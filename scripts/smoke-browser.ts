/**
 * Plumbing check for the browser layer WITHOUT any AI: drives the demo app through the same
 * BrowserSession the agent uses and prints what the agent would observe. Requires `npm run dev`.
 * Usage: npm run smoke
 */
import { BrowserSession, closeBrowser } from "../server/browser/session.js";
import { readEnvironments } from "../server/config.js";

const env = readEnvironments()[0];
const s = new BrowserSession(env.allowedOrigins, env.apiPathPrefix);
const refOf = (outline: string, pattern: RegExp) => {
  const line = outline.split("\n").find((l) => pattern.test(l));
  const ref = line?.match(/\[(e\d+)\]/)?.[1];
  if (!ref) throw new Error(`No element matching ${pattern} in:\n${outline}`);
  return ref;
};

try {
  await s.open();
  await s.navigate("/login", env.baseUrl);
  let snap = await s.snapshot();
  console.log("--- login page ---\n" + snap.outline);
  await s.type(refOf(snap.outline, /input\[type=email\]/), process.env.TEST_THERAPIST_EMAIL || "therapist@demo.clinic");
  await s.type(refOf(snap.outline, /input\[type=password\]/), process.env.TEST_THERAPIST_PASSWORD || "Therapist#2024", true, true);
  snap = await s.snapshot();
  console.log("--- after login ---\n" + snap.outline.slice(0, 1500));
  const activity = s.drainActivity();
  console.log("network:", activity.network.map((n) => `${n.method} ${n.path} ${n.status}`));
  console.log("console:", activity.console);

  const api = await s.apiRequest("GET", "/api/demo/patients?search=olivia", undefined, env.authTokenStorageKey);
  console.log("api_request:", api.status, api.body.slice(0, 120));
  const escape = await s.apiRequest("GET", "/api/demo/../lab/evaluation", undefined, env.authTokenStorageKey).catch((e) => e.message);
  console.log("path escape attempt:", escape);
  const nav = await s.navigate("http://localhost:5174/benchmark", env.baseUrl).catch((e) => e.message);
  console.log("off-origin navigation:", nav);

  await s.screenshot("artifacts/smoke/patients.jpg");

  // Create-patient form: fill every field and click Save twice in quick succession.
  await s.navigate("/patients/new", env.baseUrl);
  snap = await s.snapshot();
  console.log("--- create form ---\n" + snap.outline);
  const tag = `Smoke ${Date.now().toString(36)}`;
  await s.type(refOf(snap.outline, /"Full Name/), tag);
  await s.type(refOf(snap.outline, /"Email/), "smoke@example.com");
  await s.type(refOf(snap.outline, /"Date of Birth/), "1990-05-17");
  await s.select(refOf(snap.outline, /select "Gender/), "Female");
  await s.type(refOf(snap.outline, /"Notes/), "Prefers morning sessions");
  await s.screenshot("artifacts/smoke/form.jpg");
  s.drainActivity();
  await s.click(refOf(snap.outline, /button "Save patient"/), 2, 80);
  await new Promise((r) => setTimeout(r, 1500));
  snap = await s.snapshot();
  console.log("--- after save ---\n" + snap.outline.slice(0, 900));
  console.log("POSTs:", s.drainActivity().network.filter((n) => n.method === "POST").map((n) => `${n.status} ${n.responseBody?.slice(0, 80)}`));
  await s.screenshot("artifacts/smoke/detail.jpg");
  console.log("OK — screenshots in artifacts/smoke/");
} finally {
  await s.close();
  await closeBrowser();
}
