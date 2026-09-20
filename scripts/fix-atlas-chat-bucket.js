#!/usr/bin/env node
// One-time script: (re)apply the atlas-chat Supabase bucket's allowed MIME
// types + file size limit.
//
// NOTE (2026-09-10): tried raising fileSizeLimit past 50MB here (to match a
// higher audio/video ceiling in chat-attachments-service.js) and Supabase
// Storage rejected it with "The object exceeded the maximum allowed size" —
// the SELF-HOSTED STORAGE SERVICE has its own global upload ceiling (the
// `FILE_SIZE_LIMIT` env var on the storage container in the VPS
// docker-compose stack, commonly defaulted to 50MB) that no per-bucket
// setting can exceed. Raising real video-upload capacity requires bumping
// that env var and restarting the storage container on the VPS — not
// something this script (or a client-side setting) can do. Left the app-level
// check (chat-attachments-service.js) at 50MB to match, so the failure the
// user sees is the friendly 422 ("Archivo demasiado grande") instead of a
// confusing raw storage error.
//
// Run: node scripts/fix-atlas-chat-bucket.js
import { readFileSync } from "fs";
import { createClient } from "../node_modules/.pnpm/node_modules/@supabase/supabase-js/dist/index.mjs";

const envRaw = readFileSync(new URL("../.env", import.meta.url), "utf-8");
const env = {};
for (const line of envRaw.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const idx = trimmed.indexOf("=");
  if (idx === -1) continue;
  env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
}

const supabaseUrl = env.SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);

const { data, error } = await supabase.storage.updateBucket("atlas-chat", {
  fileSizeLimit: "50MB",
  allowedMimeTypes: [
    "image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml",
    "audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/aac",
    "video/mp4", "video/webm", "video/ogg", "video/quicktime",
    "application/pdf",
    "text/plain",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "application/zip",
    "application/x-zip-compressed",
  ],
});

if (error) {
  console.error("Error updating bucket:", error.message);
  process.exit(1);
}

console.log("atlas-chat bucket MIME types / size limit reapplied (50MB).");
