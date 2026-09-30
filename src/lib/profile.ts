import AsyncStorage from '@react-native-async-storage/async-storage';

// No accounts: the user's first name is asked for once and kept on the device.
const NAME_KEY = 'profile.firstName';

export async function loadName(): Promise<string> {
  return (await AsyncStorage.getItem(NAME_KEY)) ?? '';
}

export async function saveName(name: string): Promise<void> {
  const first = name.trim().split(/\s+/)[0] ?? '';
  if (first) await AsyncStorage.setItem(NAME_KEY, first);
  else await AsyncStorage.removeItem(NAME_KEY);
}
