// Sentry only schedules local notifications, which need no entitlement.
// expo-notifications adds `aps-environment` (remote push) by default, and
// free Personal Team signing rejects any app that declares it.
const { withEntitlementsPlist } = require('expo/config-plugins');

module.exports = function withoutPushEntitlement(config) {
  return withEntitlementsPlist(config, (cfg) => {
    delete cfg.modResults['aps-environment'];
    return cfg;
  });
};
