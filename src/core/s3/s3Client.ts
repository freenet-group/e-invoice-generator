import { S3Client } from '@aws-sdk/client-s3'

export const s3Client = new S3Client({
    region: process.env['AWS_REGION'] ?? process.env['AWS_DEFAULT_REGION'] ?? 'eu-central-1',
    ...(process.env['AWS_ENDPOINT_URL'] !== undefined && {
        endpoint: process.env['AWS_ENDPOINT_URL'],
        forcePathStyle: true,
    }),
})