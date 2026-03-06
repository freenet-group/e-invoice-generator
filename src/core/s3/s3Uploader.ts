import {PutObjectCommand} from '@aws-sdk/client-s3'
import {s3Client} from './s3Client'

export interface S3UploadOptions {
    bucketName: string
    key: string
    body: Buffer
    contentType: string
    metadata?: Record<string, string>
}

export async function uploadToS3(options: S3UploadOptions): Promise<void> {
    await s3Client.send(
        new PutObjectCommand({
            Bucket: options.bucketName,
            Key: options.key,
            Body: options.body,
            ContentType: options.contentType,
            ...(options.metadata === undefined ? {} : {Metadata: options.metadata})
        })
    )
}
