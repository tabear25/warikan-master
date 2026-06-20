// Minimal ambient declaration so `process.env.EXPO_PUBLIC_*` typechecks without
// pulling in @types/node. Expo inlines EXPO_PUBLIC_* vars at build time.
declare var process: {
  env: {
    EXPO_PUBLIC_API_BASE?: string;
    [key: string]: string | undefined;
  };
};
