import {InvoiceAdapter, InvoiceAdapterConfig, RawInvoiceData} from '../invoiceAdapter'
import {CommonInvoice} from '../../models/commonInvoice'
import {loadXmlFromS3OrLocal} from '../../core/s3/s3XmlLoader'
import {loadPdfFromS3} from '../../core/s3/s3PdfLoader'
import {parseMcbsXml, mapMcbsToCommonInvoice} from './mcbsInvoiceMapper'

const defaultResolvePrimaryKey = (triggerKey: string): string => triggerKey.replace(/\.pdf$/i, '.xml') // raw/pdf/invoice-123.pdf → raw/pdf/invoice-123.xml (Fallback; Handler nutzt PDF_PREFIX/XML_PREFIX)

export class MCBSAdapter implements InvoiceAdapter {
    private readonly resolvePrimaryKey: (triggerKey: string) => string
    private readonly primaryBucket: string | undefined

    constructor(config: InvoiceAdapterConfig = {}) {
        this.resolvePrimaryKey = config.resolvePrimaryKey ?? defaultResolvePrimaryKey
        this.primaryBucket = config.primaryBucket
    }

    async loadInvoiceData(payload: Record<string, unknown>): Promise<RawInvoiceData> {
        const triggerBucket = (<{name?: string} | undefined>payload['bucket'])?.name
        const triggerKey = (<{key?: string} | undefined>payload['object'])?.key

        if (triggerBucket === undefined || triggerKey === undefined) {
            throw new Error(`Invalid S3 event payload: missing bucket or key`)
        }

        const bucket = this.primaryBucket ?? triggerBucket
        const xmlKey = this.resolvePrimaryKey(triggerKey) // PDF → XML Key

        const xml = await loadXmlFromS3OrLocal({bucket, key: xmlKey})

        return parseMcbsXml(xml, `s3://${bucket}/${xmlKey}`, {
            source: 'MCBS',
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
