import { Hono } from 'hono';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { usersCollection, isDbConnected } from './db';
import { REPUTATION_DEFAULT } from './userReputation';

const authApp = new Hono();

const DB_UNAVAILABLE_MESSAGE =
  'Database unavailable -- registration/login is down (MongoDB never connected on startup; check the router logs for why).';

authApp.use('*', async (c, next) => {
  if (!isDbConnected()) {
    return c.json({ error: DB_UNAVAILABLE_MESSAGE }, 503);
  }
  await next();
});

// Salted scrypt hash, no extra dependency (Node's built-in crypto). Was
// storing plaintext passwords -- fine for nobody, this is a shared testnet
// demo repo. Format: "<saltHex>:<hashHex>", verified with a constant-time
// compare so login isn't a timing side-channel.
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
      reputation: REPUTATION_DEFAULT,
    });

    return c.json({ status: 'ok', message: 'Registered successfully', username });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

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

    return c.json({ status: 'ok', message: 'Logged in successfully', username });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

export { authApp };
