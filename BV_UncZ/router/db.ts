import { MongoClient } from 'mongodb';
import { config } from 'dotenv';
import path from 'path';
import type { HistoryDocument } from '../shared/types/history';
import type { UserDocument } from '../shared/types/user';

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

// Tracked explicitly rather than inferred from a try/catch around each query
// -- a failed/never-attempted connect() leaves the driver's topology closed,
// and every collection call against it throws the same cryptic
// "MongoNotConnectedError: topology is closed" regardless of what actually
// went wrong (bad URI, network/TLS failure, Atlas IP allowlist, etc). Routes
// check this flag first and return one clear, actionable error instead of
// that driver-internal message reaching the UI.
let connected = false;

export function isDbConnected(): boolean {
  return connected;
}

export async function connectDB() {
  if (!uri) return;
  try {
    await client.connect();
    connected = true;
    console.log("Connected to MongoDB");
  } catch (err) {
    connected = false;
    console.error("Failed to connect to MongoDB -- chat history/auth will be unavailable:", err);
    return;
  }

  // One history document per user (see shared/types/history.ts) -- this
  // index makes that a hard constraint at the DB level, not just a
  // convention `history.ts`'s update logic happens to follow, so a bug or a
  // concurrent write can't silently fork a second document for the same
  // username the way the old one-document-per-chat design used to.
  //
  // Deliberately a separate try/catch from the connect() above: this can
  // fail on pre-existing duplicate `username` documents (e.g. leftover data
  // from before this schema existed) even though the connection itself is
  // completely fine. That must not flip `connected` back to false and take
  // down history/auth over an indexing detail -- everything still works
  // without the index, it just stops being a hard constraint until the
  // duplicates are cleaned up and the server is restarted.
  try {
    await historyCollection.createIndex({ username: 1 }, { unique: true });
    await usersCollection.createIndex({ username: 1 }, { unique: true });
  } catch (err) {
    console.warn(
      "Could not create unique username index -- likely pre-existing duplicate username " +
      "documents from before this schema. History/auth still work; duplicates just aren't " +
      "rejected at the DB level until the existing ones are removed and the router restarts:",
      err
    );
  }
}

export const db = client.db('x402-multi-agent');
export const usersCollection = db.collection<UserDocument>('users');
export const historyCollection = db.collection<HistoryDocument>('history');
