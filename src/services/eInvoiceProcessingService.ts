import { SQSRecord } from 'aws-lambda'
import { AdapterRegistry } from '../adapters/adapterRegistry'
import { generateEInvoice } from './eInvoiceGeneratorService'
import { uploadToS3 } from '../core/s3/s3Uploader'
import { logger as rootLogger } from '../core/logger'
import { getInvoiceFormat, type InvoiceFormat } from '../config/eInvoiceProfileConfiguration'

interface EventBridgeEvent {
    source: string
    'detail-type': string
    detail: unknown
}

type LoggerLike = Pick<typeof rootLogger, 'info' | 'error'>

interface ProcessingDependencies {
    adapterRegistry: AdapterRegistry
    generateXml?: typeof generateEInvoice
    uploadResult?: (zugferdResult: string | Uint8Array, invoiceNumber: string) => Promise<void>
    logger?: LoggerLike
}

const defaultLogger: LoggerLike = rootLogger.child({ name: 'EInvoiceProcessingService' })

export class EInvoiceProcessingService {
    private readonly adapterRegistry: AdapterRegistry
    private readonly generateXml: typeof generateEInvoice
    private readonly uploadResult: (zugferdResult: string | Uint8Array, invoiceNumber: string) => Promise<void>
    private readonly logger: LoggerLike

    constructor(dependencies: ProcessingDependencies) {
        this.adapterRegistry = dependencies.adapterRegistry
        this.generateXml = dependencies.generateXml ?? generateEInvoice
        this.uploadResult = dependencies.uploadResult ?? defaultUploadResult
        this.logger = dependencies.logger ?? defaultLogger
    }

    async processBatch(
        records: SQSRecord[]
    ): Promise<{ batchItemFailures: { itemIdentifier: string }[] }> {
        this.logger.info({ totalCount: records.length }, 'Processing batch')

        const batchItemFailures: { itemIdentifier: string }[] = []

        for (const record of records) {
            try {
                await this.processRecord(record)
            } catch (error) {
                this.logger.error({ err: error, messageId: record.messageId }, `Failed to process record ${record.messageId}`)
                batchItemFailures.push({ itemIdentifier: record.messageId })
            }
        }

        return { batchItemFailures }
    }

    async processRecord(record: SQSRecord): Promise<void> {
        this.logger.info({ messageId: record.messageId }, `Processing message: ${record.messageId}`)

        const eventBridgeEvent = <EventBridgeEvent><unknown>JSON.parse(record.body)

        this.logger.info({ source: eventBridgeEvent.source, detailType: eventBridgeEvent['detail-type'] }, 'Event received')

        const activeAdapter = process.env['ACTIVE_ADAPTER'] ?? 'custom.mcbs'
        const adapter = this.adapterRegistry.getAdapter(activeAdapter)
        const rawData = await adapter.loadInvoiceData(<Record<string, unknown>>eventBridgeEvent.detail)
        const invoice = adapter.mapToCommonModel(rawData)
        const pdf = await adapter.loadPDF(invoice)

        // Format: aus Environment — XRechnung-Erkennung kommt später
        let profile: InvoiceFormat
        try {
            profile = getInvoiceFormat()
        } catch (error) {
            this.logger.error({ err: error }, 'Failed to get invoice format')
            throw error
        }
        const isXRechnung = profile.startsWith('xrechnung')

        const zugferdResult = await this.generateXml(invoice, {
            profile,
            // kein PDF bei XRechnung
            ...(!isXRechnung && pdf !== null
                ? {
                    pdf: new Uint8Array(pdf),
                    pdfFilename: `${invoice.invoiceNumber}.pdf`,
                }
                : {}),
        })

        await this.uploadResult(zugferdResult, invoice.invoiceNumber)
    }
}

async function defaultUploadResult(zugferdResult: string | Uint8Array, invoiceNumber: string): Promise<void> {
    const bucket = process.env['OUTPUT_BUCKET_NAME']
    if (bucket === undefined || bucket === '') {
        throw new Error('OUTPUT_BUCKET_NAME environment variable is not set')
    }
    const isXml = typeof zugferdResult === 'string'
    await uploadToS3({
        bucketName: bucket,
        key: `e-invoices/${invoiceNumber}.${isXml ? 'xml' : 'pdf'}`,
        body: isXml ? Buffer.from(zugferdResult, 'utf-8') : Buffer.from(zugferdResult),
        contentType: isXml ? 'application/xml' : 'application/pdf',
        metadata: { invoiceNumber },
    })
}
