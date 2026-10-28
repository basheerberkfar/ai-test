# AI-Native E2E Testing — Proof of Concept

**Hypothesis under test:** *Can AI agents execute and maintain reliable E2E regression coverage directly from user stories and natural-language scenarios, without manually written Playwright test scripts?*

This repository contains everything needed to test that hypothesis and to measure how well it holds up:

| Part | What it is |
|---|---|
| **Demo app** (`apps/demo-app`, :5173) | A small patient-management app (login, patients table, search, status filter, pagination, create/view/edit/delete). It is the system under test and contains **5 switchable, realistic bugs**. |
| **AI Testing Workspace** (`apps/testing-workspace`, :5174) | Manage stories, launch AI runs, watch the agent work live, review discovered scenarios and evaluate results. |
| **Browser agent** (`server/agents`, `server/browser`) | An LLM agent that drives real Chrome via the Chrome DevTools Protocol (puppeteer-core). No Playwright, no test scripts. |
| **Regression memory** (`regression/scenarios.json`) | AI-proposed, human-approved scenarios that every future run must execute. |
| **Evaluator** (`server/evaluation`, `evaluation/hidden-bugs.json`) | Compares findings to the private bug list after each run and computes the benchmark metrics. |

Nothing in the workspace is simulated: every number comes from a recorded browser execution. If no AI key is configured, no runs can start and every count stays at zero.

---

## 1. Setup

Requirements: **Node.js ≥ 22.13** (uses the built-in `node:sqlite`) and **Google Chrome, Chromium or Edge** installed locally.

```bash
npm install
cp .env.example .env        # then edit .env
npm run dev                 # API :4000, demo app :5173, workspace :5174
```

Minimum `.env`:

```ini
AI_PROVIDER=anthropic           # or openai
ANTHROPIC_API_KEY=sk-ant-...    # or OPENAI_API_KEY=...
```

Open the workspace at **http://localhost:5174** and the demo app at **http://localhost:5173**.

### Configuration reference (`.env`)

| Variable | Default | Purpose |
|---|---|---|
| `AI_PROVIDER` | `anthropic` | `anthropic` or `openai` (provider abstraction in `server/agents/providers`). |
| `AI_MODEL` | — | Forces one model for every role (disables routing). `AI_MODEL_ECONOMY` / `AI_MODEL_ADVANCED` override one tier. |
| `AI_EFFORT` | `medium` | Anthropic reasoning effort (`low`…`max`). Higher = more thorough, more cost. |
| `ANTHROPIC_FALLBACKS` | `default` | Server-side refusal fallback (beta). Set `off` to disable; it also disables itself automatically if rejected. |
| `AI_MAX_COST_USD` | — | Hard cost cap per run that overrides any mode budget (CI sets it to the job budget). |
| `AI_TEST_DATA_DIR`, `AI_TEST_OUTPUT_DIR` | `./data`, project root | Isolated databases / reports+artifacts (used by CI). |
| `CHROME_PATH` | auto-detect | Browser executable. |
| `BROWSER_HEADLESS` | `true` | `false` shows the browser window while the agent works. |
| `TEST_THERAPIST_*`, `TEST_ADMIN_*` | seeded demo accounts | Credentials handed to the agent through its `get_test_account` tool. Not real secrets. |

Pricing, model routing, execution modes, limits, the CI policy and the traditional-baseline assumptions live in **`config/ai-testing.json`** (re-read on every run, no restart needed).

Authorized targets are declared in `config/environments.json`. A story whose URL is not listed there cannot be run, and the agent cannot navigate to (or call APIs on) any other origin.

---

## 2. How a run works

```
Story (.md)  ─┐
Approved      ├─► 1. PLAN      planner LLM call, no browser (test data, risks, notes)
regression  ──┘
scenarios        2. EXECUTE   mandatory: Happy Path → every approved regression scenario
                               each scenario = fresh incognito browser context + fresh conversation
                 3. EXPLORE   second planner call chooses charters from what step 2 observed;
                               each charter executed like a scenario
                 4. VERIFY    deterministic evidence check of every verdict
                               + independent LLM review of every finding (evidence only, no browser)
                 5. REPORT    Markdown + JSON in reports/, proposals saved to regression memory,
                               evaluator labels findings against the hidden bug list
```

**Agent tools** (`server/agents/tools.ts`): `navigate`, `snapshot`, `click` (incl. rapid multi-click), `type_text` (incl. very long values), `select_option`, `press_key`, `reload_page`, `go_back`, `set_viewport`, `set_network` (offline / slow-3g via CDP), `api_request` (calls the app API with the logged-in session, for independent verification of persistence and permissions), `screenshot` (image returned to the model), `wait`, `get_test_account`, `report_finding`, `propose_regression_scenario`, `complete_scenario`.

After every browser action the agent receives an **evidence id** (`E123`), the URL, new API traffic, console errors and a text outline of the page with element refs. Every action is stored with a screenshot.

**Verification rules** (`server/agents/verifier.ts`):

- A scenario is **Passed** only if every expected result is reported as met **and** each cites evidence that exists in that scenario. Claims without valid evidence are downgraded to *not verified* → **Inconclusive**.
- Any expectation observed as not met → **Failed**. Could not execute → **Blocked**. Ran out of steps, no completion, or unverified expectations → **Inconclusive**.
- The agent's own claim is kept next to the verified status, so disagreements are visible.
- Findings are classified as **verified defect**, **suspected** or **rejected** by a separate reviewer call that only sees the cited evidence. A finding without evidence can never be "verified". Duplicates are marked.

The agent prompt (`prompts/qa-agent.md`) contains testing method and verification rules only — no knowledge of the bugs.

---

## 3. Execution modes, cost management and model routing

| Mode | Runs | Planner | Typical use |
|---|---|---|---|
| **smoke** | Happy Path + approved regression scenarios marked **critical** | skipped (saves a call) | Pull requests |
| **regression** | Happy Path + **all** approved regression scenarios | yes | Merges, releases, nightly, manual |
| **exploratory** | Happy Path + AI-chosen exploratory charters that propose new regression scenarios | yes | Weekly schedule, manual |

Mark a scenario critical in **Regression Memory** ("Mark critical (smoke)"). Each mode has its own limits in `config/ai-testing.json → modes`; a run can lower the budget in the launcher or via the API.

**AI Cost Manager** (`server/agents/cost.ts`), one per run:

- Every model request goes through a metered provider: the budget is checked **before** the call (including a reserve equal to the last call's cost for that model, so the cap is not overshot) and input / output / cache-read / cache-write tokens, latency, requested and **served** model id are recorded **after** it in the `model_calls` ledger.
- USD cost = tokens × configurable prices (`pricing.models`) + browser minutes × `browserPerMinuteUsd` + actions × `perBrowserActionUsd` + screenshots sent to the model × `perScreenshotToModelUsd`. Calls to models without a price are counted and flagged in the report, never silently treated as free.
- Hard limits per run: cost, model calls, browser actions, scenario retries, API retries, wall-clock minutes, steps per scenario, screenshots sent to the model per scenario. Hitting any limit stops execution; the scenario in progress becomes **Inconclusive**, scenarios not yet started become **Blocked** — never Passed.
- Cost is shown per scenario (Results tab, report), per run (Runs list, viewer), and per story (Stories pages).

**Token economy:** prompt caching is on for Anthropic (top-level automatic `cache_control`; history is append-only so the prefix stays cacheable) and automatic for OpenAI; cache reads are tracked. The agent works from a text accessibility/DOM outline returned with every action; an unchanged page is referenced by evidence id instead of being re-sent; screenshots go to the model only via the explicit, budgeted `screenshot` tool (evidence screenshots are saved to disk and cost no tokens).

**Model routing** (`routing` in the config): each role (planner, executor, explorer, verifier) uses the `economy` or `advanced` tier. Default: Sonnet 5.5 executes mandatory scenarios; Opus 5.5 plans, explores and verifies. If the economy model ends a mandatory scenario without a verdict (Inconclusive, step limit, no progress), it is retried once with the advanced model (`escalateIncompleteToAdvanced`, bounded by `maxScenarioRetries`). Set `AI_MODEL` to use one model for everything.

---

## 4. CI/CD (GitHub Actions)

`.github/workflows/ai-e2e.yml` runs `npm run ci` (`scripts/ci.ts`):

| Trigger | Mode | Stories |
|---|---|---|
| Pull request touching app / server / stories / regression / prompts / config | smoke | **affected** |
| Nightly (Mon–Fri 03:00 UTC) | regression | all |
| Weekly (Sat 04:00 UTC) | exploratory | all |
| Manual (`workflow_dispatch`) | chosen | chosen (`all`, `affected`, or ids) + cost cap |

What the CI script does:

1. Starts the API server and demo app with **fresh, isolated databases** (`AI_TEST_DATA_DIR`) seeded on startup; every run also resets to the seed.
2. Selects stories. *Affected* = the story file changed, or a changed file matches the story's `covers:` path prefixes (front matter), or a file under `ci.runAllWhenChanged` / `regression/scenarios.json` changed (then all stories). If git diff is unavailable it runs all stories.
3. Runs each story in the mode under a **total job budget** (`--max-cost`, default `ci.maxTotalCostUsd`); each run is additionally capped by its mode budget. Stories that cannot start because the budget is spent are reported as incomplete.
4. Applies the required-check policy and exits with:

| Exit | Meaning |
|---|---|
| 0 | Pass (no blocking failure; nothing incomplete, or `failOnIncomplete: false`) |
| 1 | **Verified blocking failure**: a critical mandatory scenario (Happy Path or critical regression scenario) verified as Failed, or a *verified* defect with severity in `blockingFindingSeverities` found while executing a mandatory scenario |
| 2 | **Incomplete**: a mandatory scenario Blocked/Inconclusive, a run failed/cancelled, or a story not run — treated as not successful |
| 3 | Infrastructure error (environment, credentials, server) — no result was produced |

Suspected findings and exploratory findings are **advisory** (GitHub notices) unless `exploratoryFindingsBlocking` is set and they are verified. Non-critical regression failures are reported as non-blocking.

5. Writes `ci-output/summary.md|json` (also appended to the job summary), per-run Markdown/JSON reports, screenshots, server logs and the run database; the workflow uploads them as a build artifact.

**Credential safety:** pull requests from forks never receive secrets — a separate job posts a warning instead of silently passing. The API key is a secret of the GitHub environment `ai-e2e` and is exposed **only to the single step** that runs the tests (not to checkout or install). Dependencies are installed with `npm ci --ignore-scripts`; the workflow has read-only `contents` permission and does not persist the checkout token. Same-repository PR code does run with the key — protect the `ai-e2e` environment with required reviewers or branch rules if contributors are not fully trusted. The agent's browser cannot read environment variables, and credentials are never written to reports.

Setup: create the environment **ai-e2e** in the repository settings, add `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY` and the variable `AI_PROVIDER=openai`), and optionally protection rules.

Local equivalents:

```bash
npm run ci -- --mode smoke --stories affected --base origin/main
npm run ci -- --mode regression --stories all --max-cost 5
npm run ci -- --mode smoke --dry-run        # show selection and scenarios, no AI calls
```

Stop `npm run dev` first: the CI script starts its own servers on the same ports (or pass `--reuse-servers` to use the running ones without isolation).

---

## 5. The five intentional bugs

Descriptions live **only** in `evaluation/hidden-bugs.json`, which is read exclusively by `server/evaluation` after a run. The agent prompt, story, regression scenarios and demo UI never contain them. Flags in `config/sut.json` have neutral ids (`BUG-01`…`BUG-05`); the demo app only receives a neutral runtime setting, and the workspace API (which serves the evaluator view) is not reachable from the demo app's origin.

Toggle them in the workspace (**Benchmark** page) or from the CLI:

```bash
npm run sut -- status
npm run sut -- fix BUG-05        # simulate a fix
npm run sut -- break BUG-05      # re-introduce
npm run sut -- bugs none|all
npm run sut -- layout refresh    # alternative UI: top nav, "New patient" button in toolbar, form in a dialog
npm run sut -- reset             # reseed demo data
```

API changes apply immediately; UI changes apply on the next page load.

---

## 6. Demonstration script (the three stages)

Before starting: `npm run sut -- bugs all`, `npm run sut -- layout classic`.

### Stage 1 — Initial AI test
1. Workspace → **Stories** → *STORY-001 Create New Patient* → **Run AI Tests** → mode **Exploratory** (reset data).
2. Watch the **Run viewer**: live browser screenshot, current scenario, action timeline with the agent's one-line intent before each action, network calls and console errors.
3. When it finishes, review **Results** (verified verdict per scenario, expectations with evidence), **Findings** (verified vs. suspected), **Report** (AC coverage, recommendations). Export Markdown/JSON.

### Stage 2 — Regression learning
1. **Regression Memory** → *Proposed*. Each proposal shows steps, expected results, the run it came from and evidence screenshots.
2. **Approve** at least one (edit first if needed) and optionally **Mark critical** so it also runs in smoke mode / on PRs. Approval is recorded in the scenario history; the scenario is now in `regression/scenarios.json` permanently.

### Stage 3 — Regression rerun
1. Fix the bug the approved scenario guards, e.g. `npm run sut -- fix BUG-05` (or toggle it on the Benchmark page).
2. Optionally change the UI without changing behavior: `npm run sut -- layout refresh`.
3. Run STORY-001 again in **Regression** mode. Verify in the run viewer that the agent
   - executed the Happy Path in the new layout ("New patient" instead of "Add Patient", dialog form),
   - executed the approved scenario (it appears as `RS-xxx` in the scenario list),
   - reports it **Passed** now that the bug is fixed (or **Failed** if you skip the fix — try both).

Each stage is independently reproducible: runs reset demo data to the seed by default, and the configuration snapshot of every run is stored with it.

---

## 7. Benchmark and evaluation metrics

```bash
npm run benchmark -- --story STORY-001 --runs 3 --mode regression --bugs all --layout classic
npm run benchmark -- --runs 3 --mode exploratory --exploratory 3
npm run evaluate                      # metrics over all completed runs + AI-vs-traditional comparison
```

The benchmark sets the demo-app configuration, runs the story N times from a clean seed, waits for each run, prints the metrics and writes `reports/benchmark-*.json`. The **Benchmark** page shows the same metrics and lets an evaluator label findings.

| Metric | Definition |
|---|---|
| Happy Path success rate | Runs whose Happy Path verified as Passed / completed runs. With BUG-05 active a *correct* agent should **fail** the Happy Path (notes are not saved), so read this together with the active bugs. |
| Acceptance criteria coverage | ACs with at least one evidenced expectation (met or not met) / all ACs, averaged per run. |
| Regression scenario coverage | Approved scenarios reaching a conclusive verdict (Passed/Failed) / approved scenarios, per run. |
| Known bug detection rate | Enabled hidden bugs matched by at least one non-rejected finding / enabled bugs. |
| False positive rate | Findings labeled false positive, matched to a *disabled* bug, or not yet labeled / all non-duplicate findings. Unlabeled findings count as FP until a human reviews them (conservative). |
| Repeatability | For runs with identical story + configuration: share of runs that agree with the most common verdict, averaged over mandatory scenarios. Bug detection frequency is shown per bug. |
| Execution duration / cost | Wall-clock time; estimated cost from the cost ledger (model + browser + tools). |

Repeatability groups runs by story, **mode** and demo-app configuration. Every run records the requested and served model ids, effort, browser version, commit SHA / ref (from `GITHUB_SHA` or git), Node version, environment and hashes of the story and app configuration (report header and `metadata` in the JSON report).

**AI vs. traditional E2E** (Benchmark page and `npm run evaluate`): a monthly comparison of a hand-written Playwright suite covering the same scenarios against AI runs. Traditional figures are **assumptions** you set in `config/ai-testing.json → baseline` (authoring and maintenance hours, UI-change breakage, CI minutes, engineer rate). AI figures are **measured** where possible: average cost and duration per mode from completed runs, human review/edit actions in regression memory, and the share of runs that ended incomplete (real failures are excluded because they need triage under either approach). AI totals show `n/a` until every scheduled mode has at least one completed run.

Finding-to-bug matching starts with a keyword heuristic (`matchKeywords` in the hidden bug file) and is meant to be confirmed or overridden by a human on the Benchmark page. Treat auto-matches as suggestions.

---

## 8. Safety rails

- Only origins in `config/environments.json` can be visited; navigation away is reverted. `api_request` is restricted to the app's API prefix (path traversal is normalized and rejected).
- Cost, model-call, action, retry, time and step limits enforced by the cost manager; the agent is told when it is running out of steps; idle turns end a scenario as Inconclusive. Cancelling a run from the UI stops it at the next action.
- Mandatory scenarios that could not start because a limit was hit are recorded as **Blocked**, never silently skipped.
- AI API failures and browser crashes end the affected scenario as Blocked/Inconclusive with the error in the timeline; the run still produces a report. Runs interrupted by a server restart are marked failed on startup.
- Passwords typed into password fields are masked in the evidence log.
- Regression scenarios are never deleted: they can be rejected (proposals) or retired with a mandatory reason (approved). Editing an approved scenario creates a pending revision; expected results only change after the revision is approved. All changes are kept in the scenario history.

---

## 9. Project structure

```
apps/
  demo-app/              React app under test (+ Vite plugin injecting the runtime layout setting)
  testing-workspace/     AI Test Lab UI
  shared/                design tokens (theme.css) and shadcn-style components (ui.tsx)
server/
  api/                   demo.ts (system under test API), lab.ts (workspace API)
  database/              node:sqlite — data/demo.db (SUT), data/workspace.db (runs, events, results, findings)
  agents/                providers (Anthropic, OpenAI), cost manager, planner, executor, verifier, tool definitions
  browser/               CDP browser session (puppeteer-core) and page snapshot script
  execution/             run orchestration and modes, CI gate policy, run metadata, event log
  regression/            regression memory store (approval workflow + history)
  reports/               report builder (JSON + Markdown)
  evaluation/            evaluator (only reader of hidden-bugs.json), metrics, AI-vs-traditional baseline
stories/create-patient.md     example story (Markdown + front matter, editable in the UI)
prompts/qa-agent.md           agent system prompt
regression/scenarios.json     persistent regression memory
evaluation/hidden-bugs.json   PRIVATE bug list for the evaluator
config/ai-testing.json        pricing, model routing, modes, limits, CI policy, baseline assumptions
config/sut.json               bug flags and UI variant
config/environments.json      authorized test environments and account mapping
reports/                      generated reports
artifacts/runs/<runId>/       screenshots of every action
scripts/                      ci, sut, benchmark, evaluate, smoke (browser plumbing check without AI)
.github/workflows/ai-e2e.yml  GitHub Actions workflow
```

`npm run smoke` drives the demo app through the same CDP session the agent uses — without any AI — and prints what the agent would observe. Use it to check the browser setup.

---

## 10. Known limitations (read before drawing conclusions)

- **Non-determinism.** The same run can produce different exploratory paths and findings. That is why repeatability is a first-class metric; run the benchmark at least 3× per configuration.
- **Cost and time.** A full run (Happy Path + regression + 3 charters) is minutes and dollars, not seconds and cents like a Playwright suite. Compare per-run cost against the maintenance cost of handwritten tests, not against their execution cost.
- **Verification is evidence-based, not ground truth.** The verifier checks that claims are backed by recorded observations; a model can still misread an observation. Spot-check failed and passed scenarios via the timeline and screenshots.
- **Keyword matching** of findings to hidden bugs is a heuristic; label findings manually for final numbers.
- **The demo app is small.** Results on a 5-page CRUD app do not automatically transfer to large applications.
- The pricing table is a static estimate; adjust it to your contract.
- The baseline comparison is only as good as the assumptions you enter; it is meant to make the trade-off explicit, not to settle it.
- The GitHub workflow has not been executed in this repository yet (no remote, no secret). Run it once with `workflow_dispatch` and a low `max_cost_usd` before relying on it as a required check.
