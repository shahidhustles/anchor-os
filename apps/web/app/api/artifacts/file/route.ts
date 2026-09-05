import { ARTIFACT_MEDIA_TYPES } from "@anchor-os/agent/artifacts";
import { loadManifest, readArtifactBlob } from "@anchor-os/agent/artifact-store";

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const sessionId = params.get("sessionId");
  const path = params.get("path");
  const versionText = params.get("version");

  if (sessionId === null || sessionId.trim() === "" || path === null || path.trim() === "") {
    return Response.json({ error: "sessionId and path are required" }, { status: 400 });
  }

  const manifest = await loadManifest(sessionId);
  const entry = manifest.artifacts[path];
  if (entry === undefined) {
    return Response.json({ error: "artifact not found" }, { status: 404 });
  }

  const version = versionText === null ? entry.version : Number(versionText);
  if (!Number.isInteger(version) || version < 1) {
    return Response.json({ error: "version must be a positive integer" }, { status: 400 });
  }

  const bytes = await readArtifactBlob(sessionId, path, version);
  if (bytes === null) {
    return Response.json({ error: "artifact blob not found" }, { status: 404 });
  }

  return new Response(bytes as unknown as BodyInit, {
    headers: {
      "content-type": ARTIFACT_MEDIA_TYPES[entry.kind],
      "content-disposition": `inline; filename="${encodeURIComponent(path.split("/").pop() ?? "artifact")}"`,
      "cache-control": "no-store",
    },
  });
}
