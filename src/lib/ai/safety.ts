// On-device check for messages that mean "stop coaching, get a human".
// Deliberately broad: a false positive shows crisis resources, which is safe;
// a miss is not.

const PATTERNS = [
  /\b(kill|hurt|harm|cut)\s+(myself|me)\b/,
  /\bsuicid/,
  /\b(want|going|plan(ning)?)\s+to\s+die\b/,
  /\bend\s+(it\s+all|my\s+life|it)\b/,
  /\bno\s+reason\s+to\s+live\b/,
  /\bbetter\s+off\s+dead\b/,
  /\boverdos/,
  /\btoo\s+many\s+pills\b/,
  /\b(i'?m|i\s+am|feel)\s+(not\s+safe|unsafe|in\s+danger)\b/,
  /\bsomeone\s+(is\s+)?(hurting|following|threatening)\s+me\b/,
  /\b(emergency|call\s+911)\b/,
];

export function detectCrisis(text: string): boolean {
  const t = text.toLowerCase().replace(/[’]/g, "'");
  return PATTERNS.some((p) => p.test(t));
}
