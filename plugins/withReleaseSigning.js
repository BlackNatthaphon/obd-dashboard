// Signs Android release builds with credentials/release.keystore (the same key as the
// old Java app) so the new APK installs over the old one without uninstalling.
const { withAppBuildGradle } = require('expo/config-plugins');

const RELEASE = `
        release {
            storeFile file('../../credentials/release.keystore')
            storePassword 'obd12345'
            keyAlias 'obd'
            keyPassword 'obd12345'
        }`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, cfg => {
    let g = cfg.modResults.contents;
    if (!g.includes("credentials/release.keystore")) {
      g = g.replace(/signingConfigs\s*\{/, m => m + RELEASE);
      g = g.replace(/(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig\s+signingConfigs\.debug/, '$1signingConfig signingConfigs.release');
    }
    cfg.modResults.contents = g;
    return cfg;
  });
};
