import assert from "node:assert/strict";
import test from "node:test";
import { ApiClient } from "../../../lib/api/client";
import { MEDIA_PAGE_SIZE, confirmDocumentUpload, createDocumentUploadIntent, createVideoUploadIntent, listDocuments, listVideos } from "./media-service";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const DOCUMENT_ID = "22222222-2222-4222-8222-222222222222";

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

test("requests the document list with a bounded limit/offset - never unbounded", async () => {
  let requestedUrl = "";
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async (input) => {
      requestedUrl = String(input);
      return json({ items: [], limit: MEDIA_PAGE_SIZE, offset: 20, hasMore: false });
    },
  });

  await listDocuments(api, TENANT_ID, 20);

  assert.equal(requestedUrl, `http://api.test/instructor/tenants/${TENANT_ID}/media/documents?limit=${MEDIA_PAGE_SIZE}&offset=20`);
});

test("requests the video list with a bounded limit/offset - never unbounded", async () => {
  let requestedUrl = "";
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async (input) => {
      requestedUrl = String(input);
      return json({ items: [], limit: MEDIA_PAGE_SIZE, offset: 0, hasMore: false });
    },
  });

  await listVideos(api, TENANT_ID, 0);

  assert.equal(requestedUrl, `http://api.test/instructor/tenants/${TENANT_ID}/media/videos?limit=${MEDIA_PAGE_SIZE}&offset=0`);
});

test("passes list responses through verbatim - no total/page-count field is ever added", async () => {
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async () => json({ items: [{ documentAssetId: "d1" }], limit: 20, offset: 0, hasMore: true }),
  });

  const response = await listDocuments(api, TENANT_ID, 0);

  assert.deepEqual(Object.keys(response).sort(), ["hasMore", "items", "limit", "offset"]);
});

test("creates a document upload intent with exactly the declared file fields - no client-supplied documentAssetId/tenantId/storage key", async () => {
  let method = "";
  let requestUrl = "";
  let requestBody: unknown;
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async (input, init) => {
      requestUrl = String(input);
      method = init?.method ?? "";
      requestBody = init?.body ? JSON.parse(String(init.body)) : undefined;
      return json({ documentAssetId: DOCUMENT_ID, uploadUrl: "https://r2.example/upload", expiresAt: "2026-01-01T00:00:00.000Z", headers: {} });
    },
  });

  await createDocumentUploadIntent(api, TENANT_ID, { fileName: "syllabus.pdf", mimeType: "application/pdf", fileSizeBytes: 1024 });

  assert.equal(method, "POST");
  assert.equal(requestUrl, `http://api.test/instructor/tenants/${TENANT_ID}/media/documents/upload-intents`);
  assert.deepEqual(requestBody, { fileName: "syllabus.pdf", mimeType: "application/pdf", fileSizeBytes: 1024 });
});

test("creates a video upload intent with exactly the declared title - no client-supplied videoAssetId/provider identity", async () => {
  let method = "";
  let requestUrl = "";
  let requestBody: unknown;
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async (input, init) => {
      requestUrl = String(input);
      method = init?.method ?? "";
      requestBody = init?.body ? JSON.parse(String(init.body)) : undefined;
      return json({
        videoAssetId: "v1",
        tusEndpoint: "https://video.bunnycdn.com/tusupload",
        expiresAt: "2026-01-01T00:00:00.000Z",
        headers: { AuthorizationSignature: "sig", AuthorizationExpire: "1", VideoId: "v1", LibraryId: "lib1" },
        provider: { bunnyStream: { libraryId: "lib1", videoId: "v1" } },
      });
    },
  });

  await createVideoUploadIntent(api, TENANT_ID, { title: "Week 1 lecture" });

  assert.equal(method, "POST");
  assert.equal(requestUrl, `http://api.test/instructor/tenants/${TENANT_ID}/media/videos/upload-intents`);
  assert.deepEqual(requestBody, { title: "Week 1 lecture" });
});

test("confirms a document upload via POST with no request body, scoped to the exact documentAssetId", async () => {
  let method = "";
  let requestUrl = "";
  let requestBody: unknown = "unset";
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async (input, init) => {
      requestUrl = String(input);
      method = init?.method ?? "";
      requestBody = init?.body;
      return json({ documentAssetId: DOCUMENT_ID, processingStatus: "READY", fileName: "syllabus.pdf", mimeType: "application/pdf", fileSizeBytes: "1024", verifiedAt: "2026-01-01T00:00:00.000Z" });
    },
  });

  await confirmDocumentUpload(api, TENANT_ID, DOCUMENT_ID);

  assert.equal(method, "POST");
  assert.equal(requestUrl, `http://api.test/instructor/tenants/${TENANT_ID}/media/documents/${DOCUMENT_ID}/confirm-upload`);
  assert.equal(requestBody, undefined);
});
