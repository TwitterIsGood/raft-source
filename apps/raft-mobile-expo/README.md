# Raft Mobile (Expo, non-EAS)

Native iOS client for the Raft fork. It talks to the existing user REST and Socket.IO surfaces; no Web/server API changes are required for the client MVP.

## Local development

```bash
npm ci
npx expo prebuild --platform ios
npm run ios
```

The `start` and `ios` scripts set `EXPO_NO_METRO_WORKSPACE_ROOT=1` so Metro bundles only this app rather than crawling the entire Raft monorepo. Use `npm run ios` for subsequent simulator runs.

`EXPO_PUBLIC_RAFT_API_URL` overrides the API origin. The default is `https://bj1.v.lhb.ink:63204`.

For an isolated test build, the export must use the explicit isolated origin and
the helper rejects missing, different, or production URLs in the generated
bundle:

```bash
EXPO_PUBLIC_RAFT_API_URL=http://127.0.0.1:13074 npm run export:ios:isolated
```

Do not use an old `dist` directory as evidence. The helper exports first and
then checks the fresh output for the isolated origin and absence of the
production origin.

## SignCloud

SignCloud can build this project with `kind=expo` (prebuild + CocoaPods + Xcode) or `kind=simulator` for local Simulator installation. Keep `package-lock.json` committed so dependency caching is reproducible.

## APNs

The app registers its native APNs token through the existing `/api/push/registrations` endpoint. The server must have `APNS_KEY_ID`, `APNS_TEAM_ID`, and `APNS_PRIVATE_KEY` configured, and the bundle identifier must match the Apple App ID/topic. The token and signing files never belong in this repository.
