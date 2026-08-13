import { Hono } from 'hono';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import algosdk from 'algosdk';
import { usersCollection, isDbConnected } from './db';

const authApp = new Hono();

const JWT_SECRET = process.env.JWT_SECRET || 'x402_multi_agent_router_secret_key_2026';
const DB_UNAVAILABLE_MESSAGE =
  'Database unavailable -- registration/login is down (MongoDB never connected on startup; check the router logs for why).';

// Challenge map for wallet ownership verification (expires in 10 minutes)
const walletChallenges = new Map<string, { nonce: string; expiresAt: number }>();

/**
 * Lightweight, zero-dependency JWT HMAC-SHA256 session token generation
 */
export function createSessionToken(username: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      username,
      iat: Date.now(),
      exp: Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 days expiration
    })
  ).toString('base64url');

  const signature = createHmac('sha256', JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');

  return `${header}.${payload}.${signature}`;
}

/**
 * Validates session token and returns decoded username if valid
 */
export function verifySessionToken(token: string): { valid: boolean; username?: string } {
  if (!token) return { valid: false };

  try {
    const parts = token.split('.');
    if (parts.length !== 3) return { valid: false };

    const [header, payload, signature] = parts;
    const expectedSig = createHmac('sha256', JWT_SECRET)
      .update(`${header}.${payload}`)
      .digest('base64url');

    const sigBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSig);

    if (sigBuffer.length !== expectedBuffer.length || !timingSafeEqual(sigBuffer, expectedBuffer)) {
      return { valid: false };
    }

    const decodedPayload = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (decodedPayload.exp && decodedPayload.exp < Date.now()) {
      return { valid: false };
    }

    return { valid: true, username: decodedPayload.username };
  } catch (e) {
    return { valid: false };
  }
}

// Salted scrypt hash (Node's built-in crypto)
function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, salt, 64);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

authApp.use('*', async (c, next) => {
  if (!isDbConnected()) {
    return c.json({ error: DB_UNAVAILABLE_MESSAGE }, 503);
  }
  await next();
});

// GET /auth/me - Validates Bearer token & returns active account info
authApp.get('/me', async (c) => {
  const authHeader = c.req.header('Authorization');
  const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '').trim() : '';

  const verification = verifySessionToken(token);
  if (!verification.valid || !verification.username) {
    return c.json({ error: 'Invalid or expired session token' }, 401);
  }

  const user = await usersCollection.findOne({ username: verification.username });
  if (!user) {
    return c.json({ error: 'User account not found' }, 404);
  }

  return c.json({
    status: 'ok',
    username: user.username,
    name: user.name,
    walletAddress: user.walletAddress || null,
    walletVerified: user.walletVerified || false
  });
});

// POST /auth/register - Register new account & return session token
authApp.post('/register', async (c) => {
  try {
    const body = await c.req.json();
    const { username, name, password } = body;

    if (!username || !password || !name) {
      return c.json({ error: 'Username, name, and password are required' }, 400);
    }

    const existing = await usersCollection.findOne({ username });
    if (existing) {
      return c.json({ error: 'Username already exists' }, 409);
    }

    await usersCollection.insertOne({
      username,
      name,
      password: hashPassword(password),
      createdAt: new Date(),
      walletVerified: false
    });

    const token = createSessionToken(username);
    return c.json({
      status: 'ok',
      message: 'Registered successfully',
      username,
      token
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// POST /auth/login - Authenticate account & return session token
authApp.post('/login', async (c) => {
  try {
    const body = await c.req.json();
    const { username, password } = body;

    if (!username || !password) {
      return c.json({ error: 'Username and password are required' }, 400);
    }

    const user = await usersCollection.findOne({ username });
    if (!user || !verifyPassword(password, user.password)) {
      return c.json({ error: 'Invalid credentials' }, 401);
    }

    const token = createSessionToken(username);
    return c.json({
      status: 'ok',
      message: 'Logged in successfully',
      username,
      name: user.name,
      walletAddress: user.walletAddress || null,
      walletVerified: user.walletVerified || false,
      token
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// GET /auth/wallet-challenge - Generate cryptographic nonce for wallet verification
authApp.get('/wallet-challenge', async (c) => {
  const address = c.req.query('address');
  if (!address) {
    return c.json({ error: 'Address query parameter is required' }, 400);
  }

  const nonce = `Sign to verify wallet ownership for Atomic Router: ${randomBytes(16).toString('hex')}`;
  walletChallenges.set(address, {
    nonce,
    expiresAt: Date.now() + 10 * 60 * 1000 // 10 minutes expiry
  });

  return c.json({ status: 'ok', address, nonce });
});

// POST /auth/verify-wallet - Verify ed25519 signature of nonce & update user record
authApp.post('/verify-wallet', async (c) => {
  try {
    const body = await c.req.json();
    const { username, address, signatureHex, nonce } = body;

    if (!username || !address || !signatureHex || !nonce) {
      return c.json({ error: 'username, address, signatureHex, and nonce are required' }, 400);
    }

    const challenge = walletChallenges.get(address);
    if (!challenge || challenge.nonce !== nonce || challenge.expiresAt < Date.now()) {
      return c.json({ error: 'Invalid or expired wallet challenge nonce' }, 400);
    }

    // Verify Algorand ed25519 signature of the nonce string
    let isValid = false;
    try {
      const dataBytes = Buffer.from(nonce, 'utf8');
      const sigBytes = Buffer.from(signatureHex, 'hex');
      isValid = algosdk.verifyBytes(dataBytes, sigBytes, address);
    } catch (sigErr) {
      isValid = false;
    }

    if (!isValid) {
      return c.json({ error: 'Invalid wallet signature -- verification failed' }, 400);
    }

    // Mark wallet as verified on user profile in MongoDB
    await usersCollection.updateOne(
      { username },
      {
        $set: {
          walletAddress: address,
          walletVerified: true,
          walletVerifiedAt: new Date()
        }
      }
    );

    walletChallenges.delete(address);

    return c.json({
      status: 'ok',
      message: 'Wallet ownership verified successfully',
      username,
      walletAddress: address,
      walletVerified: true
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

export { authApp };
