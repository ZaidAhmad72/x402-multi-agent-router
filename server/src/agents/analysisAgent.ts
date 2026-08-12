import { config } from "../config.js";
import type { WeatherResult } from "./weatherAgent.js";
import type { CurrencyResult } from "./currencyAgent.js";

const GROQ_MODEL = "llama-3.3-70b-versatile";

export interface AnalysisResult {
  agent: "analysis";
  text: string;
}

export interface AnalysisContext {
  weather?: WeatherResult;
  currency?: CurrencyResult;
}

export async function runAnalysisAgent(task: string, context: AnalysisContext): Promise<AnalysisResult> {
  if (!config.groqApiKey) {
    throw new Error("GROQ_API_KEY is not set. Add a Groq API key to server/.env to use the analysis agent.");
  }

  const contextLines: string[] = [];
  if (context.weather) {
    contextLines.push(
      `Weather in ${context.weather.resolvedName}: ${context.weather.condition}, ${context.weather.temperatureCelsius}°C, wind ${context.weather.windSpeedKmh} km/h.`
    );
  }
  if (context.currency) {
    contextLines.push(
      `Currency: ${context.currency.amount} ${context.currency.from} = ${context.currency.converted} ${context.currency.to} (rate ${context.currency.rate}).`
    );
  }

  const userContent = contextLines.length
    ? `${task}\n\nRelevant data gathered so far:\n${contextLines.join("\n")}`
    : task;

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.groqApiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are a concise assistant that synthesizes any provided weather/currency data with the user's question into a short, direct answer. Keep it to 2-4 sentences.",
        },
        { role: "user", content: userContent },
      ],
      temperature: 0.5,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Groq request failed: ${res.status} ${body}`);
  }

  const data = (await res.json()) as any;
  const text = data.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error("Groq response had no message content");
  }

  return { agent: "analysis", text };
}
