export type AgentName = "weather" | "currency" | "analysis";

const WEATHER_KEYWORDS = [
  "weather",
  "temperature",
  "forecast",
  "rain",
  "raining",
  "sunny",
  "cold",
  "hot",
  "climate",
  "snow",
  "wind",
  "humidity",
];

const CURRENCY_KEYWORDS = [
  "currency",
  "convert",
  "exchange rate",
  "exchange",
  "rupee",
  "rupees",
  "dollar",
  "dollars",
  "euro",
  "euros",
  "usd",
  "inr",
  "eur",
  "gbp",
  "pound",
  "yen",
];

const ANALYSIS_KEYWORDS = [
  "should i",
  "advice",
  "recommend",
  "recommendation",
  "analysis",
  "analyze",
  "think",
  "opinion",
  "suggest",
];

function matchesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

/**
 * Decides which agents to call from raw user text using simple keyword
 * matching. If more than one agent is triggered, the analysis agent is
 * always included too, to synthesize the other agents' results. If nothing
 * matches, falls back to analysis alone so the endpoint always returns
 * something useful for a general question.
 */
export function selectAgents(task: string): AgentName[] {
  const text = task.toLowerCase();

  const agents = new Set<AgentName>();
  if (matchesAny(text, WEATHER_KEYWORDS)) agents.add("weather");
  if (matchesAny(text, CURRENCY_KEYWORDS)) agents.add("currency");
  if (matchesAny(text, ANALYSIS_KEYWORDS)) agents.add("analysis");

  if (agents.size === 0) {
    agents.add("analysis");
  } else if (agents.size > 1) {
    agents.add("analysis");
  }

  return Array.from(agents);
}
