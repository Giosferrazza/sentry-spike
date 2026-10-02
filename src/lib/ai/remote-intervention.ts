import type { ChatMessage, SuggestedAction } from '../interventions';
import type { AIInterventionService, BuddyReply, InterventionContext, QuickIntent } from './intervention-service';

// Real model, via YOUR backend. The app sends context + chat; the backend adds
// BUDDY_SYSTEM_PROMPT, calls the provider (Anthropic/OpenAI/...) with a key
// only it holds, and returns { text, suggestions, crisis }.
//
//   POST {baseUrl}/intervention/reply
//   body: { ctx, history: [{ role, text }], input: { text, intent? } | null }
//   -> { text: string, suggestions: SuggestedAction[], crisis?: boolean }
//
// TODO(backend): stand up this endpoint. Until then, leave
// EXPO_PUBLIC_SENTRY_API_URL unset and the mock buddy is used.

export const BUDDY_SYSTEM_PROMPT = `You are Sentry, a calm buddy inside a habit app. The user is heading toward (ctx.stage "approach") or just walked into ("arrived") a place they chose to avoid. On approach, the goal is turning around before they get there.
- Keep every reply to 1-2 short sentences. Ask at most one simple question.
- Acknowledge where they are and that they chose to avoid it. Never shame them.
- Push toward one concrete action now: leave, start a 10-minute exit timer, call someone, or go to one of their Go Here places.
- No therapy talk, no diagnoses, no pressure tactics, no guilt. You are not a therapist and don't claim to be.
- If they mention self-harm, suicide, or being in danger, stop coaching and set crisis=true.
- suggestions may only contain: "timer", "buddy", "go-here", "remind-why", "okay".`;

const ALLOWED: SuggestedAction[] = ['timer', 'buddy', 'go-here', 'remind-why', 'okay'];
const TIMEOUT_MS = 8_000;

export class RemoteInterventionService implements AIInterventionService {
  constructor(private baseUrl: string) {}

  opening(ctx: InterventionContext): Promise<BuddyReply> {
    return this.call(ctx, [], null);
  }

  reply(ctx: InterventionContext, history: ChatMessage[], input: { text: string; intent?: QuickIntent }) {
    return this.call(ctx, history, input);
  }

  private async call(
    ctx: InterventionContext,
    history: ChatMessage[],
    input: { text: string; intent?: QuickIntent } | null
  ): Promise<BuddyReply> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${this.baseUrl}/intervention/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ctx, history: history.map(({ role, text }) => ({ role, text })), input }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`Buddy backend ${res.status}`);
      const json = await res.json();
      if (typeof json?.text !== 'string') throw new Error('Bad buddy reply');
      return {
        text: json.text,
        suggestions: Array.isArray(json.suggestions) ? json.suggestions.filter((s: any) => ALLOWED.includes(s)) : [],
        crisis: json.crisis === true,
      };
    } finally {
      clearTimeout(t);
    }
  }
}
