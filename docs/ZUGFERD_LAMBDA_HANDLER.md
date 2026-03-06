# ZUGFeRD Lambda Handler

## Handler Implementation

```typescript
// src/handlers/embed-zugferd-handler.ts
import {S3Event, S3Handler} from 'aws-lambda'
import {S3Client, GetObjectCommand, PutObjectCommand} from '@aws-sdk/client-s3'
import {ZUGFeRDEmbedder} from '../services/zugferd-embedder'
import * as path from 'path'

const s3Client = new S3Client({region: process.env.AWS_REGION})

export const handler: S3Handler = async (event: S3Event) => {
  for (const record of event.Records) {
    try {
      const bucket = record.s3.bucket.name
      const xmlKey = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '))

      console.log(`Processing ZUGFeRD XML: s3://${bucket}/${xmlKey}`)

      // 1. Finde zugehöriges PDF
      const pdfKey = findMatchingPdfKey(xmlKey)
      console.log(`Matched PDF: ${pdfKey}`)

      // 2. Lade PDF und XML
      const [pdfBuffer, xmlContent] = await Promise.all([loadFileFromS3(bucket, pdfKey), loadTextFromS3(bucket, xmlKey)])

      // 3. Einbetten
      const embedder = new ZUGFeRDEmbedder()
      const eInvoicePdf = await embedder.embedZugferdXml(pdfBuffer, xmlContent)

      // 4. Speichern
      const outputKey = pdfKey.replace('/pdf/', '/e-rechnung/').replace('.pdf', '_zugferd.pdf')

      await saveFileToS3(bucket, outputKey, eInvoicePdf, {
        'zugferd-version': '2.1',
        'zugferd-profile': 'COMFORT',
        'pdf-a-version': 'PDF/A-3b'
      })

      console.log(`Success: s3://${bucket}/${outputKey}`)
    } catch (error) {
      console.error('Failed:', error)
      throw error
    }
  }
}

function findMatchingPdfKey(xmlKey: string): string {
  // XML: invoices/zugferd/2026/02/INV-2026-000001_zugferd.xml
  // PDF: invoices/pdf/2026/02/INV-2026-000001.pdf

  const basename = path.basename(xmlKey).replace('_zugferd.xml', '.pdf')
  const dirname = path.dirname(xmlKey).replace('/zugferd/', '/pdf/')

  return `${dirname}/${basename}`
}

async function loadFileFromS3(bucket: string, key: string): Promise<Buffer> {
  const response = await s3Client.send(new GetObjectCommand({Bucket: bucket, Key: key}))
  const bytes = await response.Body!.transformToByteArray()
  return Buffer.from(bytes)
}

async function loadTextFromS3(bucket: string, key: string): Promise<string> {
  const response = await s3Client.send(new GetObjectCommand({Bucket: bucket, Key: key}))
  return response.Body!.transformToString('utf-8')
}

async function saveFileToS3(bucket: string, key: string, buffer: Buffer, metadata: Record<string, string>): Promise<void> {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: 'application/pdf',
      Metadata: metadata
    })
  )
}
```

## Serverless Configuration

```yaml
# serverless.yml
service: zugferd-pdf-embedder

provider:
  name: aws
  runtime: nodejs18.x
  region: eu-central-1
  memorySize: 1024
  timeout: 300

functions:
  embedZugferd:
    handler: src/handlers/embed-zugferd-handler.handler
    events:
      - s3:
          bucket: mcbs-invoices
          event: s3:ObjectCreated:*
          rules:
            - suffix: _zugferd.xml
            - prefix: invoices/zugferd/
```

## Deployment

```bash
npm install
serverless deploy
```
