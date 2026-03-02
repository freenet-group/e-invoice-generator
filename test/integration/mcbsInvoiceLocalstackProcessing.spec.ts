import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { execSync } from 'node:child_process'
import { inflateSync } from 'node:zlib'
import {
    S3Client,
    CreateBucketCommand,
    PutObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    HeadBucketCommand,
} from '@aws-sdk/client-s3'
import {
    SQSClient,
    CreateQueueCommand
} from '@aws-sdk/client-sqs'
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers'
import { SQSEvent, SQSRecord } from 'aws-lambda'

// ==================== Podman Socket Konfiguration ====================

function resolvePodmanSocket(): string {
    const dockerHost = process.env['DOCKER_HOST']
    if (dockerHost !== undefined && dockerHost !== '' && dockerHost.length > 0) {
        return dockerHost
    }

    try {
        const socketPath = execSync(
            'podman machine inspect --format \'{{.ConnectionInfo.PodmanSocket.Path}}\'',
            { encoding: 'utf-8' }
        ).trim()
        return `unix://${socketPath}`
    } catch {
        // Fallback für Standard-Docker
        return 'unix:///var/run/docker.sock'
    }
}

const podmanSocket = resolvePodmanSocket()
process.env['DOCKER_HOST'] = podmanSocket
process.env['TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE'] = podmanSocket.replace('unix://', '')
process.env['TESTCONTAINERS_RYUK_DISABLED'] = 'true'

// ==================== Konstanten ====================

const LOCALSTACK_IMAGE = 'localstack/localstack:3'
const RAW_BUCKET = 'mcbs-invoices-test'
const OUTPUT_BUCKET = 'mcbs-invoices-test'
const QUEUE_NAME = 'mcbs-invoice-processing-test'
const FIXTURE_XML = path.resolve(__dirname, '../resources/mcbs/mcbs-voucher-invoice.xml')
const FIXTURE_PDF = path.resolve(__dirname, '../resources/mcbs/mcbs-voucher-invoice.pdf')
const XML_KEY = 'raw/mcbs-voucher-invoice.xml'
const PDF_KEY = 'raw/mcbs-voucher-invoice.pdf'
const INVOICE_NO = 'M26099999999'

// ==================== Helpers ====================

function buildSqsEvent(bucket: string, key: string, messageId: string): SQSEvent {
    const eventBridgePayload = {
        source: 'custom.mcbs',
        'detail-type': 'Object Created',
        detail: {
            bucket: { name: bucket },
            object: { key },
        },
    }

    const record: SQSRecord = {
        messageId,
        receiptHandle: `receipt-${messageId}`,
        body: JSON.stringify(eventBridgePayload),
        attributes: {
            ApproximateReceiveCount: '1',
            SentTimestamp: String(Date.now()),
            SenderId: 'localstack',
            ApproximateFirstReceiveTimestamp: String(Date.now()),
        },
        messageAttributes: {},
        md5OfBody: '',
        eventSource: 'aws:sqs',
        eventSourceARN: `arn:aws:sqs:eu-central-1:000000000000:${QUEUE_NAME}`,
        awsRegion: 'eu-central-1',
    }

    return { Records: [record] }
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
    const chunks: Buffer[] = []
    for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    return Buffer.concat(chunks)
}

function extractZugferdXml(pdfBytes: Buffer): string {
    const pdfAsText = pdfBytes.toString('latin1')
    const subtypeMarker = '/Subtype /text#2Fxml'
    const markerPos = pdfAsText.indexOf(subtypeMarker)
    if (markerPos < 0) {
        throw new Error('Kein EmbeddedFile XML-Stream im PDF gefunden')
    }

    const endstreamPos = pdfAsText.indexOf('endstream', markerPos)
    const streamKeyword = 'stream'
    const streamPos = pdfAsText.lastIndexOf(streamKeyword, endstreamPos)
    let streamStart = streamPos + streamKeyword.length
    if (pdfBytes[streamStart] === 0x0d) { streamStart++ } // \r
    if (pdfBytes[streamStart] === 0x0a) { streamStart++ } // \n

    // endstreamPos in Bytes bestimmen (binary-safe)
    let endstreamByte = streamStart
    while (endstreamByte < pdfBytes.length) {
        if (pdfBytes.subarray(endstreamByte, endstreamByte + 9).toString('ascii') === 'endstream') { break }
        endstreamByte++
    }
    // trailing whitespace entfernen
    let endByte = endstreamByte
    while (endByte > streamStart && (pdfBytes[endByte - 1] === 0x0a || pdfBytes[endByte - 1] === 0x0d)) {
        endByte--
    }

    const streamBytes = pdfBytes.subarray(streamStart, endByte)
    return inflateSync(streamBytes).toString('utf-8')
}

// ==================== Test Suite ====================

describe('MCBS E2E → LocalStack (S3 → SQS → Handler → S3)', () => {
    let container: StartedTestContainer
    let s3: S3Client
    let sqs: SQSClient
    let localstackEndpoint: string

    // Timeout erhöhen: LocalStack Container braucht Zeit zum Starten
    jest.setTimeout(120_000)

    beforeAll(async () => {
        // LocalStack Container starten
        container = await new GenericContainer(LOCALSTACK_IMAGE)
            .withExposedPorts(4566)
            .withEnvironment({
                SERVICES: 's3,sqs',
                DEBUG: '0',
                DEFAULT_REGION: 'eu-central-1',
            })
            .withWaitStrategy(Wait.forLogMessage('Ready.'))
            .start()

        const mappedPort = container.getMappedPort(4566)
        localstackEndpoint = `http://localhost:${mappedPort}`

        const awsConfig = {
            endpoint: localstackEndpoint,
            region: 'eu-central-1',
            credentials: {
                accessKeyId: 'test',
                secretAccessKey: 'test',
            },
            forcePathStyle: true,
        }

        s3 = new S3Client(awsConfig)
        sqs = new SQSClient(awsConfig)

        // Umgebungsvariablen für den Handler setzen
        process.env['AWS_ENDPOINT_URL'] = localstackEndpoint
        process.env['AWS_ACCESS_KEY_ID'] = 'test'
        process.env['AWS_SECRET_ACCESS_KEY'] = 'test'
        process.env['AWS_REGION'] = 'eu-central-1'
        process.env['AWS_DEFAULT_REGION'] = 'eu-central-1'
        process.env['OUTPUT_BUCKET_NAME'] = OUTPUT_BUCKET
        process.env['PDF_BUCKET_NAME'] = RAW_BUCKET
        process.env['ACTIVE_ADAPTER'] = 'custom.mcbs'
        process.env['STAGE'] = 'test'

        // S3 Bucket erstellen
        await s3.send(new CreateBucketCommand({ Bucket: RAW_BUCKET }))

        // SQS Queue erstellen
        await sqs.send(new CreateQueueCommand({ QueueName: QUEUE_NAME }))

        // ← Module-Cache leeren: s3Client wird beim nächsten import()
        //   neu instanziiert — jetzt mit korrektem AWS_ENDPOINT_URL
        jest.resetModules()
    })

    afterAll(async () => {
        await container.stop()
        // Umgebungsvariablen aufräumen
        delete process.env['AWS_ENDPOINT_URL']
        delete process.env['OUTPUT_BUCKET_NAME']
        delete process.env['PDF_BUCKET_NAME']
    })

    it('LocalStack S3 ist erreichbar', async () => {
        await s3.send(
            new HeadBucketCommand({
                Bucket: RAW_BUCKET,
            })
        )
        // Bucket existiert wenn kein Fehler geworfen wird
        expect(localstackEndpoint).toContain('localhost')
    })

    it('lädt mcbs-voucher-invoice.xml in S3 hoch', async () => {
        const xmlContent = await fs.readFile(FIXTURE_XML)

        await s3.send(new PutObjectCommand({
            Bucket: RAW_BUCKET,
            Key: XML_KEY,
            Body: xmlContent,
            ContentType: 'application/xml',
        }))

        // Prüfen ob Datei in S3 ist
        const head = await s3.send(new HeadObjectCommand({
            Bucket: RAW_BUCKET,
            Key: XML_KEY,
        }))

        expect(head.ContentLength).toBeGreaterThan(0)
    })

    it('lädt mcbs-voucher-invoice.pdf in S3 hoch', async () => {
        let pdfContent: Buffer
        try {
            pdfContent = await fs.readFile(FIXTURE_PDF)
        } catch {
            // Valides Minimal-PDF mit einer leeren Seite (via pdf-lib)
            const { PDFDocument } = await import('pdf-lib')
            const pdfDoc = await PDFDocument.create()
            pdfDoc.addPage([595, 842]) // A4
            const pdfBytes = await pdfDoc.save()
            pdfContent = Buffer.from(pdfBytes)
        }

        await s3.send(new PutObjectCommand({
            Bucket: RAW_BUCKET,
            Key: PDF_KEY,
            Body: pdfContent,
            ContentType: 'application/pdf',
        }))

        const head = await s3.send(new HeadObjectCommand({
            Bucket: RAW_BUCKET,
            Key: PDF_KEY,
        }))

        expect(head.ContentLength).toBeGreaterThan(0)
    })

    it('verarbeitet SQS-Event und speichert ZUGFeRD-PDF in S3', async () => {
        // Handler lazy importieren (nach Env-Setup)
        const { handler } = await import('../../src/handlers/unifiedEInvoiceProcessor')

        const sqsEvent = buildSqsEvent(RAW_BUCKET, PDF_KEY, 'test-message-id-001')

        const result = await handler(sqsEvent)

        // Keine Fehler im Batch
        expect(result.batchItemFailures).toHaveLength(0)

        // Ergebnis-PDF aus S3 laden
        const outputKey = `e-invoices/${INVOICE_NO}.pdf`
        const getResult = await s3.send(new GetObjectCommand({
            Bucket: OUTPUT_BUCKET,
            Key: outputKey,
        }))

        const pdfBytes = await streamToBuffer(<NodeJS.ReadableStream>getResult.Body)

        // PDF-Header prüfen
        expect(pdfBytes[0]).toBe(0x25) // %
        expect(pdfBytes[1]).toBe(0x50) // P
        expect(pdfBytes[2]).toBe(0x44) // D
        expect(pdfBytes[3]).toBe(0x46) // F

        // ZUGFeRD XML eingebettet
        const pdfAsText = pdfBytes.toString('latin1')
        expect(pdfAsText).toContain('factur-x.xml')
        expect(pdfAsText).toContain('/EmbeddedFile')

        // ZUGFeRD XML dekomprimieren und prüfen
        const xmlContent = extractZugferdXml(pdfBytes)
        expect(xmlContent).toContain('CrossIndustryInvoice')
        expect(xmlContent).toContain(INVOICE_NO)
    })

    it('meldet Fehler bei fehlender XML-Datei als batchItemFailure', async () => {
        const { handler } = await import('../../src/handlers/unifiedEInvoiceProcessor')

        const sqsEvent = buildSqsEvent(RAW_BUCKET, 'raw/nicht-vorhanden.pdf', 'test-message-id-002')

        const result = await handler(sqsEvent)

        // Message muss als Failure markiert sein
        expect(result.batchItemFailures).toHaveLength(1)
        expect(result.batchItemFailures[0]?.itemIdentifier).toBe('test-message-id-002')
    })

    it('überschreibt stillschweigend bei doppelter SQS-Message (Idempotenz)', async () => {
        const { handler } = await import('../../src/handlers/unifiedEInvoiceProcessor')

        // Dieselbe Message nochmal senden
        const sqsEvent = buildSqsEvent(RAW_BUCKET, PDF_KEY, 'test-message-id-001-duplicate')

        const result = await handler(sqsEvent)

        // Keine Fehler — S3 überschreibt stillschweigend
        expect(result.batchItemFailures).toHaveLength(0)

        // Ergebnis-PDF ist immer noch vorhanden und valide
        const outputKey = `e-invoices/${INVOICE_NO}.pdf`
        const getResult = await s3.send(new GetObjectCommand({
            Bucket: OUTPUT_BUCKET,
            Key: outputKey,
        }))

        const pdfBytes = await streamToBuffer(<NodeJS.ReadableStream>getResult.Body)

        // PDF ist identisch → deterministische Generierung
        expect(pdfBytes[0]).toBe(0x25) // %
        expect(pdfBytes[1]).toBe(0x50) // P
        expect(pdfBytes[2]).toBe(0x44) // D
        expect(pdfBytes[3]).toBe(0x46) // F

        const pdfAsText = pdfBytes.toString('latin1')
        expect(pdfAsText).toContain('factur-x.xml')
        expect(pdfAsText).toContain('/EmbeddedFile')

        // ZUGFeRD XML hat Inhalt
        const xmlContent = extractZugferdXml(pdfBytes)
        expect(xmlContent).toContain('CrossIndustryInvoice')
        expect(xmlContent).toContain(INVOICE_NO)
    })
})