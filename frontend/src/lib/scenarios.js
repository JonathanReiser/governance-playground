/**
 * The no-wallet demo path's scenario list — hoisted out of LiveDemoPanel.jsx
 * so ConnectStep.jsx can also look up a scenario's full data by id (needed
 * to resume a saved run's agent cycles from "My Runs" — see
 * runHistory.js's saveContinuation/getContinuation and LiveRunPanel.jsx's
 * `initialCheckpoint` prop) without importing LiveDemoPanel.jsx itself or
 * duplicating these two JSON imports.
 */
import MIDDLE_EAST_2026 from "../scenarios/middle-east-2026.json";
import TAIWAN_STRAIT_2026 from "../scenarios/taiwan-strait-2026.json";

export const SCENARIOS = [
  { id: "middle-east-2026", name: "Middle East 2026", blurb: "Israel, Iran, Saudi Arabia, United States", data: MIDDLE_EAST_2026 },
  { id: "taiwan-strait-2026", name: "Taiwan Strait", blurb: "China, Taiwan, Japan", data: TAIWAN_STRAIT_2026 },
];
