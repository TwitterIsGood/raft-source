const appJson = require('./app.json');

const configuredApi = process.env.EXPO_PUBLIC_RAFT_API_URL || appJson.expo.extra?.apiBaseUrl;
const configuredApns = process.env.EXPO_PUBLIC_APNS_ENV || appJson.expo.extra?.apnsEnv;

module.exports = {
  expo: {
    ...appJson.expo,
    extra: {
      ...appJson.expo.extra,
      apiBaseUrl: configuredApi,
      apnsEnv: configuredApns,
    },
  },
};
