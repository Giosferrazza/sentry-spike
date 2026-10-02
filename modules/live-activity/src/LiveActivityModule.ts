import { NativeModule, requireOptionalNativeModule } from 'expo';

export type LiveActivityStart = {
  interventionId: string;
  placeName: string;
  openUrl: string;
  timerUrl: string;
  okayUrl: string;
};

export type LiveActivityState = {
  phase: 'approach' | 'arrived' | 'timer' | 'stayed' | 'left';
  enteredAt: number; // epoch ms
  timerStartedAt?: number;
  timerEndsAt?: number;
  message: string;
  streakDays: number;
};

declare class LiveActivityModule extends NativeModule<{}> {
  isSupported(): boolean;
  start(args: LiveActivityStart, state: LiveActivityState): Promise<void>;
  end(interventionId: string, state: LiveActivityState | null, dismissAfter: number): Promise<void>;
}

// Optional so a build without the native module (older installs) doesn't crash.
export default requireOptionalNativeModule<LiveActivityModule>('LiveActivity');
