export interface ProcessEvent {
  description: string;
  timestamp: number;
}

// One document per user, every chat embedded as an array entry -- not one
// document per {username, chatId} pair (the old shape, which is what "a new
// collection/record for every chat" was actually describing: every chat a
// user started added a whole new top-level history document instead of
// living inside that user's one record).
export interface ChatEntry {
  chatId: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  // Opaque on purpose -- this is FRONTEND/src/types.ts's Message[] verbatim
  // (id/sender/text/html/raw/steps/isPreview). The backend never needs to
  // know that shape, just store and return it exactly as sent so history
  // reloads restore full state (including UserView's trace/answer/cost
  // rendering, which depends on `raw`/`steps` surviving a reload).
  messages: unknown[];
}

export interface HistoryDocument {
  username: string;
  chats: ChatEntry[];
}
