import type { ToolDef } from "./providers/types.js";

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const str = (description: string) => ({ type: "string", description });
const strArr = (description: string) => ({ type: "array", items: { type: "string" }, description });

/** Browser + reporting tools exposed to the executor agent. */
export const AGENT_TOOLS: ToolDef[] = [
  {
    name: "get_test_account",
    description: "Returns the email and password of an authorized test account for the given role.",
    parameters: obj({ role: { type: "string", enum: ["therapist", "admin"] } }, ["role"]),
  },
  {
    name: "navigate",
    description: "Navigate to a path or URL inside the application under test (e.g. '/' or '/patients'). Returns the page outline.",
    parameters: obj({ path: str("Path or absolute URL within the application.") }, ["path"]),
  },
  {
    name: "snapshot",
    description: "Returns the current page outline: visible text, headings, tables, alerts/toasts and interactive elements with refs like [e12].",
    parameters: obj({}),
  },
  {
    name: "click",
    description: "Click an element by ref. Use times > 1 to click rapidly several times (e.g. to test duplicate submissions).",
    parameters: obj(
      {
        ref: str("Element ref from the latest outline, e.g. 'e12'."),
        times: { type: "integer", minimum: 1, maximum: 5, description: "Number of rapid clicks (default 1)." },
        interval_ms: { type: "integer", minimum: 0, maximum: 2000, description: "Delay between rapid clicks (default 60)." },
      },
      ["ref"],
    ),
  },
  {
    name: "type_text",
    description:
      "Type into an input or textarea (replaces existing content by default). For date inputs use YYYY-MM-DD. Use repeat to build very long values without writing them out.",
    parameters: obj(
      {
        ref: str("Element ref."),
        text: str("Text to type."),
        repeat: { type: "integer", minimum: 1, maximum: 5000, description: "Repeat the text N times (max 5000 characters total)." },
        clear: { type: "boolean", description: "Clear existing content first (default true)." },
        press_enter: { type: "boolean", description: "Press Enter after typing (default false)." },
      },
      ["ref", "text"],
    ),
  },
  {
    name: "select_option",
    description: "Choose an option in a <select> element by its visible label or value.",
    parameters: obj({ ref: str("Element ref."), option: str("Option label or value.") }, ["ref", "option"]),
  },
  {
    name: "press_key",
    description: "Press a keyboard key, e.g. Enter, Escape, Tab.",
    parameters: obj({ key: str("Key name.") }, ["key"]),
  },
  { name: "reload_page", description: "Reload the current page (browser refresh).", parameters: obj({}) },
  { name: "go_back", description: "Browser back navigation.", parameters: obj({}) },
  {
    name: "set_viewport",
    description: "Resize the browser viewport, e.g. 390x844 for a phone.",
    parameters: obj({ width: { type: "integer" }, height: { type: "integer" } }, ["width", "height"]),
  },
  {
    name: "set_network",
    description: "Emulate network conditions for subsequent actions.",
    parameters: obj({ mode: { type: "string", enum: ["online", "offline", "slow-3g"] } }, ["mode"]),
  },
  {
    name: "api_request",
    description:
      "Send an HTTP request to the application's API from inside the browser, using the currently logged-in session. Use it to independently verify persisted data and permission boundaries. Only the application API path prefix is allowed.",
    parameters: obj(
      {
        method: { type: "string", enum: ["GET", "POST", "PUT", "DELETE"] },
        path: str("API path, e.g. /api/demo/patients?search=Jane"),
        body: { type: "object", description: "JSON body for POST/PUT.", additionalProperties: true },
      },
      ["method", "path"],
    ),
  },
  {
    name: "screenshot",
    description: "Capture a screenshot and look at it. Costly and limited per scenario: use ONLY for visual/layout questions the text outline cannot answer.",
    parameters: obj({ full_page: { type: "boolean" } }),
  },
  {
    name: "wait",
    description: "Wait for asynchronous UI updates.",
    parameters: obj({ ms: { type: "integer", minimum: 100, maximum: 5000 } }, ["ms"]),
  },
  {
    name: "report_finding",
    description: "Report an observed defect: behavior that differs from the story, the scenario, or reasonable user expectations.",
    parameters: obj(
      {
        title: str("Short, specific title."),
        severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
        expected: str("Expected behavior."),
        actual: str("Observed behavior."),
        steps_to_reproduce: strArr("Reproduction steps."),
        evidence_ids: strArr("Evidence ids like E12 that show the actual behavior."),
        times_observed: { type: "integer", minimum: 1, description: "How many times you observed it." },
      },
      ["title", "severity", "expected", "actual", "steps_to_reproduce", "evidence_ids", "times_observed"],
    ),
  },
  {
    name: "propose_regression_scenario",
    description: "Propose a new regression scenario for human review. Steps and expected results must describe the CORRECT behavior.",
    parameters: obj(
      {
        title: str("Scenario title."),
        description: str("What the scenario protects against."),
        preconditions: strArr("Preconditions."),
        steps: strArr("Execution steps in user language."),
        expected_results: strArr("Expected results (correct behavior)."),
        evidence_ids: strArr("Evidence ids from this run that motivated the proposal."),
        related_finding: str("Title of the related finding, if any."),
      },
      ["title", "description", "preconditions", "steps", "expected_results", "evidence_ids"],
    ),
  },
  {
    name: "complete_scenario",
    description: "Finish the current scenario. Call exactly once.",
    parameters: obj(
      {
        status: { type: "string", enum: ["passed", "failed", "blocked", "inconclusive"] },
        summary: str("Two or three sentences on what was tested and what was observed."),
        expectations: {
          type: "array",
          items: obj(
            {
              expectation: str("The expected result being checked."),
              outcome: { type: "string", enum: ["met", "not_met", "not_verified"] },
              observed: str("What was actually observed."),
              evidence_ids: strArr("Evidence ids supporting the outcome."),
              acceptance_criterion: { type: "integer", description: "Related acceptance criterion number, if any." },
            },
            ["expectation", "outcome", "observed", "evidence_ids"],
          ),
        },
      },
      ["status", "summary", "expectations"],
    ),
  },
];

export const BROWSER_ACTIONS = new Set(["navigate", "click", "type_text", "select_option", "press_key", "reload_page", "go_back", "set_viewport", "set_network", "api_request", "screenshot", "wait", "snapshot"]);
