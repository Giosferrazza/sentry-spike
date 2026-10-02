import { NativeModule, requireOptionalNativeModule } from 'expo';

export type AlarmAuthorization = 'unsupported' | 'notDetermined' | 'denied' | 'authorized';

declare class SentryAlarmModule extends NativeModule<{}> {
  authorization(): AlarmAuthorization;
  requestAuthorization(): Promise<AlarmAuthorization>;
  ring(title: string): Promise<string | null>;
  cancel(id: string): void;
}

export default requireOptionalNativeModule<SentryAlarmModule>('SentryAlarm');
