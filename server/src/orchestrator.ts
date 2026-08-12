import { selectAgents, type AgentName } from "./router/intentRouter.js";
import { extractIntentWithLLM } from "./router/llmExtractor.js";
import { runWeatherAgent, type WeatherResult } from "./agents/weatherAgent.js";
import { runCurrencyAgent, type CurrencyResult } from "./agents/currencyAgent.js";
import { runAnalysisAgent, type AnalysisResult } from "./agents/analysisAgent.js";

type AgentOutcome<T> = { ok: true; data: T } | { ok: false; error: string };

export interface OrchestrationResult {
  agents: AgentName[];
  extraction: "llm" | "regex-fallback";
  weather?: AgentOutcome<WeatherResult>;
  currency?: AgentOutcome<CurrencyResult>;
  analysis?: AgentOutcome<AnalysisResult>;
}

async function safeRun<T>(fn: () => Promise<T>): Promise<AgentOutcome<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Decides agents + parameters (location, amount, currencies) with a single
 * Groq call. If Groq is unavailable or returns something unusable, falls
 * back to the regex-based intentRouter for agent selection, and lets each
 * agent fall back to its own regex extraction over the raw task text. This
 * keeps the endpoint working even during a Groq outage during a live demo.
 */
async function decideIntent(task: string) {
  try {
    const extracted = await extractIntentWithLLM(task);
    return { ...extracted, extraction: "llm" as const };
  } catch (err) {
    console.error(`LLM extraction failed, falling back to regex: ${err instanceof Error ? err.message : err}`);
    return {
      agents: selectAgents(task),
      location: null,
      amount: null,
      fromCurrency: null,
      toCurrency: null,
      extraction: "regex-fallback" as const,
    };
  }
}

/**
 * Runs the agents relevant to the task. Weather/currency run in parallel;
 * analysis (if selected) runs after them so it can synthesize their
 * results, and always runs even if weather/currency failed. A single agent
 * failing never crashes the whole response — it reports its own error.
 */
export async function runOrchestration(task: string): Promise<OrchestrationResult> {
  const { agents, location, amount, fromCurrency, toCurrency, extraction } = await decideIntent(task);

  const result: OrchestrationResult = { agents, extraction };

  const [weather, currency] = await Promise.all([
    agents.includes("weather") ? safeRun(() => runWeatherAgent(task, location)) : Promise.resolve(undefined),
    agents.includes("currency")
      ? safeRun(() => runCurrencyAgent(task, amount, fromCurrency, toCurrency))
      : Promise.resolve(undefined),
  ]);

  if (weather) result.weather = weather;
  if (currency) result.currency = currency;

  if (agents.includes("analysis")) {
    result.analysis = await safeRun(() =>
      runAnalysisAgent(task, {
        weather: weather?.ok ? weather.data : undefined,
        currency: currency?.ok ? currency.data : undefined,
      })
    );
  }

  return result;
}
