export type SecureStorage = {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
};

type SaveGuard = () => boolean;

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
  const settlePair = async <T>(operations: [Promise<T>, Promise<T>]): Promise<[T, T]> => {
    const settled = await Promise.allSettled(operations);
    const rejected = settled.find((item): item is PromiseRejectedResult => item.status === "rejected");
    if (rejected) throw rejected.reason;
    const fulfilled = settled as [PromiseFulfilledResult<T>, PromiseFulfilledResult<T>];
    return [fulfilled[0].value, fulfilled[1].value];
  };

  return {
    async read(accessKey: string, refreshKey: string) {
      if (isolatedSimulator) return { accessToken: access, refreshToken: refresh };
      const { accessToken, refreshToken } = await enqueue(async () => {
        const [accessToken, refreshToken] = await settlePair([
          secure.getItemAsync(accessKey), secure.getItemAsync(refreshKey),
        ]);
        return { accessToken, refreshToken };
      });
      return { accessToken, refreshToken };
    },
    async save(accessKey: string, refreshKey: string, accessToken: string, refreshToken: string, guard?: SaveGuard) {
      if (isolatedSimulator) { if (guard?.() === false) return; access = accessToken; refresh = refreshToken; return; }
      await enqueue(async () => {
        if (guard?.() === false) return;
        await settlePair([
          secure.setItemAsync(accessKey, accessToken),
          secure.setItemAsync(refreshKey, refreshToken),
        ]);
        // If the request became stale while SecureStore was writing, clear
        // inside this queue slot. A newer save queued after us then runs next.
        if (guard?.() === false) await settlePair([
          secure.deleteItemAsync(accessKey),
          secure.deleteItemAsync(refreshKey),
        ]);
      });
    },
    async clear(accessKey: string, refreshKey: string) {
      if (isolatedSimulator) { access = null; refresh = null; return; }
      await enqueue(() => settlePair([
        secure.deleteItemAsync(accessKey), secure.deleteItemAsync(refreshKey),
      ]).then(() => undefined));
    },
  };
}
