import path from 'node:path'
import {SQSRecord} from 'aws-lambda'
import {z} from 'zod'
import {AdapterRegistry} from '../adapters/adapterRegistry'
import {generateEInvoice} from './eInvoiceGeneratorService'
import {uploadToS3} from '../core/s3/s3Uploader'
import {publishEInvoiceCreated, type EInvoiceCreatedEventParams, type BillingDocumentType} from './eInvoiceEventPublisher'
import {logger as rootLogger} from '../core/logger'
import {getInvoiceFormat, type InvoiceFormat, DEFAULT_ADAPTER} from '../config/eInvoiceProfileConfiguration'
import {InvoiceType} from '../models/commonInvoice'
import {FatalProcessingError} from '../core/errors/fatalProcessingError'
import {sendToFatalDlq} from '../core/sqs/sqsFatalDlqSender'

const EventBridgeEventSchema = z.object({
    id: z.string().optional(),
    source: z.string(),
    'detail-type': z.string(),
    detail: z.record(z.string(), z.unknown())
})

type LoggerLike = Pick<typeof rootLogger, 'info' | 'error'>

interface ProcessingDependencies {
    adapterRegistry: AdapterRegistry
    generateXml?: typeof generateEInvoice
    uploadResult?: (zugferdResult: string | Uint8Array, sourceFilename: string) => Promise<string>
    publishEvent?: (params: EInvoiceCreatedEventParams) => Promise<void>
    logger?: LoggerLike
}

const defaultLogger: LoggerLike = rootLogger.child({name: 'EInvoiceProcessingService'})

export class EInvoiceProcessingService {
    private readonly adapterRegistry: AdapterRegistry
    private readonly generateXml: typeof generateEInvoice
    private readonly uploadResult: (zugferdResult: string | Uint8Array, sourceFilename: string) => Promise<string>
    private readonly publishEvent: (params: EInvoiceCreatedEventParams) => Promise<void>
    private readonly logger: LoggerLike

    constructor(dependencies: ProcessingDependencies) {
        this.adapterRegistry = dependencies.adapterRegistry
        this.generateXml = dependencies.generateXml ?? generateEInvoice
        this.uploadResult = dependencies.uploadResult ?? defaultUploadResult
        this.publishEvent = dependencies.publishEvent ?? publishEInvoiceCreated
        this.logger = dependencies.logger ?? defaultLogger
    }

    async processBatch(records: SQSRecord[]): Promise<{batchItemFailures: {itemIdentifier: string}[]}> {
        this.logger.info({totalCount: records.length}, 'Processing batch')

        const batchItemFailures: {itemIdentifier: string}[] = []

        for (const record of records) {
            try {
                await this.processRecord(record)
            } catch (error) {
                if (error instanceof FatalProcessingError) {
                    this.logger.error(
                        {err: error, messageId: record.messageId, source: error.source},
                        `Fatal error – no retry, routing to Fatal DLQ: ${record.messageId}`
                    )
                    try {
                        await sendToFatalDlq(record, error)
                    } catch (dlqError) {
                        // Fatal DLQ send fehlgeschlagen → als transient behandeln, damit SQS retried
                        this.logger.error({err: dlqError, messageId: record.messageId}, 'Failed to send to Fatal DLQ – falling back to batchItemFailures')
                        batchItemFailures.push({itemIdentifier: record.messageId})
                    }
                    // Nicht in batchItemFailures → SQS behandelt die Message als erfolgreich verarbeitet
                } else {
                    this.logger.error({err: error, messageId: record.messageId}, `Failed to process record ${record.messageId}`)
                    batchItemFailures.push({itemIdentifier: record.messageId})
                }
            }
        }

        return {batchItemFailures}
    }

    async processRecord(record: SQSRecord): Promise<void> {
        this.logger.info({messageId: record.messageId}, `Processing message: ${record.messageId}`)

        const parseResult = EventBridgeEventSchema.safeParse(JSON.parse(record.body))
        if (!parseResult.success) {
            throw new Error(`Invalid EventBridge event format: ${parseResult.error.message}`)
        }
        const eventBridgeEvent = parseResult.data

        this.logger.info({source: eventBridgeEvent.source, detailType: eventBridgeEvent['detail-type']}, 'Event received')

        const activeAdapter = process.env['ACTIVE_ADAPTER'] ?? DEFAULT_ADAPTER
        if (!this.adapterRegistry.hasAdapter(activeAdapter)) {
            throw new Error(
                `Unknown adapter: '${activeAdapter}' – check ACTIVE_ADAPTER environment variable. Available adapters: ${this.adapterRegistry.getSources().join(', ')}`
            )
        }
        const adapter = this.adapterRegistry.getAdapter(activeAdapter)

        const rawData = await adapter.loadInvoiceData(eventBridgeEvent.detail)
        const invoice = adapter.mapToCommonModel(rawData)
        const pdf = await adapter.loadPDF(rawData)

        // Format: aus Environment — XRechnung-Erkennung kommt später
        let profile: InvoiceFormat
        try {
            profile = getInvoiceFormat()
        } catch (error) {
            this.logger.error({err: error}, 'Failed to get invoice format')
            throw error
        }
        const isXRechnung = profile === 'factur-x-xrechnung'

        const zugferdResult = await this.generateXml(invoice, {
            profile,
            // kein PDF bei XRechnung
            ...(!isXRechnung && pdf !== null
                ? {
                      pdf: new Uint8Array(pdf),
                      pdfFilename: `${invoice.invoiceNumber}.pdf`
                  }
                : {})
        })

        const sourceFilename = path.basename(rawData.metadata.sourcePdfKey)
        const s3Key = await this.uploadResult(zugferdResult, sourceFilename)

        const billingDocumentType = resolveBillingDocumentType(invoice.invoiceType)
        const mediaType = isXRechnung ? 'application/xml' : 'application/pdf'

        await this.publishEvent({
            billingDocumentId: invoice.invoiceNumber,
            partyId: invoice.source.partyId,
            billingAccountId: invoice.source.billingAccountId,
            billrunId: invoice.source.billrunId,
            mandant: invoice.source.mandant,
            s3Key,
            bucketName: process.env['BUCKET_NAME'] ?? '',
            profile,
            source: invoice.source.system,
            context: 'e-invoice-added',
            billingDocumentType,
            mediaType,
            correlationId: eventBridgeEvent.id ?? crypto.randomUUID()
        })
    }
}

async function defaultUploadResult(zugferdResult: string | Uint8Array, sourceFilename: string): Promise<string> {
    const bucket = process.env['BUCKET_NAME']
    if (bucket === undefined || bucket === '') {
        throw new Error('BUCKET_NAME environment variable is not set')
    }
    const outputPrefix = process.env['OUTPUT_PREFIX'] ?? 'e-invoices/'
    const isXml = typeof zugferdResult === 'string'
    const baseName = sourceFilename.replace(/\.[^.]+$/, '')
    const key = `${outputPrefix}${baseName}.${isXml ? 'xml' : 'pdf'}`
    await uploadToS3({
        bucketName: bucket,
        key,
        body: isXml ? Buffer.from(zugferdResult, 'utf-8') : Buffer.from(zugferdResult),
        contentType: isXml ? 'application/xml' : 'application/pdf',
        metadata: {sourceFilename}
    })
    return key
}

function resolveBillingDocumentType(invoiceType: InvoiceType): BillingDocumentType {
    const map: Record<InvoiceType, BillingDocumentType> = {
        [InvoiceType.COMMERCIAL]: 'COMMERCIAL_INVOICE',
        [InvoiceType.CREDIT_NOTE]: 'CREDIT_NOTE',
        [InvoiceType.CORRECTED]: 'CORRECTED_INVOICE',
        [InvoiceType.SELF_BILLING]: 'SELF_BILLING'
    }
    return map[invoiceType]
}
