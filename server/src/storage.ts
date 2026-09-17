import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config, SIGNED_URL_SECONDS } from "./config.js";

const client = new S3Client({ ...config.s3, maxAttempts: 1, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" });
const Bucket = config.s3.bucket;
export const storage = {
    upload: (key: string, mimeType: string, bytes: number) => getSignedUrl(client, new PutObjectCommand({ Bucket, Key: key, ContentType: mimeType, ContentLength: bytes }), { expiresIn: SIGNED_URL_SECONDS }),
    read: (key: string) => getSignedUrl(client, new GetObjectCommand({ Bucket, Key: key }), { expiresIn: SIGNED_URL_SECONDS }),
    head: (key: string) => client.send(new HeadObjectCommand({ Bucket, Key: key })),
    copy: (from: string, to: string, etag: string) => client.send(new CopyObjectCommand({ Bucket, Key: to, CopySource: `${Bucket}/${from.split("/").map(encodeURIComponent).join("/")}`, CopySourceIfMatch: etag })),
    remove: (key: string) => client.send(new DeleteObjectCommand({ Bucket, Key: key })),
};
