import { readFile } from 'node:fs/promises'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { s3Client } from './s3Client'

export interface S3OrLocalSource {
    bucket?: string
    key?: string
    /** Nur für lokale Scripts (z. B. `validate-zugferd-xml.ts`). In Lambda wird ausschließlich bucket+key genutzt. */
    filePath?: string
}

export async function loadXmlFromS3OrLocal(
    source: S3OrLocalSource
): Promise<string> {
    if (source.filePath !== undefined) {
        return readFile(source.filePath, { encoding: 'utf-8' })
    }

    if (source.bucket !== undefined && source.key !== undefined) {
        const response = await s3Client.send(
            new GetObjectCommand({ Bucket: source.bucket, Key: source.key })
        )
        const content = await response.Body?.transformToString('utf-8')
        if (content === undefined) {
            throw new Error(`Empty response from S3: s3://${source.bucket}/${source.key}`)
        }
        return content
    }

    throw new Error('Either filePath or bucket+key must be provided')
}

export async function loadXmlFromS3(bucket: string, key: string): Promise<string | null> {
    try {
        const response = await s3Client.send(
            new GetObjectCommand({
                Bucket: bucket,
                Key: key,
            }),
        )

        if (response.Body === undefined) {
            return null
        }

        const content = await response.Body.transformToString('utf-8')
        return content.length > 0 ? content : null
    } catch (error: unknown) {
        if (error instanceof Error && error.name === 'NoSuchKey') {
            return null
        }
        throw error
    }
}

// Optional für Abwärtskompatibilität, falls anderswo Default-Import genutzt wird:
export default loadXmlFromS3