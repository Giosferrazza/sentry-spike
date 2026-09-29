/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: 'widget',
  name: 'SentryWidget',
  deploymentTarget: '17.0',
  colors: {
    $widgetBackground: '#0f1115',
    $accent: '#3987e5',
  },
  entitlements: {
    // Shared with the app so it can hand the widget a data snapshot.
    'com.apple.security.application-groups':
      config.ios.entitlements['com.apple.security.application-groups'],
  },
});
