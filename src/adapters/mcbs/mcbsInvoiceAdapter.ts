import {z} from 'zod'
import {InvoiceAdapter, InvoiceAdapterConfig, RawInvoiceData} from '../invoiceAdapter'
import {CommonInvoice, InvoiceSource} from '../../models/commonInvoice'
import {loadXmlFromS3OrLocal} from '../../core/s3/s3XmlLoader'
import {loadPdfFromS3} from '../../core/s3/s3PdfLoader'
import {parseMcbsXml, mapMcbsToCommonInvoice} from './mcbsInvoiceMapper'

const defaultResolvePrimaryKey = (triggerKey: string): string => triggerKey.replace(/\.pdf$/i, '.xml')

const S3EventPayloadSchema = z.object({
    bucket: z.object({name: z.string()}),
    object: z.object({key: z.string()})
})

export class MCBSAdapter implements InvoiceAdapter {
    private readonly resolvePrimaryKey: (triggerKey: string) => string
    private readonly primaryBucket: string | undefined

    constructor(config: InvoiceAdapterConfig = {}) {
        this.resolvePrimaryKey = config.resolvePrimaryKey ?? defaultResolvePrimaryKey
        this.primaryBucket = config.primaryBucket
    }

    async loadInvoiceData(payload: Record<string, unknown>): Promise<RawInvoiceData> {
        const parsed = S3EventPayloadSchema.safeParse(payload)
        if (!parsed.success) {
            throw new Error(`Invalid S3 event payload: missing bucket or key`)
        }
        const triggerBucket = parsed.data.bucket.name
        const triggerKey = parsed.data.object.key

        const bucket = this.primaryBucket ?? triggerBucket
        const xmlKey = this.resolvePrimaryKey(triggerKey) // PDF → XML Key

        const xml = await loadXmlFromS3OrLocal({bucket, key: xmlKey})

        return parseMcbsXml(xml, `s3://${bucket}/${xmlKey}`, {
            source: 'MCBS' satisfies InvoiceSource,
            timestamp: new Date().toISOString(),
            s3Bucket: bucket,
            sourceDataKey: xmlKey,
            sourcePdfKey: triggerKey
        })
    }

    mapToCommonModel(rawData: RawInvoiceData): CommonInvoice {
        return mapMcbsToCommonInvoice(rawData)
    }

    async loadPDF(rawData: RawInvoiceData): Promise<Buffer | null> {
        const {s3Bucket, sourcePdfKey} = rawData.metadata
        if (s3Bucket === undefined) {
            return null
        }
        return loadPdfFromS3(s3Bucket, sourcePdfKey)
    }
}
