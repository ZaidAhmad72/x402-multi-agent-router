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

export async function appendMessageToHistory(username: string, chatId: string, message: Message, title?: string) {
  try {
    const doc = await historyCollection.findOne({ username, chatId });
    if (!doc) {
      const newDoc: HistoryDocument = {
        username,
        chatId,
        title: title || 'New Chat',
        messages: [message],
        createdAt: new Date(),
        updatedAt: new Date()
      };
      await historyCollection.insertOne(newDoc);
    } else {
      const updateData: any = { 
        $push: { messages: message },
        $set: { updatedAt: new Date() }
      };
      if (title && doc.title === 'New Chat') {
        updateData.$set.title = title;
      }
      await historyCollection.updateOne({ username, chatId }, updateData);
    }
  } catch (err) {
    console.error("Failed to append message to history:", err);
  }
}

export { historyApp };
