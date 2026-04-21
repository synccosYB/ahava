import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { Readable } from "stream";
import { objectStorageClient } from "../replit_integrations/object_storage/objectStorage";

function getPrivateDir(): string {
  const dir = process.env.PRIVATE_OBJECT_DIR;
  if (!dir) {
    throw new Error("PRIVATE_OBJECT_DIR is not set");
  }
  return dir.endsWith("/") ? dir.slice(0, -1) : dir;
}

function parsePath(fullPath: string): { bucketName: string; objectName: string } {
  const normalized = fullPath.startsWith("/") ? fullPath : `/${fullPath}`;
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length < 2) {
    throw new Error(`Invalid object storage path: ${fullPath}`);
  }
  return {
    bucketName: parts[0],
    objectName: parts.slice(1).join("/"),
  };
}

export function isObjectStoragePath(filePath: string): boolean {
  if (!filePath) return false;
  if (filePath.startsWith("/replit-objstore-")) return true;
  if (filePath.startsWith("replit-objstore-")) return true;
  const dir = process.env.PRIVATE_OBJECT_DIR;
  if (dir && filePath.startsWith(dir)) return true;
  return false;
}

export interface UploadedDocument {
  storagePath: string;
}

export async function uploadDocumentBuffer(
  buffer: Buffer,
  originalName: string,
  mimeType: string,
): Promise<UploadedDocument> {
  const ext = path.extname(originalName) || "";
  const objectId = `${Date.now()}-${randomUUID()}${ext}`;
  const fullPath = `${getPrivateDir()}/documents/${objectId}`;
  const { bucketName, objectName } = parsePath(fullPath);

  const file = objectStorageClient.bucket(bucketName).file(objectName);
  await file.save(buffer, {
    contentType: mimeType || "application/octet-stream",
    resumable: false,
  });

  return { storagePath: fullPath };
}

export async function streamDocument(
  storagePath: string,
): Promise<{ stream: Readable; size: number; contentType: string | undefined }> {
  const { bucketName, objectName } = parsePath(storagePath);
  const file = objectStorageClient.bucket(bucketName).file(objectName);
  const [metadata] = await file.getMetadata();
  return {
    stream: file.createReadStream(),
    size: typeof metadata.size === "string" ? parseInt(metadata.size, 10) : (metadata.size as number) || 0,
    contentType: metadata.contentType,
  };
}

export async function deleteDocument(storagePath: string): Promise<void> {
  if (!isObjectStoragePath(storagePath)) {
    if (fs.existsSync(storagePath)) fs.unlinkSync(storagePath);
    return;
  }
  const { bucketName, objectName } = parsePath(storagePath);
  try {
    await objectStorageClient.bucket(bucketName).file(objectName).delete();
  } catch (err: any) {
    if (err?.code !== 404) throw err;
  }
}

export async function documentExists(storagePath: string): Promise<boolean> {
  if (!isObjectStoragePath(storagePath)) {
    return fs.existsSync(storagePath);
  }
  try {
    const { bucketName, objectName } = parsePath(storagePath);
    const [exists] = await objectStorageClient.bucket(bucketName).file(objectName).exists();
    return exists;
  } catch {
    return false;
  }
}
