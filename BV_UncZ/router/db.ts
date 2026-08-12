import { MongoClient } from 'mongodb';
import { config } from 'dotenv';
import path from 'path';

const envPath = path.resolve(__dirname, '../.env.local');
console.log('Loading .env.local from:', envPath);
config({ path: envPath });

const uri = process.env.MONGODB_URI;

if (!uri) {
  console.error("MONGODB_URI is not defined in .env.local. Path checked:", envPath);
  process.exit(1);
}

const client = new MongoClient(uri);

export async function connectDB() {
  try {
    await client.connect();
    console.log("Connected to MongoDB");
  } catch (err) {
    console.error("Failed to connect to MongoDB", err);
  }
}

export const db = client.db('x402-multi-agent');
export const usersCollection = db.collection('users');
export const historyCollection = db.collection('history');
