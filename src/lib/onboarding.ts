import AsyncStorage from '@react-native-async-storage/async-storage';

const DONE_KEY = 'onboarding.done';

export async function needsOnboarding(): Promise<boolean> {
  return (await AsyncStorage.getItem(DONE_KEY)) !== '1';
}

export async function finishOnboarding(): Promise<void> {
  await AsyncStorage.setItem(DONE_KEY, '1');
}

export async function resetOnboarding(): Promise<void> {
  await AsyncStorage.removeItem(DONE_KEY);
}
