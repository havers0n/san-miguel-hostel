import { Storage } from "@google-cloud/storage";

export type GcsStore = {
  get: (objectName: string) => Promise<string | null>;
  putIfAbsent: (objectName: string, bodyText: string) => Promise<"created" | "exists">;
};

export function makeKey(opts: {
  prefix: string;
  promptVersion: string;
  requestId: string;
}): string {
  // Keep keys filesystem-like for browsing. Encode components to avoid surprises with ':' etc.
  const p = opts.prefix.replace(/^\/+|\/+$/g, "");
  const pv = encodeURIComponent(opts.promptVersion);
  const rid = encodeURIComponent(opts.requestId);
  return `${p}/${pv}/${rid}.json`;
}

export function makeGcsStore(opts: { bucket: string }): GcsStore {
  const storage = new Storage();
  const bucket = storage.bucket(opts.bucket);

  return {
    async get(objectName) {
      const file = bucket.file(objectName);
      try {
        const [exists] = await file.exists();
        if (!exists) return null;
        const [buf] = await file.download();
        return buf.toString("utf8");
      } catch (err) {
        // Surface as a server error; caller decides how to respond.
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`gcs_get_failed: ${msg}`);
      }
    },

    async putIfAbsent(objectName, bodyText) {
      const file = bucket.file(objectName);
      try {
        await file.save(bodyText, {
          contentType: "application/json",
          resumable: false,
          preconditionOpts: { ifGenerationMatch: 0 },
        });
        return "created";
      } catch (err: any) {
        // 412 Precondition Failed => object already exists (race winner).
        const code = (err as any)?.code;
        if (code === 412) return "exists";
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`gcs_put_failed: ${msg}`);
      }
    },
  };
}


