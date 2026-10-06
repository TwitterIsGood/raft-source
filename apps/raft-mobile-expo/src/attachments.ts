/**
 * Attachment primitives for the Expo client.
 *
 * This module deliberately has no dependency on a native picker package. Expo
 * apps can pass the result of expo-document-picker (or a camera/gallery
 * adapter) to `normalizePickedAttachment` and `pickAttachments`. Keeping the
 * picker boundary injected makes the upload and preview contracts testable in
 * Node and avoids making a native module a transitive requirement for the
 * login/message-only build.
 *
 * Server contract (v0):
 *   POST /api/attachments/upload (multipart: repeated `files` + `channelId`)
 *     -> { attachments: Attachment[] }
 *   GET  /api/attachments/upload-capabilities
 *   POST /api/attachments/urls ({ attachmentIds }) -> { urls }
 *   GET  /api/attachments/:id/url?disposition=inline|attachment
 *
 * Direct upload sessions are intentionally represented by the capability types
 * but not used by this first mobile adapter. The isolated/mobile server may
 * advertise direct uploads independently; the legacy multipart route remains
 * the safe fallback and is the route this module sends today.
 */

export const DEFAULT_ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_UPLOAD = 10;
export const MAX_ATTACHMENT_URL_BATCH = 50;

export type AttachmentMimeType = string | null;

export type Attachment = {
  id: string;
  filename: string;
  mimeType: AttachmentMimeType;
  sizeBytes: number;
  width?: number | null;
  height?: number | null;
  thumbnailUrl?: string | null;
  rasterPreviewUrl?: string | null;
  commentCount?: number;
};

export type PickedAttachment = {
  /** Local URI understood by React Native's multipart FormData adapter. */
  uri: string;
  name: string;
  mimeType: string;
  sizeBytes: number | null;
  width?: number | null;
  height?: number | null;
};

export type PickerAssetLike = Readonly<{
  uri?: unknown;
  name?: unknown;
  fileName?: unknown;
  mimeType?: unknown;
  type?: unknown;
  size?: unknown;
  width?: unknown;
  height?: unknown;
}>;

export type PickerResultLike = Readonly<{
  canceled?: unknown;
  assets?: readonly PickerAssetLike[] | null;
}>;

export type AttachmentPicker = (
  options: Readonly<{
    multiple: boolean;
    copyToCacheDirectory: boolean;
    mimeTypes?: readonly string[];
  }>,
) => Promise<PickerResultLike>;

export type AttachmentUploadCapabilities = Readonly<{
  directUploadEnabled: boolean;
  directUploadThresholdBytes: number | null;
  maxBytes: number;
  sessionExpiresInSeconds: number | null;
}>;

export type AttachmentUrl = Readonly<{
  id: string;
  url: string;
  expiresAt?: string | null;
}>;

export type AttachmentJsonRequestOptions = Readonly<{
  method?: "GET" | "POST";
  body?: unknown;
  serverId?: string;
  signal?: AbortSignal;
}>;

export type AttachmentJsonRequest = <T = unknown>(
  path: string,
  options?: AttachmentJsonRequestOptions,
) => Promise<T>;

export type AttachmentMultipartRequestOptions = Readonly<{
  serverId?: string;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
}>;

export type AttachmentMultipartRequest = <T = unknown>(
  path: string,
  body: FormData,
  options?: AttachmentMultipartRequestOptions,
) => Promise<T>;

export type AttachmentRequestFactoryOptions = Readonly<{
  /** API origin, e.g. EXPO_PUBLIC_RAFT_API_URL. A path is appended below. */
  baseUrl: string;
  getAccessToken: () => Promise<string | null>;
  /** Optional one-shot refresh used after a 401. */
  refreshAccessToken?: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
}>;

export type AttachmentRequests = Readonly<{
  json: AttachmentJsonRequest;
  multipart: AttachmentMultipartRequest;
}>;

export class AttachmentValidationError extends Error {
  public readonly code:
    | "INVALID_ASSET"
    | "EMPTY_ASSET"
    | "ATTACHMENT_TOO_LARGE"
    | "ATTACHMENT_COUNT_LIMIT"
    | "INVALID_UPLOAD_RESPONSE"
    | "INVALID_ATTACHMENT_ID";

  constructor(
    code:
      | "INVALID_ASSET"
      | "EMPTY_ASSET"
      | "ATTACHMENT_TOO_LARGE"
      | "ATTACHMENT_COUNT_LIMIT"
      | "INVALID_UPLOAD_RESPONSE"
      | "INVALID_ATTACHMENT_ID",
    message: string,
  ) {
    super(message);
    this.name = "AttachmentValidationError";
    this.code = code;
  }
}

export class AttachmentRequestError extends Error {
  public readonly status: number;
  public readonly body: unknown;

  constructor(status: number, body: unknown) {
    const message = isRecord(body) && typeof body.message === "string"
      ? body.message
      : isRecord(body) && typeof body.error === "string"
        ? body.error
        : `附件请求失败（HTTP ${status}）`;
    super(message);
    this.name = "AttachmentRequestError";
    this.status = status;
    this.body = body;
  }
}

function stringValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function filenameFromUri(uri: string): string {
  const withoutQuery = uri.split(/[?#]/u, 1)[0] ?? uri;
  const segment = withoutQuery.split("/").pop() || "attachment";
  try {
    return decodeURIComponent(segment) || "attachment";
  } catch {
    return segment || "attachment";
  }
}

function normalizeMimeType(value: unknown): string {
  const normalized = stringValue(value)?.split(";", 1)[0]?.trim().toLowerCase();
  return normalized || "application/octet-stream";
}

/** Convert a native picker asset into the small shape the upload adapter uses. */
export function normalizePickedAttachment(asset: PickerAssetLike): PickedAttachment {
  const uri = stringValue(asset.uri);
  if (!uri) {
    throw new AttachmentValidationError("INVALID_ASSET", "附件缺少可读取的本地 URI。");
  }
  const name = stringValue(asset.name) || stringValue(asset.fileName) || filenameFromUri(uri);
  const size = numberValue(asset.size);
  const width = numberValue(asset.width);
  const height = numberValue(asset.height);
  return {
    uri,
    name: name.slice(0, 255),
    mimeType: normalizeMimeType(asset.mimeType ?? asset.type),
    sizeBytes: size === null ? null : Math.max(0, Math.floor(size)),
    ...(width === null ? {} : { width }),
    ...(height === null ? {} : { height }),
  };
}

/**
 * Picker boundary shared by document, image, and camera adapters.
 * Canceled picker results resolve to an empty list and never become errors.
 */
export async function pickAttachments(
  picker: AttachmentPicker,
  options: Readonly<{ multiple?: boolean; mimeTypes?: readonly string[] }> = {},
): Promise<PickedAttachment[]> {
  const result = await picker({
    multiple: options.multiple ?? true,
    copyToCacheDirectory: true,
    ...(options.mimeTypes ? { mimeTypes: options.mimeTypes } : {}),
  });
  if (result.canceled === true || !result.assets || result.assets.length === 0) return [];
  return result.assets.map(normalizePickedAttachment);
}

export function validatePickedAttachment(
  asset: PickedAttachment,
  maxBytes = DEFAULT_ATTACHMENT_MAX_BYTES,
): void {
  if (!asset.uri || !asset.name) {
    throw new AttachmentValidationError("INVALID_ASSET", "附件缺少文件名或本地 URI。");
  }
  if (asset.sizeBytes === 0) {
    throw new AttachmentValidationError("EMPTY_ASSET", `附件为空：${asset.name}`);
  }
  if (asset.sizeBytes !== null && asset.sizeBytes > maxBytes) {
    throw new AttachmentValidationError(
      "ATTACHMENT_TOO_LARGE",
      `附件超过服务器限制（${formatAttachmentSize(maxBytes)}）：${asset.name}`,
    );
  }
}

export function validatePickedAttachments(
  assets: readonly PickedAttachment[],
  options: Readonly<{ maxBytes?: number; maxCount?: number }> = {},
): void {
  const maxCount = options.maxCount ?? MAX_ATTACHMENTS_PER_UPLOAD;
  if (assets.length > maxCount) {
    throw new AttachmentValidationError(
      "ATTACHMENT_COUNT_LIMIT",
      `一次最多选择 ${maxCount} 个附件。`,
    );
  }
  for (const asset of assets) validatePickedAttachment(asset, options.maxBytes ?? DEFAULT_ATTACHMENT_MAX_BYTES);
}

/**
 * Build the React Native multipart body used by POST /api/attachments/upload.
 * Do not set Content-Type manually when sending this body: fetch must add the
 * multipart boundary. The `files` field is intentionally plural, matching the
 * server's multer route and the Web composer.
 */
export function buildAttachmentFormData(
  channelId: string,
  assets: readonly PickedAttachment[],
  formDataFactory: () => FormData = () => new FormData(),
): FormData {
  if (!stringValue(channelId)) {
    throw new AttachmentValidationError("INVALID_ASSET", "上传附件需要频道 ID。");
  }
  validatePickedAttachments(assets);
  const form = formDataFactory();
  for (const asset of assets) {
    // React Native accepts this object shape for a multipart file part. It is
    // not a browser File and therefore must stay behind this adapter boundary.
    form.append("files", {
      uri: asset.uri,
      name: asset.name,
      type: asset.mimeType,
    } as unknown as Blob);
  }
  form.append("channelId", channelId);
  return form;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function responseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text || null;
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  const normalized = stringValue(baseUrl);
  if (!normalized) throw new AttachmentValidationError("INVALID_ASSET", "附件请求缺少 API 地址。");
  return normalized.replace(/\/$/u, "");
}

/**
 * Build the authenticated request functions used by upload and URL helpers.
 * This keeps token refresh in the existing mobile session layer's caller and
 * avoids duplicating an auth token in a picker asset or signed object URL.
 */
export function createAttachmentRequests(options: AttachmentRequestFactoryOptions): AttachmentRequests {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = normalizeBaseUrl(options.baseUrl);

  const request = async <T>(path: string, init: RequestInit, retry = true): Promise<T> => {
    const headers = new Headers(init.headers);
    const token = await options.getAccessToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (init.body instanceof FormData) {
      // Let fetch add the multipart boundary. Setting application/json here is
      // a subtle failure mode on React Native and yields an empty multer body.
      headers.delete("Content-Type");
    } else if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    const response = await fetchImpl(`${baseUrl}${path}`, { ...init, headers });
    if (response.status === 401 && retry && options.refreshAccessToken) {
      const refreshed = await options.refreshAccessToken();
      if (refreshed) return request<T>(path, init, false);
    }
    if (!response.ok) throw new AttachmentRequestError(response.status, await responseBody(response));
    if (response.status === 204) return undefined as T;
    return await responseBody(response) as T;
  };

  const json: AttachmentJsonRequest = async <T = unknown>(path: string, init: AttachmentJsonRequestOptions = {}) => request<T>(path, {
      method: init.method ?? "GET",
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      headers: {
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(init.serverId ? { "X-Server-Id": init.serverId } : {}),
      },
      signal: init.signal,
    });
  const multipart: AttachmentMultipartRequest = async <T = unknown>(path: string, body: FormData, init: AttachmentMultipartRequestOptions = {}) => request<T>(path, {
      method: "POST",
      body,
      signal: init.signal,
      headers: init.serverId ? { "X-Server-Id": init.serverId } : undefined,
    });
  return {
    json,
    multipart,
  };
}

/** Normalize one server attachment while keeping optional message-enrichment fields. */
export function normalizeAttachment(value: unknown): Attachment {
  if (!isRecord(value)) {
    throw new AttachmentValidationError("INVALID_UPLOAD_RESPONSE", "服务器返回了无效附件。");
  }
  const id = stringValue(value.id);
  const filename = stringValue(value.filename);
  const sizeBytes = numberValue(value.sizeBytes);
  if (!id || !filename || sizeBytes === null || sizeBytes < 0) {
    throw new AttachmentValidationError("INVALID_UPLOAD_RESPONSE", "服务器返回的附件字段不完整。");
  }
  const mimeType = value.mimeType === null ? null : normalizeMimeType(value.mimeType);
  const optionalNumber = (key: string) => {
    const parsed = numberValue(value[key]);
    return parsed === null ? undefined : parsed;
  };
  const optionalUrl = (key: string) => {
    const parsed = stringValue(value[key]);
    return parsed ?? null;
  };
  return {
    id,
    filename,
    mimeType,
    sizeBytes: Math.floor(sizeBytes),
    ...(optionalNumber("width") === undefined ? {} : { width: optionalNumber("width") }),
    ...(optionalNumber("height") === undefined ? {} : { height: optionalNumber("height") }),
    ...(value.thumbnailUrl === undefined ? {} : { thumbnailUrl: optionalUrl("thumbnailUrl") }),
    ...(value.rasterPreviewUrl === undefined ? {} : { rasterPreviewUrl: optionalUrl("rasterPreviewUrl") }),
    ...(optionalNumber("commentCount") === undefined ? {} : { commentCount: optionalNumber("commentCount") }),
  };
}

export function parseLegacyUploadResponse(value: unknown): Attachment[] {
  if (!isRecord(value) || !Array.isArray(value.attachments)) {
    throw new AttachmentValidationError("INVALID_UPLOAD_RESPONSE", "上传响应未包含附件列表。");
  }
  return value.attachments.map(normalizeAttachment);
}

/** Upload one selection batch via the server's stable multipart endpoint. */
export async function uploadAttachments(options: Readonly<{
  channelId: string;
  assets: readonly PickedAttachment[];
  request: AttachmentMultipartRequest;
  serverId?: string;
  signal?: AbortSignal;
  maxBytes?: number;
  maxCount?: number;
  formDataFactory?: () => FormData;
  onProgress?: (progress: number) => void;
}>): Promise<Attachment[]> {
  validatePickedAttachments(options.assets, {
    maxBytes: options.maxBytes ?? DEFAULT_ATTACHMENT_MAX_BYTES,
    maxCount: options.maxCount ?? MAX_ATTACHMENTS_PER_UPLOAD,
  });
  const body = buildAttachmentFormData(options.channelId, options.assets, options.formDataFactory);
  const response = await options.request("/api/attachments/upload", body, {
    ...(options.serverId ? { serverId: options.serverId } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
  });
  return parseLegacyUploadResponse(response);
}

export function parseUploadCapabilities(value: unknown): AttachmentUploadCapabilities {
  if (!isRecord(value)) throw new AttachmentValidationError("INVALID_UPLOAD_RESPONSE", "服务器返回了无效上传能力。");
  const maxBytes = numberValue(value.maxBytes);
  if (typeof value.directUploadEnabled !== "boolean" || maxBytes === null || maxBytes <= 0) {
    throw new AttachmentValidationError("INVALID_UPLOAD_RESPONSE", "服务器返回的上传能力字段不完整。");
  }
  const threshold = numberValue(value.directUploadThresholdBytes);
  const expires = numberValue(value.sessionExpiresInSeconds);
  return {
    directUploadEnabled: value.directUploadEnabled,
    directUploadThresholdBytes: threshold === null ? null : Math.floor(threshold),
    maxBytes: Math.floor(maxBytes),
    sessionExpiresInSeconds: expires === null ? null : Math.floor(expires),
  };
}

export async function getAttachmentUploadCapabilities(
  request: AttachmentJsonRequest,
  options: Readonly<{ serverId?: string; signal?: AbortSignal }> = {},
): Promise<AttachmentUploadCapabilities> {
  try {
    const value = await request("/api/attachments/upload-capabilities", {
      method: "GET",
      ...(options.serverId ? { serverId: options.serverId } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return parseUploadCapabilities(value);
  } catch (error) {
    // Older isolated servers predate the capability route. Match the Web
    // client fallback: direct upload is disabled, while legacy multipart uses
    // the conservative free-plan ceiling.
    if (error instanceof AttachmentRequestError && error.status === 404) {
      return {
        directUploadEnabled: false,
        directUploadThresholdBytes: null,
        maxBytes: DEFAULT_ATTACHMENT_MAX_BYTES,
        sessionExpiresInSeconds: null,
      };
    }
    throw error;
  }
}

export async function resolveAttachmentUrls(
  request: AttachmentJsonRequest,
  attachmentIds: readonly string[],
  options: Readonly<{ serverId?: string; signal?: AbortSignal }> = {},
): Promise<AttachmentUrl[]> {
  const ids = [...new Set(attachmentIds.map((id) => stringValue(id)).filter((id): id is string => Boolean(id)))];
  if (ids.length === 0 || ids.length > MAX_ATTACHMENT_URL_BATCH) {
    throw new AttachmentValidationError("INVALID_ATTACHMENT_ID", `附件 URL 一次支持 1-${MAX_ATTACHMENT_URL_BATCH} 个 ID。`);
  }
  const value = await request<{ urls?: unknown }>("/api/attachments/urls", {
    method: "POST",
    body: { attachmentIds: ids },
    ...(options.serverId ? { serverId: options.serverId } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!isRecord(value) || !Array.isArray(value.urls)) {
    throw new AttachmentValidationError("INVALID_UPLOAD_RESPONSE", "服务器返回了无效附件 URL 列表。");
  }
  return value.urls.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const id = stringValue(entry.id);
    const url = stringValue(entry.url);
    return id && url ? [{ id, url, expiresAt: stringValue(entry.expiresAt) }] : [];
  });
}

export function attachmentUrlPath(id: string, disposition: "inline" | "attachment" = "inline"): string {
  const normalized = stringValue(id);
  if (!normalized) throw new AttachmentValidationError("INVALID_ATTACHMENT_ID", "缺少附件 ID。");
  return `/api/attachments/${encodeURIComponent(normalized)}/url?disposition=${disposition}`;
}

export type AttachmentPreviewKind = "image" | "video" | "audio" | "document";

export type AttachmentPreview = Readonly<{
  kind: AttachmentPreviewKind;
  label: string;
  sizeLabel: string;
  sourceUrl: string | null;
  canInlinePreview: boolean;
}>;

function previewKind(mimeType: string | null): AttachmentPreviewKind {
  if (mimeType?.startsWith("image/")) return "image";
  if (mimeType?.startsWith("video/")) return "video";
  if (mimeType?.startsWith("audio/")) return "audio";
  return "document";
}

/** Map a server attachment to display-safe metadata without rendering UI. */
export function getAttachmentPreview(
  attachment: Attachment,
  resolvedUrl?: string | null,
): AttachmentPreview {
  const kind = previewKind(attachment.mimeType);
  const sourceUrl = stringValue(resolvedUrl)
    || (kind === "image" ? stringValue(attachment.thumbnailUrl) || stringValue(attachment.rasterPreviewUrl) : null);
  return {
    kind,
    label: attachment.filename,
    sizeLabel: formatAttachmentSize(attachment.sizeBytes),
    sourceUrl,
    canInlinePreview: kind !== "document" && Boolean(sourceUrl),
  };
}

export function formatAttachmentSize(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) return "0 B";
  if (sizeBytes < 1024) return `${Math.floor(sizeBytes)} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  if (sizeBytes < 1024 * 1024 * 1024) return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(sizeBytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
