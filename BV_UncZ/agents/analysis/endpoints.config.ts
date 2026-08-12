import { ALGORAND_TESTNET_CAIP2, USDC_TESTNET_ASA_ID } from '@x402/avm';

export const PRICE_USD = 0.02;

export interface EndpointConfig {
  [key: string]: {
    accepts: Array<{
      scheme: 'exact';
      price: string;
      network: string;
      payTo: string;
      extra: { asset: number };
    }>;
    description: string;
  };
}

export function createPaymentConfig(avmAddress: string): EndpointConfig {
  return {
    'POST /work': {
      accepts: [
        {
          scheme: 'exact',
          price: `$${PRICE_USD}`,
          network: ALGORAND_TESTNET_CAIP2,
          payTo: avmAddress,
          extra: { asset: Number(USDC_TESTNET_ASA_ID) },
        },
      ],
      description: 'Analysis agent — weather/currency data to plain-language narrative — Pay $0.02 USDC',
    },
  };
}

export default createPaymentConfig;
