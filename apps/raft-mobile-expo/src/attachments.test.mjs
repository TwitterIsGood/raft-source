import assert from "node:assert/strict";
import test from "node:test";
import {
  AttachmentValidationError,
  attachmentUrlPath,
  buildAttachmentFormData,
  createAttachmentRequests,
  formatAttachmentSize,
  getAttachmentPreview,
  getAttachmentUploadCapabilities,
  normalizeAttachment,
  normalizePickedAttachment,
  parseLegacyUploadResponse,
  pickAttachments,
  resolveAttachmentUrls,
  uploadAttachments,
  validatePickedAttachments,
} from "./attachments.ts";

const asset = (overrides = {}) => normalizePickedAttachment({
  uri: "file:///tmp/photo%20one.jpg",
  name: "photo one.jpg",
  mimeType: "image/jpeg",
  size: 2048,
  ...overrides,
});

test("picker cancellation is a no-op and assets normalize for React Native", async () => {
  let passedOptions;
  const canceled = await pickAttachments(async (options) => {
    passedOptions = options;
    return { canceled: true, assets: null };
  });
  assert.deepEqual(canceled, []);
  assert.deepEqual(passedOptions, { multiple: true, copyToCacheDirectory: true });

  const picked = await pickAttachments(async () => ({
    canceled: false,
    assets: [{ uri: "file:///tmp/report.pdf?x=1", fileName: "report.pdf", type: "application/pdf" }],
  }));
  assert.deepEqual(picked, [{
    uri: "file:///tmp/report.pdf?x=1",
    name: "report.pdf",
    mimeType: "application/pdf",
    sizeBytes: null,
  }]);
});

test("asset validation rejects empty, oversized, and over-batch selections", () => {
  assert.throws(() => validatePickedAttachments([asset({ size: 0 })]), (error) => {
    assert.ok(error instanceof AttachmentValidationError);
    assert.equal(error.code, "EMPTY_ASSET");
    return true;
  });
  assert.throws(() => validatePickedAttachments([asset({ size: 11 })], { maxBytes: 10 }), (error) => {
    assert.ok(error instanceof AttachmentValidationError);
    assert.equal(error.code, "ATTACHMENT_TOO_LARGE");
    return true;
  });
  assert.throws(() => validatePickedAttachments(Array.from({ length: 11 }, () => asset())), (error) => {
    assert.ok(error instanceof AttachmentValidationError);
    assert.equal(error.code, "ATTACHMENT_COUNT_LIMIT");
    return true;
  });
});

test("legacy form data uses repeated files and channelId without setting a boundary", () => {
  class FakeFormData {
    entries = [];
    append(name, value) { this.entries.push([name, value]); }
  }
  const body = buildAttachmentFormData("channel-1", [asset()], () => new FakeFormData());
  assert.equal(body.entries.length, 2);
  assert.equal(body.entries[0][0], "files");
  assert.deepEqual(body.entries[0][1], {
    uri: "file:///tmp/photo%20one.jpg",
    name: "photo one.jpg",
    type: "image/jpeg",
  });
  assert.deepEqual(body.entries[1], ["channelId", "channel-1"]);
});

test("upload sends the legacy endpoint and parses every returned attachment", async () => {
  const calls = [];
  const uploaded = await uploadAttachments({
    channelId: "channel-1",
    serverId: "server-1",
    assets: [asset()],
    formDataFactory: () => ({ append(name, value) { this.entries ??= []; this.entries.push([name, value]); } }),
    request: async (path, body, options) => {
      calls.push({ path, body, options });
      return {
        attachments: [{
          id: "att-1",
          filename: "photo one.jpg",
          mimeType: "image/jpeg",
          sizeBytes: 2048,
          width: 320,
          height: 200,
          thumbnailUrl: "https://cdn.example/thumb.jpg",
        }],
      };
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/api/attachments/upload");
  assert.equal(calls[0].options.serverId, "server-1");
  assert.equal(calls[0].body.entries[1][1], "channel-1");
  assert.deepEqual(uploaded[0], {
    id: "att-1",
    filename: "photo one.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 2048,
    width: 320,
    height: 200,
    thumbnailUrl: "https://cdn.example/thumb.jpg",
  });
});

test("capabilities and attachment URL helpers keep server limits authoritative", async () => {
  const calls = [];
  const capability = await getAttachmentUploadCapabilities(async (path, options) => {
    calls.push({ path, options });
    return {
      directUploadEnabled: false,
      directUploadThresholdBytes: null,
      maxBytes: 50 * 1024 * 1024,
      sessionExpiresInSeconds: null,
    };
  }, { serverId: "server-1" });
  assert.equal(capability.maxBytes, 50 * 1024 * 1024);
  assert.equal(calls[0].path, "/api/attachments/upload-capabilities");
  assert.equal(calls[0].options.serverId, "server-1");

  const urls = await resolveAttachmentUrls(async (path, options) => {
    calls.push({ path, options });
    return { urls: [{ id: "att-1", url: "https://cdn.example/file.jpg", expiresAt: null }] };
  }, ["att-1", "att-1"], { serverId: "server-1" });
  assert.deepEqual(urls, [{ id: "att-1", url: "https://cdn.example/file.jpg", expiresAt: null }]);
  assert.equal(calls.at(-1).path, "/api/attachments/urls");
  assert.deepEqual(calls.at(-1).options.body, { attachmentIds: ["att-1"] });
  assert.equal(attachmentUrlPath("att/one", "attachment"), "/api/attachments/att%2Fone/url?disposition=attachment");
});

test("preview model classifies media and keeps documents download-only", () => {
  const image = normalizeAttachment({
    id: "att-1",
    filename: "photo.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 2048,
    thumbnailUrl: "https://cdn.example/thumb.jpg",
  });
  assert.deepEqual(getAttachmentPreview(image), {
    kind: "image",
    label: "photo.jpg",
    sizeLabel: "2.0 KB",
    sourceUrl: "https://cdn.example/thumb.jpg",
    canInlinePreview: true,
  });
  const document = normalizeAttachment({ id: "att-2", filename: "notes.txt", mimeType: "text/plain", sizeBytes: 10 });
  assert.equal(getAttachmentPreview(document).kind, "document");
  assert.equal(getAttachmentPreview(document).canInlinePreview, false);
  assert.equal(formatAttachmentSize(1024 * 1024), "1.0 MB");
});

test("malformed upload response is rejected instead of producing an unusable message id", () => {
  assert.throws(() => parseLegacyUploadResponse({ attachments: [{}] }), (error) => {
    assert.ok(error instanceof AttachmentValidationError);
    assert.equal(error.code, "INVALID_UPLOAD_RESPONSE");
    return true;
  });
});

test("request factory authenticates JSON and multipart without a hard-coded multipart boundary", async () => {
  const calls = [];
  let token = "old-token";
  let refreshes = 0;
  const requests = createAttachmentRequests({
    baseUrl: "https://isolated.example/",
    getAccessToken: async () => token,
    refreshAccessToken: async () => {
      refreshes += 1;
      token = "new-token";
      return token;
    },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (calls.length === 1) return new Response(JSON.stringify({ error: "expired" }), { status: 401 });
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  await requests.json("/api/attachments/urls", {
    method: "POST",
    serverId: "server-1",
    body: { attachmentIds: ["att-1"] },
  });
  assert.equal(refreshes, 1);
  assert.equal(calls[1].init.headers.get("Authorization"), "Bearer new-token");
  assert.equal(calls[1].init.headers.get("X-Server-Id"), "server-1");

  const body = new FormData();
  body.append("channelId", "channel-1");
  await requests.multipart("/api/attachments/upload", body, { serverId: "server-1" });
  const multipartHeaders = calls.at(-1).init.headers;
  assert.equal(multipartHeaders.get("Content-Type"), null);
  assert.equal(multipartHeaders.get("X-Server-Id"), "server-1");
});
