import {GetObjectCommand} from '@aws-sdk/client-s3'
import {s3Client} from './s3Client'

const PDF_MAGIC = Buffer.from('%PDF')

export async function loadPdfFromS3(bucket: string, key: string): Promise<Buffer | null> {
    try {
        const response = await s3Client.send(new GetObjectCommand({Bucket: bucket, Key: key}))
        const bytes = await response.Body?.transformToByteArray()
        if (bytes === undefined) {
            return null
        }
        const buf = Buffer.from(bytes)
        if (!buf.subarray(0, 4).equals(PDF_MAGIC)) {
            return null
        }
        return buf
    } catch {
        return null
    }
}
