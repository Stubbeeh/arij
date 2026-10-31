import { deleteAttachment, readAttachmentFile } from "@/server/services/attachments";
import { handle, idFrom } from "@/server/http";

type Ctx = { params: Promise<{ key: string; attachmentId: string }> };

export const runtime = "nodejs";

export const GET = async (_req: Request, { params }: Ctx) => {
  try {
    const { key, attachmentId } = await params;
    const file = await readAttachmentFile(key, idFrom(attachmentId));
    const fallbackName = file.filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    const encodedName = encodeURIComponent(file.filename).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodedName}`,
        "Content-Length": String(file.bytes.byteLength),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return handle(async () => {
      throw error;
    })();
  }
};

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  const { key, attachmentId } = await params;
  await deleteAttachment(key, idFrom(attachmentId));
});