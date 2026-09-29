// Build variants on top of app.json.
//
//   (default)        Sentry      com.giosferrazza.sentryspike      TestFlight / Release
//   APP_VARIANT=dev  Sentry Dev  com.giosferrazza.sentryspike.dev  Debug + Metro hot reload
//
// Separate bundle IDs let both live on the phone side by side. The dev app
// also gets its own App Group (the widget derives it from its bundle ID),
// URL scheme, and a differently tinted icon.

const IS_DEV = process.env.APP_VARIANT === 'dev';

module.exports = ({ config }) => {
  if (!IS_DEV) return config;

  const bundleIdentifier = `${config.ios.bundleIdentifier}.dev`;
  return {
    ...config,
    // Keep `name`: it names the generated Xcode project, which build scripts
    // rely on. Only the home screen label changes (CFBundleDisplayName).
    scheme: `${config.scheme}dev`,
    ios: {
      ...config.ios,
      bundleIdentifier,
      icon: './assets/expo-dev.icon',
      infoPlist: { ...config.ios.infoPlist, CFBundleDisplayName: 'Sentry Dev' },
      entitlements: {
        ...config.ios.entitlements,
        'com.apple.security.application-groups': [`group.${bundleIdentifier}`],
      },
    },
  };
};
