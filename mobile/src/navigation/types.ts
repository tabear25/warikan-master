import type { NativeStackScreenProps } from "@react-navigation/native-stack";

// Native-stack routes. `Event` replaces the web's hash route `/event/:id`.
export type RootStackParamList = {
  Home: undefined;
  Create: undefined;
  Event: { eventId: number };
  Admin: undefined;
  Help: undefined;
};

export type ScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  T
>;
