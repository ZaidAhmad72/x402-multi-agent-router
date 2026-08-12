let killed = false;

export function isKilled(): boolean {
  return killed;
}

export function kill(): void {
  killed = true;
}

export function revive(): void {
  killed = false;
}
