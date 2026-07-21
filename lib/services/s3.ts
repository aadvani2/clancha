import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const BUCKET = process.env.AWS_BUCKET ?? process.env.S3_BUCKET ?? "clancha-images";
const REGION = process.env.AWS_REGION ?? "us-east-1";

function getS3Client(): S3Client | null {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!accessKeyId || !secretAccessKey) {
    console.error("[S3] ✗ AWS Configuration Missing: accessKeyId or secretAccessKey not in env.");
    return null;
  }

  return new S3Client({
    region: REGION,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
}

/**
 * Generate a pre-signed URL for direct upload to S3.
 * Returns { uploadUrl, key, storageUrl } - storageUrl is the final public URL after upload.
 */
export async function getPresignedUploadUrl(
  channelId: string,
  contentType: string,
  extension: string
): Promise<{ uploadUrl: string; key: string; storageUrl: string } | null> {
  const client = getS3Client();
  if (!client) return null;

  const key = `channels/${channelId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
    ChecksumAlgorithm: undefined, // prevent SDK from injecting a checksum into the signed URL
  });

  try {
    // unhoistableHeaders prevents the SDK from including checksum headers (x-amz-checksum-crc32)
    // in the presigned URL. Without this, the browser can't reproduce the signature and gets
    // a SignatureDoesNotMatch error.
    const uploadUrl = await getSignedUrl(client, command, {
      expiresIn: 600,
      unhoistableHeaders: new Set(["x-amz-checksum-crc32", "x-amz-sdk-checksum-algorithm"]),
    });
    const storageUrl = `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`;
    return { uploadUrl, key, storageUrl };
  } catch (error) {
    console.error("[S3] ✗ Failed to generate pre-signed upload URL:", error);
    return null;
  }
}

/**
 * Upload a file buffer directly to S3 from the server (no presigned URLs, no CORS issues).
 * Use this for server-side uploads from Next.js API routes.
 */
export async function uploadFileToS3(
  key: string,
  body: Buffer,
  contentType: string
): Promise<{ key: string; storageUrl: string } | null> {
  const client = getS3Client();
  if (!client) return null;

  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
  });

  try {
    await client.send(command);
    const storageUrl = `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`;
    return { key, storageUrl };
  } catch (error) {
    console.error("[S3] ✗ Failed to upload file:", error);
    return null;
  }
}

/**
 * Generate a pre-signed URL for viewing an object in S3.
 */
export async function getPresignedViewUrl(
  key: string,
  expiresIn: number = 3600 // Default 1 hour
): Promise<string | null> {
  const client = getS3Client();
  if (!client) return null;

  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
  });

  try {
    return await getSignedUrl(client, command, { expiresIn });
  } catch (error) {
    console.error("[S3] ✗ Failed to generate pre-signed view URL:", error);
    return null;
  }
}
/**
 * Permanently delete an object from S3. Returns true on success, false otherwise.
 */
export async function deleteObjectFromS3(key: string): Promise<boolean> {
  const client = getS3Client();
  if (!client) return false;
  try {
    await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch (error) {
    console.error("[S3] ✗ Failed to delete object:", error);
    return false;
  }
}

/**
 * Generate a CloudFront CDN URL for an S3 object key.
 * This avoids signed URLs and redirects, improving SMS deliverability.
 */
export function getCloudFrontUrl(key: string): string {
  const cdnDomain = process.env.NEXT_PUBLIC_CLOUDFRONT_DOMAIN || "cdn.clancha.com";
  // Trim leading slash from key if present
  const cleanKey = key.startsWith("/") ? key.slice(1) : key;
  return `https://${cdnDomain}/${cleanKey}`;
}
