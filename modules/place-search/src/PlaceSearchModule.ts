import { NativeModule, requireNativeModule } from 'expo';

export type SearchRegion = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

export type Suggestion = { title: string; subtitle: string };

export type ResolvedPlace = Suggestion & { latitude: number; longitude: number };

declare class PlaceSearchModule extends NativeModule<{}> {
  complete(query: string, region: SearchRegion): Promise<Suggestion[]>;
  resolve(title: string, subtitle: string, region: SearchRegion): Promise<ResolvedPlace | null>;
}

export default requireNativeModule<PlaceSearchModule>('PlaceSearch');
