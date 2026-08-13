export interface UserDocument {
  username: string;
  name: string;
  password: string; // "<saltHex>:<hashHex>" -- see router/auth.ts
  createdAt: Date;
  // Persisted trust score, 0-10 (see router/userReputation.ts). Optional
  // because users created before this field existed won't have it yet --
  // every reader falls back to REPUTATION_DEFAULT rather than treating a
  // missing field as 0.
  reputation?: number;
}
