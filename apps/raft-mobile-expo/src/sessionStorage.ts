export type SecureStorage = {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
};

export function createSessionStorage(secure: SecureStorage, isolatedSimulator: boolean) {
  let access: string | null = null;
  let refresh: string | null = null;
  // Serialize SecureStore mutations.  A logout can happen while a login
  // request is still settling; queueing makes clear run after that pending
  // write instead of allowing a late write to resurrect the session.
  let secureQueue: Promise<void> = Promise.resolve();
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = secureQueue.then(operation, operation);
    secureQueue = result.then(() => undefined, () => undefined);
    return result;
  };

  return {
    async read(accessKey: string, refreshKey: string) {
      if (isolatedSimulator) return { accessToken: access, refreshToken: refresh };
      const { accessToken, refreshToken } = await enqueue(async () => {
        const [accessToken, refreshToken] = await Promise.all([
          secure.getItemAsync(accessKey), secure.getItemAsync(refreshKey),
        ]);
        return { accessToken, refreshToken };
      });
      return { accessToken, refreshToken };
    },
    async save(accessKey: string, refreshKey: string, accessToken: string, refreshToken: string) {
      if (isolatedSimulator) { access = accessToken; refresh = refreshToken; return; }
      await enqueue(() => Promise.all([
        secure.setItemAsync(accessKey, accessToken),
        secure.setItemAsync(refreshKey, refreshToken),
      ]).then(() => undefined));
    },
    async clear(accessKey: string, refreshKey: string) {
      if (isolatedSimulator) { access = null; refresh = null; return; }
      await enqueue(() => Promise.all([
        secure.deleteItemAsync(accessKey), secure.deleteItemAsync(refreshKey),
      ]).then(() => undefined));
    },
  };
}
