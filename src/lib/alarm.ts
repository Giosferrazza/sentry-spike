import AsyncStorage from '@react-native-async-storage/async-storage';

import SentryAlarm, { type AlarmAuthorization } from '../../modules/live-activity/src/SentryAlarmModule';

// Full-screen alarm (AlarmKit, iOS 26) for Stay Out approaches and arrivals.
// On by default once iOS allows it; a notification always goes out too.

const ENABLED_KEY = 'sentry-alarm-enabled';

export function alarmAuthorization(): AlarmAuthorization {
  return SentryAlarm?.authorization() ?? 'unsupported';
}

// Foreground only (onboarding, Monitor's Start).
export async function requestAlarmAuthorization(): Promise<AlarmAuthorization> {
  if (!SentryAlarm) return 'unsupported';
  return SentryAlarm.requestAuthorization().catch(() => 'denied' as const);
}

export async function alarmEnabled(): Promise<boolean> {
  return (await AsyncStorage.getItem(ENABLED_KEY)) !== '0';
}

export async function setAlarmEnabled(on: boolean): Promise<void> {
  await AsyncStorage.setItem(ENABLED_KEY, on ? '1' : '0');
}

// Ring now if allowed. Never throws: the notification is the fallback.
export async function ringAlarm(title: string): Promise<boolean> {
  if (!SentryAlarm || alarmAuthorization() !== 'authorized' || !(await alarmEnabled())) return false;
  try {
    return !!(await SentryAlarm.ring(title));
  } catch (e) {
    console.log('Alarm failed:', e);
    return false;
  }
}
