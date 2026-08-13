import { Hono } from 'hono';
import { historyCollection } from './db';
import { HistoryDocument, Message } from '../shared/types/history';

const historyApp = new Hono();

historyApp.get('/sessions/:username', async (c) => {
  try {
    const username = c.req.param('username');
    if (!username) return c.json({ error: 'Username required' }, 400);

    const docs = await historyCollection.find({ username }).sort({ updatedAt: -1 }).toArray();
    const sessions = docs.map(doc => ({
      chatId: doc.chatId,
      title: doc.title || 'New Chat',
      updatedAt: doc.updatedAt
    }));
    
    return c.json({ sessions });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

historyApp.get('/chat/:username/:chatId', async (c) => {
  try {
    const username = c.req.param('username');
    const chatId = c.req.param('chatId');
    if (!username || !chatId) return c.json({ error: 'Username and Chat ID required' }, 400);

    const doc = await historyCollection.findOne({ username, chatId });
    if (!doc) return c.json({ history: [] });
    
    return c.json({ history: doc.messages });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

historyApp.post('/update', async (c) => {
  try {
    const body = await c.req.json();
    const { username, chatId, title, messages } = body;
    if (!username || !chatId || !messages) return c.json({ error: 'Missing fields' }, 400);

    const updateData: any = { 
      $set: { messages, updatedAt: new Date() }
    };
    if (title) {
      updateData.$set.title = title;
    }

    await historyCollection.updateOne(
      { username, chatId },
      updateData,
      { upsert: true }
    );
    
    // Also set createdAt if this was an upsert, we can do it with $setOnInsert
    await historyCollection.updateOne(
      { username, chatId },
      { $setOnInsert: { createdAt: new Date() } }
    );

    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

export { historyApp };
