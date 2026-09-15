import test from "node:test";
import assert from "node:assert/strict";
import { resolveAttachmentFileType } from "../useAttachmentsController.js";

test("resolveAttachmentFileType recognizes video mime types as a distinct kind", () => {
  assert.equal(resolveAttachmentFileType({ mimeType: "video/mp4", fileName: "clip.mp4" }).kind, "video");
  assert.equal(resolveAttachmentFileType({ mimeType: "video/quicktime", fileName: "clip.mov" }).kind, "video");
});

test("resolveAttachmentFileType still recognizes images and falls back to file", () => {
  assert.equal(resolveAttachmentFileType({ mimeType: "image/png", fileName: "a.png" }).kind, "image");
  assert.equal(resolveAttachmentFileType({ mimeType: "application/pdf", fileName: "a.pdf" }).kind, "pdf");
  assert.equal(resolveAttachmentFileType({ mimeType: "application/octet-stream", fileName: "a.bin" }).kind, "file");
});
