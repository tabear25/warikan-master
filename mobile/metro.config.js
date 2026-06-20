// Default Expo Metro config. The mobile app is self-contained (it does not
// import from the repo's `shared/` package at runtime — the small pure helpers
// it needs are copied into src/lib), so no monorepo `watchFolders` are needed.
const { getDefaultConfig } = require("expo/metro-config");

module.exports = getDefaultConfig(__dirname);
