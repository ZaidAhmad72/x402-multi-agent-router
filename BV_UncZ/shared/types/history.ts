export interface ProcessEvent {
  description: string;
  timestamp: number;
}

export interface ProcessSection {
  type: 'process';
  events: ProcessEvent[];
}

export interface TextSection {
  type: 'text';
  content: string;
}

export interface LinkSection {
  type: 'link';
  url: string;
  label?: string;
}

export interface ChatElementSection {
  type: 'chat-element';
  element: 'line-break' | 'hr' | string;
}

export type Section = ProcessSection | TextSection | LinkSection | ChatElementSection;

export interface Message {
  sender: 'user' | 'agent' | 'system';
  sections: Section[];
  timestamp: number;
}

export interface HistoryDocument {
  username: string;
  chatId: string;
  title?: string;
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
}
