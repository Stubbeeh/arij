import { addFileAttachment, addLinkAttachment, listTicketAttachments, MAX_ATTACHMENT_SIZE } from "@/server/services/attachments";
import { ApiError, handle } from "@/server/http";
import { attachmentLinkInput } from "@/shared/types";

type Ctx = { params: Promise<{ key: string }> };

export const runtime = "nodejs";

export const GET = handle(async (_req: Request, { params }: Ctx) => listTicketAttachments((await params).key));

export const POST = handle(async (req: Request, { params }: Ctx) => {
  const key = (await params).key;
  const contentType = req.headers.get("content-type")?.split(";", 1)[0].toLowerCase();
  if (contentType === "multipart/form-data") {
    const length = Number(req.headers.get("content-length"));
    if (Number.isFinite(length) && length > MAX_ATTACHMENT_SIZE + 128 * 1024) {
      throw new ApiError(413, "Attachments must be 25 MB or smaller");
    }
    const form = await req.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") throw new ApiError(400, "A file is required");
    const label = form.get("label");
    if (label !== null && typeof label !== "string") throw new ApiError(400, "Attachment label must be text");
    if (file.size > MAX_ATTACHMENT_SIZE) throw new ApiError(413, "Attachments must be 25 MB or smaller");
    return addFileAttachment(key, {
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      size: file.size,
      bytes: new Uint8Array(await file.arrayBuffer()),
      label: label ?? undefined,
    });
  }
  if (contentType !== "application/json") throw new ApiError(415, "Use JSON for links or multipart form data for files");
  return addLinkAttachment(key, attachmentLinkInput.parse(await req.json()));
});