import { Hono } from 'hono';
import { usersCollection } from './db';

const authApp = new Hono();

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
      password, // In a real app, hash this with bcrypt
      createdAt: new Date()
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
    
    const user = await usersCollection.findOne({ username, password });
    if (!user) {
      return c.json({ error: 'Invalid credentials' }, 401);
    }
    
    return c.json({ status: 'ok', message: 'Logged in successfully', username });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

export { authApp };
