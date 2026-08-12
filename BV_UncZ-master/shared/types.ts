export interface RouteRequest {
  task: string;
  maxSpend: number;
}

export interface AgentQuote {
  agent: string;
  url: string;
  scheme: string;
  network: string;
  asset: string;
  amountMicroUsdc: string;
  payTo: string;
  description: string;
}

export interface QuotePhaseResult {
  quotes: AgentQuote[];
  totalMicroUsdc: number;
  totalUsd: number;
}
