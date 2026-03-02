import { GetObjectCommand } from '@aws-sdk/client-s3'
import { s3Client } from './s3Client'

export async function loadPdfFromS3(
    bucket: string,
    key: string
): Promise<Buffer | null> {
    try {
        const response = await s3Client.send(
            new GetObjectCommand({ Bucket: bucket, Key: key })
        )
        const bytes = await response.Body?.transformToByteArray()
        return bytes === undefined ? null : Buffer.from(bytes)
    } catch {
        return null
    }
}