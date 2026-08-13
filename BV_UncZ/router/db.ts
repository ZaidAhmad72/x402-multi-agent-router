import { MongoClient } from 'mongodb';
import { config } from 'dotenv';
import path from 'path';

const envPath = path.resolve(__dirname, '../.env');
console.log('Loading .env from:', envPath);
config({ path: envPath });

const uri = process.env.MONGODB_URI;

// This module used to call process.exit(1) here when MONGODB_URI was unset --
// which crashed the ENTIRE router (payments, quoting, settlement, everything)
// on startup, not just chat history/auth. Those features are unrelated to
// MongoDB and must keep working even if it's never configured. Falls back to
// a placeholder URI so the MongoClient constructor never throws synchronously;
// connectDB() below simply skips connecting, and any /auth or /history route
// that actually touches the DB fails on its own request with a clear error
// (each already wraps its Mongo calls in try/catch), not a process crash.
if (!uri) {
  console.warn(
    `⚠ MONGODB_URI is not set (checked ${envPath}) -- chat history and auth ` +
    `will be unavailable, but the router itself (payments, quoting, settlement) ` +
    `will run normally.`
  );
}

const client = new MongoClient(uri || 'mongodb://localhost:27017');

export async function connectDB() {
  if (!uri) return;
  try {
    await client.connect();
    console.log("Connected to MongoDB");
  } catch (err) {
    console.error("Failed to connect to MongoDB -- chat history/auth will be unavailable:", err);
  }
}

export const db = client.db('x402-multi-agent');
export const usersCollection = db.collection('users');
export const historyCollection = db.collection('history');
