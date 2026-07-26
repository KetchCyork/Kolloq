import type { ChatAttachment } from "@newvector/core";
import { randomId } from "./utils";

/** Browsers cap File.webkitRelativePath but not File.name, so anything past this is rejected up front instead of bloating IndexedDB. */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export interface AttachmentRejection {
  name: string;
  reason: string;
}

export interface AttachmentBatch {
  attachments: ChatAttachment[];
  rejections: AttachmentRejection[];
}

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function fileToAttachment(file: File): Promise<ChatAttachment> {
  const buffer = await file.arrayBuffer();
  return {
    id: randomId(),
    kind: file.type.startsWith("image/") ? "image" : "file",
    name: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
    mimeType: file.type || "application/octet-stream",
    data: bufferToBase64(buffer),
  };
}

/** Converts a picked/dropped `File[]` (single files, multiple files, or an entire folder) into storable attachments. */
export async function filesToAttachments(files: File[]): Promise<AttachmentBatch> {
  const attachments: ChatAttachment[] = [];
  const rejections: AttachmentRejection[] = [];

  for (const file of files) {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      rejections.push({ name: file.name, reason: `exceeds ${MAX_ATTACHMENT_BYTES / (1024 * 1024)}MB limit` });
      continue;
    }
    attachments.push(await fileToAttachment(file));
  }

  return { attachments, rejections };
}

export function attachmentDataUrl(attachment: ChatAttachment): string {
  return `data:${attachment.mimeType};base64,${attachment.data}`;
}
