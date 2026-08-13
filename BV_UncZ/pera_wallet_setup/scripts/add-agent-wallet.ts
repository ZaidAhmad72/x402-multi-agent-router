// add-agent-wallet.ts — generates one new agent wallet and appends it to
// .env.wallets (never overwrites existing entries). Funding + USDC opt-in is
// a separate step (needs algod) — run opt-in-usdc.ts-style logic manually
// once the wallet is funded, or add the role to that script's `roles` list.
import algosdk from "algosdk";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

const ENV_PATH = path.join(__dirname, "..", "..", ".env.wallets");
dotenv.config({ path: ENV_PATH });

const ROLE = process.argv[2];
if (!ROLE) {
  console.error("Usage: tsx add-agent-wallet.ts <ROLE>  (e.g. AGENT4)");
  process.exit(1);
}

const envKeyAddr = `${ROLE}_ADDR`;
if (process.env[envKeyAddr]) {
  console.log(`${envKeyAddr} already set in .env.wallets — not overwriting.`);
  process.exit(0);
}

const acct = algosdk.generateAccount();
const addr = acct.addr.toString();
const mnemonic = algosdk.secretKeyToMnemonic(acct.sk);

fs.appendFileSync(ENV_PATH, `\n${ROLE}_ADDR=${addr}\n${ROLE}_MNEMONIC="${mnemonic}"\n`);
console.log(`Generated ${ROLE}: ${addr}`);
console.log(`Appended to .env.wallets. Still needs: ALGO funding + USDC ASA opt-in (needs algod).`);
