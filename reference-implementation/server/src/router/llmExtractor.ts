import { config } from "../config.js";
import type { AgentName } from "./intentRouter.js";

const GROQ_MODEL = "llama-3.3-70b-versatile";
const VALID_AGENTS = new Set<AgentName>(["weather", "currency", "analysis"]);

export interface ExtractedIntent {
  agents: AgentName[];
  location: string | null;
  amount: number | null;
  fromCurrency: string | null;
  toCurrency: string | null;
}

const SYSTEM_PROMPT = `You extract structured parameters from a user's task text for a multi-agent router.
Respond with ONLY a JSON object, no other text, matching exactly this shape:
{
  "agents": string[],       // subset of "weather", "currency", "analysis" - which are relevant to the task
  "location": string|null,  // city name for the weather agent, only if "weather" is in agents, else null
  "amount": number|null,    // numeric amount to convert, only if "currency" is in agents (default 1 if unspecified), else null
  "fromCurrency": string|null, // 3-letter ISO code (e.g. USD, EUR, INR, GBP, JPY), only if "currency" is in agents, else null
  "toCurrency": string|null    // 3-letter ISO code, only if "currency" is in agents, else null
}
Rules:
- If more than one agent is relevant, always include "analysis" too, to synthesize the results.
- If nothing matches any agent, return {"agents":["analysis"],"location":null,"amount":null,"fromCurrency":null,"toCurrency":null}.
- Only ever return the JSON object, nothing else.`;

function normalizeExtraction(parsed: any): ExtractedIntent {
  const agents = Array.isArray(parsed?.agents)
    ? parsed.agents.filter((a: unknown): a is AgentName => VALID_AGENTS.has(a as AgentName))
    : [];

  return {
    agents: agents.length ? agents : ["analysis"],
    location: typeof parsed?.location === "string" ? parsed.location : null,
    amount: typeof parsed?.amount === "number" ? parsed.amount : null,
    fromCurrency: typeof parsed?.fromCurrency === "string" ? parsed.fromCurrency.toUpperCase() : null,
    toCurrency: typeof parsed?.toCurrency === "string" ? parsed.toCurrency.toUpperCase() : null,
  };
}

/**
 * Uses Groq to extract which agents are relevant and their parameters
 * (location, amount, currencies) directly from raw task text, in one call.
 * Throws on any failure — callers should fall back to the regex-based
 * intentRouter/agent-level extraction when this throws, so a Groq outage
 * never takes down the whole endpoint.
 */
export async function extractIntentWithLLM(task: string): Promise<ExtractedIntent> {
  if (!config.groqApiKey) {
    throw new Error("GROQ_API_KEY is not set");
  }

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.groqApiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: task },
      ],
      temperature: 0,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    throw new Error(`Groq extraction request failed: ${res.status}`);
  }

  const data = (await res.json()) as any;
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) {
    throw new Error("Groq extraction returned no content");
  }

  const parsed = JSON.parse(raw);
  return normalizeExtraction(parsed);
}
