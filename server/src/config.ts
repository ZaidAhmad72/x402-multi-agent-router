import "dotenv/config";

export const config = {
  port: Number(process.env.PORT ?? 3000),
  payToAddress: process.env.PAYTO_ADDRESS ?? "",
  facilitatorUrl: process.env.FACILITATOR_URL ?? "https://facilitator.goplausible.xyz",
  groqApiKey: process.env.GROQ_API_KEY ?? "",
  demoPayerMnemonic: process.env.DEMO_PAYER_MNEMONIC ?? "",
};
