// Client-side HLS -> MP4 download for a call recording (runly.chat), with
// NO server-side transcoding involved. The .ts segments LiveKit's Egress
// produces are already H.264/AAC — the same codecs an MP4 container uses —
// so turning them into one downloadable file is a lossless container remux
// (`-c copy`, no re-encoding), not real transcoding. That's cheap enough to
// run entirely in the browser via ffmpeg.wasm, using the viewer's own CPU
// instead of the server's, even for an hour-plus recording.
//
// `manifestUrl` is the blob: URL AdvancedFileViewer already resolved for
// playback (ChatRecordingsGallery.jsx) — it wraps the rewritten HLS manifest
// where every segment line is already its own absolute signed URL (see
// call-recording-service.js's signManifestSegments), so re-fetching it here
// costs nothing extra and needs no new plumbing between the two.
//
// ffmpeg.wasm's core (~30MB, self-hosted under /ffmpeg/ — see
// apps/desktop/public/ffmpeg/, populated by apps/desktop's postinstall
// script from the @ffmpeg/core package, never committed to git) is only
// fetched the first time this actually runs.
export async function downloadHlsAsMp4(manifestUrl, filename) {
  const [{ FFmpeg }, { fetchFile, toBlobURL }] = await Promise.all([
    import("@ffmpeg/ffmpeg"),
    import("@ffmpeg/util"),
  ]);

  const manifestText = await (await fetch(manifestUrl)).text();
  const segmentUrls = manifestText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  if (!segmentUrls.length) throw new Error("El manifiesto no tiene segmentos de video.");

  const ffmpeg = new FFmpeg();
  // import.meta.env.BASE_URL reflects the consuming app's actual Vite base
  // (e.g. "/app/" in production, "/" in dev) — resolved at apps/desktop's
  // build time even though this module lives in @runly/ui.
  const base = `${import.meta.env.BASE_URL}ffmpeg/`;
  await ffmpeg.load({
    coreURL: await toBlobURL(`${base}ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${base}ffmpeg-core.wasm`, "application/wasm"),
  });

  try {
    const segmentNames = [];
    for (let i = 0; i < segmentUrls.length; i += 1) {
      const name = `seg_${String(i).padStart(5, "0")}.ts`;
      // eslint-disable-next-line no-await-in-loop -- segments must land in
      // ffmpeg's virtual FS before exec(), and writeFile has no bulk form.
      await ffmpeg.writeFile(name, await fetchFile(segmentUrls[i]));
      segmentNames.push(name);
    }

    // The concat demuxer (not the `concat:` protocol) is ffmpeg's documented
    // way to losslessly join same-codec segments — safe here since they're
    // all one continuous recording from a single egress session.
    const listContent = segmentNames.map((name) => `file '${name}'`).join("\n");
    await ffmpeg.writeFile("concat_list.txt", new TextEncoder().encode(listContent));

    const outputName = "output.mp4";
    const code = await ffmpeg.exec(["-f", "concat", "-safe", "0", "-i", "concat_list.txt", "-c", "copy", outputName]);
    if (code !== 0) throw new Error("ffmpeg no pudo generar el archivo MP4.");

    const data = await ffmpeg.readFile(outputName);
    const blob = new Blob([data], { type: "video/mp4" });
    const blobUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = blobUrl;
    anchor.download = filename.toLowerCase().endsWith(".mp4") ? filename : `${filename}.mp4`;
    anchor.click();
    URL.revokeObjectURL(blobUrl);
  } finally {
    ffmpeg.terminate();
  }
}
