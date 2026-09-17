function required(name: string) {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`缺少服务端配置：${name}`);
    return value;
}

export const config = {
    databaseUrl: required("DATABASE_URL"),
    origin: new URL(required("APP_ORIGIN")).origin,
    secret: required("AUTH_SECRET"),
    s3: {
        endpoint: required("S3_ENDPOINT"),
        region: required("S3_REGION"),
        bucket: required("S3_BUCKET"),
        credentials: { accessKeyId: required("S3_ACCESS_KEY_ID"), secretAccessKey: required("S3_SECRET_ACCESS_KEY") },
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    },
};

export const FILE_LIMIT = Number(process.env.MAX_FILE_BYTES || 100 * 1024 * 1024);
export const SIGNED_URL_SECONDS = 15 * 60;
if (!Number.isSafeInteger(FILE_LIMIT) || FILE_LIMIT <= 0) throw new Error("MAX_FILE_BYTES 必须是正整数");
