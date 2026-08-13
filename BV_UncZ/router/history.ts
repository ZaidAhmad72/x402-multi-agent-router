import { Hono } from 'hono';
import { historyCollection, isDbConnected } from './db';
import type { ChatEntry } from '../shared/types/history';

const historyApp = new Hono();

const DB_UNAVAILABLE_MESSAGE =
  'Database unavailable -- chat history is down (MongoDB never connected on startup; check the router logs for why).';

historyApp.use('*', async (c, next) => {
  if (!isDbConnected()) {
    return c.json({ error: DB_UNAVAILABLE_MESSAGE }, 503);
  }
  await next();
});

historyApp.get('/sessions/:username', async (c) => {
  try {
    const username = c.req.param('username');
    if (!username) return c.json({ error: 'Username required' }, 400);

    const doc = await historyCollection.findOne({ username });
    const chats = doc?.chats ?? [];
    const sessions = [...chats]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .map((chat) => ({ chatId: chat.chatId, title: chat.title || 'New Chat', updatedAt: chat.updatedAt }));

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

    const doc = await historyCollection.findOne({ username });
    const chat = doc?.chats.find((ch) => ch.chatId === chatId);

    return c.json({ history: chat?.messages ?? [] });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Appends exactly one message to one chat -- called by the frontend at the
// two moments a message is actually final: right when the user sends a task
// (before the router call even starts), and right when agent processing
// finishes, success or failure (see ChatApp.tsx's appendToHistory calls).
// Replaces the old bulk '/update' (whole messages[] resync on every React
// state change, including transient isThinking placeholders) -- that
// approach fired many overlapping requests per turn with no ordering
// guarantee, so a slow early request could overwrite a newer one's data with
// a stale, incomplete array. One append per real event has none of that: a
// single $push per call, nothing to race against itself.
historyApp.post('/append', async (c) => {
  try {
    const body = await c.req.json();
    const { username, chatId, title, message } = body;
    if (!username || !chatId || !message) return c.json({ error: 'Missing fields' }, 400);

    const now = new Date();

    // Try appending onto this chat's entry in place first (the common case:
    // the user document and this chat both already exist).
    const setFields: Record<string, unknown> = { 'chats.$.updatedAt': now };
    if (title) setFields['chats.$.title'] = title;

    const updated = await historyCollection.updateOne(
      { username, 'chats.chatId': chatId },
      { $push: { 'chats.$.messages': message }, $set: setFields }
    );

    if (updated.matchedCount === 0) {
      // No matching chat entry -- either this user has no history document
      // yet, or this chatId is new. $push with upsert:true handles both:
      // creates {username, chats: [newChat]} if the document doesn't exist,
      // or appends a new chat entry to the existing chats array if it does.
      const newChat: ChatEntry = {
        chatId,
        title: title || 'New Chat',
        createdAt: now,
        updatedAt: now,
        messages: [message],
      };
      await historyCollection.updateOne(
        { username },
        { $push: { chats: newChat } },
        { upsert: true }
      );
    }

    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

export { historyApp };
