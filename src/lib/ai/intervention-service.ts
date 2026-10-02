import type { ChatMessage, SuggestedAction } from '../interventions';
import { MockInterventionService } from './mock-intervention';
import { RemoteInterventionService } from './remote-intervention';
import { detectCrisis } from './safety';

// The one interface the Intervention screen talks to. Swap providers by
// changing createInterventionService(), never the UI.

export type InterventionContext = {
  placeName: string;
  // approach: on the way, not there yet; arrived: inside the place.
  stage: 'approach' | 'arrived';
  reason?: string; // the user's own "why" for this place
  minutesThere: number;
  streakDays: number; // stay-out days clean before this visit
  goHerePlaces: string[];
  timer: { endsAt: string } | null;
  timerExpired: boolean;
};

// Quick actions the user can tap; sent to the service as a user turn.
export type QuickIntent = 'help-leave' | 'struggling' | 'remind-why';

export type BuddyReply = {
  text: string;
  suggestions: SuggestedAction[];
  // Imminent danger or self-harm: the UI stops coaching and shows human help.
  crisis?: boolean;
};

export interface AIInterventionService {
  // First message when the screen opens.
  opening(ctx: InterventionContext): Promise<BuddyReply>;
  // Reply to free text or a quick action.
  reply(
    ctx: InterventionContext,
    history: ChatMessage[],
    input: { text: string; intent?: QuickIntent }
  ): Promise<BuddyReply>;
}

export const CRISIS_REPLY: BuddyReply = {
  text:
    "I'm really glad you told me. This is bigger than a place to leave, and you deserve a real person right now. " +
    "If you're in danger, call 911. You can call or text 988 any time to talk to someone.",
  suggestions: [],
  crisis: true,
};

// Safety runs on the device before any provider sees the message, so it
// can't be skipped by a model or a network failure.
function withSafety(inner: AIInterventionService, fallback: AIInterventionService): AIInterventionService {
  const safe = async (p: () => Promise<BuddyReply>, f: () => Promise<BuddyReply>) => {
    try {
      return await p();
    } catch {
      return f(); // offline or backend down: the local buddy still helps
    }
  };
  return {
    opening: (ctx) => safe(() => inner.opening(ctx), () => fallback.opening(ctx)),
    reply: async (ctx, history, input) => {
      if (detectCrisis(input.text)) return CRISIS_REPLY;
      const r = await safe(() => inner.reply(ctx, history, input), () => fallback.reply(ctx, history, input));
      return r.crisis ? CRISIS_REPLY : r;
    },
  };
}

function createInterventionService(): AIInterventionService {
  const mock = new MockInterventionService();
  // Set EXPO_PUBLIC_SENTRY_API_URL to your backend to use a real model. The
  // backend holds the provider key; the app never does.
  const url = process.env.EXPO_PUBLIC_SENTRY_API_URL;
  return withSafety(url ? new RemoteInterventionService(url) : mock, mock);
}

export const interventionService = createInterventionService();
