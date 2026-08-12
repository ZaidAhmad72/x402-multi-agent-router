import nacl from "tweetnacl";
import { seedFromMnemonic } from "@algorandfoundation/algokit-utils/algo25";
import { toClientAvmSigner } from "@x402-avm/avm";

export function deriveSignerFromMnemonic(mnemonic: string) {
  const seed = seedFromMnemonic(mnemonic.trim());
  const keyPair = nacl.sign.keyPair.fromSeed(seed);
  const privateKeyBase64 = Buffer.from(keyPair.secretKey).toString("base64");
  return toClientAvmSigner(privateKeyBase64);
}
