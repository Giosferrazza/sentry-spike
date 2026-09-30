import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { ROUTINES_ENABLED } from '@/constants/features';
import { Colors } from '@/constants/theme';

export default function AppTabs() {
  // Every screen is dark-styled, so the tab bar is too, whatever the system theme.
  const colors = Colors.dark;

  return (
    <NativeTabs
      backgroundColor={colors.background}
      indicatorColor={colors.backgroundElement}
      // White for the selected tab so blue stays reserved for "Go here" data.
      iconColor={{ default: colors.textSecondary, selected: colors.text }}
      tintColor={colors.text}
      labelStyle={{ default: { color: colors.textSecondary }, selected: { color: colors.text } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="house" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="routines" hidden={!ROUTINES_ENABLED}>
        <NativeTabs.Trigger.Label>Routines</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="checklist" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="map">
        <NativeTabs.Trigger.Label>Map</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="map" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="monitor">
        <NativeTabs.Trigger.Label>Monitor</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="dot.radiowaves.left.and.right" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
