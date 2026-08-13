import algosdk from "algosdk"; // still fine here, just for account gen — not for txns
import * as fs from "fs";

const roles = ["user", "router", "router_fee", "agent1", "agent2", "agent3"];
const wallets: Record<string, { addr: string; mnemonic: string }> = {};

for (const role of roles) {
  const acct = algosdk.generateAccount();
  wallets[role] = {
    addr: acct.addr.toString(),
    mnemonic: algosdk.secretKeyToMnemonic(acct.sk),
  };
}

fs.writeFileSync(".env.wallets", Object.entries(wallets)
  .map(([role, w]) => `${role.toUpperCase()}_ADDR=${w.addr}\n${role.toUpperCase()}_MNEMONIC="${w.mnemonic}"`)
  .join("\n\n"));

console.log("Wrote .env.wallets — addresses below:");
for (const [role, w] of Object.entries(wallets)) console.log(role, w.addr);
