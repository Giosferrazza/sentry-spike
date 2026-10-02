import { router } from 'expo-router';

// Several things can try to open the same screen at once (a notification tap,
// the app coming to the foreground, a foreground arrival). Push it only once.
let last: { url: string; at: number } | null = null;

export function openOnce(url: string): void {
  const now = Date.now();
  if (last && last.url === url && now - last.at < 10_000) return;
  last = { url, at: now };
  router.push(url as never);
}
