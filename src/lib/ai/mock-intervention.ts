import type { ChatMessage } from '../interventions';
import type { AIInterventionService, BuddyReply, InterventionContext, QuickIntent } from './intervention-service';

// Development buddy: short, rule-based replies that follow the same rules the
// real model gets (see BUDDY_SYSTEM_PROMPT in remote-intervention.ts). Also the
// offline fallback when the backend can't be reached.
export class MockInterventionService implements AIInterventionService {
  async opening(ctx: InterventionContext): Promise<BuddyReply> {
    if (ctx.stage === 'approach') {
      return {
        text: `Looks like you're heading toward ${ctx.placeName}, a place you chose to avoid. Want to turn around?`,
        suggestions: ['go-here', 'remind-why', 'buddy'],
      };
    }
    if (ctx.timerExpired) {
      return {
        text: `Your 10 minutes at ${ctx.placeName} are up and you're still here. No judgment. What's keeping you?`,
        suggestions: ['buddy', 'go-here', 'timer'],
      };
    }
    return {
      text: `You marked ${ctx.placeName} as somewhere you wanted to avoid. What's going on?`,
      suggestions: [],
    };
  }

  async reply(
    ctx: InterventionContext,
    history: ChatMessage[],
    input: { text: string; intent?: QuickIntent }
  ): Promise<BuddyReply> {
    const goHere = ctx.goHerePlaces[0];
    const timerOn = !!ctx.timer && !ctx.timerExpired;

    switch (input.intent ?? classify(input.text)) {
      case 'help-leave':
        if (ctx.stage === 'approach') {
          return {
            text: goHere
              ? `Turn around at the next corner. Head to ${goHere} instead?`
              : 'Turn around at the next corner. Where can you go instead?',
            suggestions: ['go-here', 'buddy'],
          };
        }
        return {
          text: goHere
            ? `Okay. Stand up and walk to the door now. Where to after: ${goHere}, or home?`
            : 'Okay. Stand up and walk to the door now. Where will you head next?',
          suggestions: timerOn ? ['go-here', 'buddy'] : ['timer', 'go-here'],
        };
      case 'struggling':
        return {
          text: 'That’s hard, and it’s okay to feel it. You don’t have to decide everything, just the next five minutes. Want to call someone?',
          suggestions: ['buddy', 'timer', 'go-here'],
        };
      case 'remind-why':
        return {
          text: ctx.reason
            ? `You wrote: “${ctx.reason}” You set that for a reason. Does it still feel true?`
            : 'You chose to avoid this place for a reason. What was it?',
          suggestions: timerOn ? ['go-here'] : ['timer', 'go-here'],
        };
      case 'rationalizing':
        return {
          text: 'That makes sense, but you set this boundary for a reason. Want to give yourself 10 minutes to leave?',
          suggestions: ['timer', 'buddy', 'go-here'],
        };
      case 'leaving':
        return {
          text: goHere ? `Good call. ${goHere} is on your list if you want somewhere to go.` : 'Good call. I’ll be here.',
          suggestions: timerOn ? ['go-here'] : ['timer', 'go-here'],
        };
      default:
        return {
          text:
            history.filter((m) => m.role === 'user').length > 2
              ? 'I hear you. What’s one step you can take in the next minute?'
              : 'Got it. What would help most right now: leaving, talking to someone, or a few minutes to decide?',
          suggestions: timerOn ? ['buddy', 'go-here'] : ['timer', 'buddy', 'go-here'],
        };
    }
  }
}

function classify(text: string): QuickIntent | 'rationalizing' | 'leaving' | null {
  const t = text.toLowerCase();
  if (/\b(leav|go(ing)? home|heading out|walk(ing)? out|i'?m out)\w*/.test(t)) return 'leaving';
  if (/\b(just|only|quick|little|one|a bit|for a minute|stop in)\b/.test(t)) return 'rationalizing';
  if (/\b(hard|can'?t|craving|urge|stress|anxious|sad|lonely|bored|tired)\b/.test(t)) return 'struggling';
  if (/\bwhy\b/.test(t)) return 'remind-why';
  return null;
}
