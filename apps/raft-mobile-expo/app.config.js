const appJson = require('./app.json');

const configuredApi = process.env.EXPO_PUBLIC_RAFT_API_URL || appJson.expo.extra?.apiBaseUrl;
const configuredApns = process.env.EXPO_PUBLIC_APNS_ENV || appJson.expo.extra?.apnsEnv;
const isolatedBuild = configuredApi === 'http://127.0.0.1:13074';

module.exports = {
  expo: {
    ...appJson.expo,
    ios: {
      ...appJson.expo.ios,
      infoPlist: {
        ...appJson.expo.ios?.infoPlist,
        ...(isolatedBuild ? {
          // Test-only: make the simulator app container visible to Files so
          // native picker selection can be exercised with local fixtures.
          UIFileSharingEnabled: true,
          LSSupportsOpeningDocumentsInPlace: true,
        } : {}),
      },
    },
    extra: {
      ...appJson.expo.extra,
      apiBaseUrl: configuredApi,
      apnsEnv: configuredApns,
    },
  },
};
