import { MCBSAdapter } from '../../src/adapters/mcbs/mcbsInvoiceAdapter'
import {
    CommonInvoice,
    InvoiceType,
    PaymentMeansCode,
} from '../../src/models/commonInvoice'
import { RawInvoiceData } from '../../src/adapters/invoiceAdapter'

// ==================== Mocks ====================

const mockLoadXmlFromS3OrLocal = jest.fn()
const mockLoadPdfFromS3 = jest.fn()
const mockParseMcbsXml = jest.fn()
const mockMapMcbsToCommonInvoice = jest.fn()

jest.mock('../../src/core/s3/s3XmlLoader', () => ({
    loadXmlFromS3OrLocal: async (...args: unknown[]): Promise<string> =>
        <string>(await mockLoadXmlFromS3OrLocal(...args)),
}))

jest.mock('../../src/core/s3/s3PdfLoader', () => ({
    loadPdfFromS3: async (...args: unknown[]): Promise<Buffer | null> => <Promise<Buffer | null>>(await mockLoadPdfFromS3(...args)),
}))

jest.mock('../../src/adapters/mcbs/mcbsInvoiceMapper', () => ({
    parseMcbsXml: (...args: unknown[]): RawInvoiceData => <RawInvoiceData>mockParseMcbsXml(...args),
    mapMcbsToCommonInvoice: (...args: unknown[]): CommonInvoice =>
        <CommonInvoice>mockMapMcbsToCommonInvoice(...args),
}))

// ==================== Fixtures ====================

const mockRawData: RawInvoiceData = {
    source: 'MCBS',
    metadata: {
        id: 'test-invoice.xml',
        timestamp: '2026-02-22T00:00:00.000Z',
        s3Bucket: 'my-bucket',
        s3Key: 'invoices/test-invoice.xml',
    },
    data: {},
}

const mockInvoice: CommonInvoice = {
    invoiceNumber: 'INV-001',
    invoiceDate: '2026-02-22',
    invoiceType: InvoiceType.COMMERCIAL,
    currency: 'EUR',
    source: {
        system: 'MCBS',
        id: 'test-invoice.xml',
        timestamp: '2026-02-22T00:00:00.000Z',
    },
    seller: {
        name: 'freenet DLS GmbH',
        postalAddress: {
            streetName: '',
            cityName: '',
            postalCode: '',
            countryCode: 'DE',
        },
    },
    buyer: {
        name: 'Erika Mustermann',
        postalAddress: {
            streetName: 'Musterstraße 1',
            cityName: 'Hamburg',
            postalCode: '20095',
            countryCode: 'DE',
        },
    },
    paymentMeans: [{ typeCode: PaymentMeansCode.SEPA_DIRECT_DEBIT }],
    totals: {
        lineTotal: 24.35,
        taxBasisTotal: 24.35,
        taxTotal: 4.63,
        grandTotal: 29.97,
        duePayable: 29.97,
    },
    taxes: [],
    lineItems: [],
    pdf: {
        s3Bucket: 'my-bucket',
        s3Key: 'invoices/test-invoice.xml',
    },
}

// ==================== Tests ====================

describe('MCBSAdapter', () => {
    let adapter: MCBSAdapter

    beforeEach(() => {
        jest.clearAllMocks()
        adapter = new MCBSAdapter()
    })

    // ==================== loadInvoiceData ====================

    describe('loadInvoiceData', () => {
        it('loads XML from S3 and returns RawInvoiceData', async () => {
            const payload = {
                bucket: { name: 'my-bucket' },
                object: { key: 'invoices/test-invoice.pdf' },
            }
            mockLoadXmlFromS3OrLocal.mockResolvedValue('<DOCUMENT/>')
            mockParseMcbsXml.mockReturnValue(mockRawData)

            const result = await adapter.loadInvoiceData(payload)

            expect(mockLoadXmlFromS3OrLocal).toHaveBeenCalledWith({
                bucket: 'my-bucket',
                key: 'invoices/test-invoice.xml',
            })
            expect(mockParseMcbsXml).toHaveBeenCalledWith(
                '<DOCUMENT/>',
                's3://my-bucket/invoices/test-invoice.xml',
                expect.objectContaining({
                    id: 'invoices/test-invoice.xml',
                    s3Bucket: 'my-bucket',
                    s3Key: 'invoices/test-invoice.xml',
                    pdfKey: 'invoices/test-invoice.pdf',
                })
            )
            expect(result).toBe(mockRawData)
        })

        it('uses primaryBucket from config when provided', async () => {
            adapter = new MCBSAdapter({ primaryBucket: 'primary-bucket' })
            const payload = {
                bucket: { name: 'trigger-bucket' },
                object: { key: 'invoices/test-invoice.pdf' },
            }
            mockLoadXmlFromS3OrLocal.mockResolvedValue('<DOCUMENT/>')
            mockParseMcbsXml.mockReturnValue(mockRawData)

            await adapter.loadInvoiceData(payload)

            expect(mockLoadXmlFromS3OrLocal).toHaveBeenCalledWith({
                bucket: 'primary-bucket',
                key: 'invoices/test-invoice.xml',
            })
        })

        it('uses custom resolvePrimaryKey from config', async () => {
            adapter = new MCBSAdapter({
                resolvePrimaryKey: (key) =>
                    key.replace('/pdf/', '/xml/').replace(/\.pdf$/i, '.xml'),
            })
            const payload = {
                bucket: { name: 'my-bucket' },
                object: { key: 'invoices/pdf/M26008957394.pdf' },
            }
            mockLoadXmlFromS3OrLocal.mockResolvedValue('<DOCUMENT/>')
            mockParseMcbsXml.mockReturnValue(mockRawData)

            await adapter.loadInvoiceData(payload)

            expect(mockLoadXmlFromS3OrLocal).toHaveBeenCalledWith({
                bucket: 'my-bucket',
                key: 'invoices/xml/M26008957394.xml',
            })
        })

        it('throws when bucket or key is missing', async () => {
            const payload = { bucket: { name: 'my-bucket' } }

            await expect(adapter.loadInvoiceData(payload)).rejects.toThrow(
                'Invalid S3 event payload: missing bucket or key'
            )
        })

        it('throws when loadXmlFromS3OrLocal fails', async () => {
            const payload = {
                bucket: { name: 'my-bucket' },
                object: { key: 'missing.pdf' },
            }
            mockLoadXmlFromS3OrLocal.mockRejectedValue(new Error('S3 error'))

            await expect(adapter.loadInvoiceData(payload)).rejects.toThrow('S3 error')
        })
    })

    // ==================== mapToCommonModel ====================

    describe('mapToCommonModel', () => {
        it('delegates to mapMcbsToCommonInvoice and returns result', () => {
            mockMapMcbsToCommonInvoice.mockReturnValue(mockInvoice)

            const result = adapter.mapToCommonModel(mockRawData)

            expect(mockMapMcbsToCommonInvoice).toHaveBeenCalledWith(mockRawData)
            expect(result).toBe(mockInvoice)
        })

        it('propagates errors from mapper', () => {
            mockMapMcbsToCommonInvoice.mockImplementation(() => {
                throw new Error('Mapping failed')
            })

            expect(() => adapter.mapToCommonModel(mockRawData)).toThrow('Mapping failed')
        })
    })

    // ==================== loadPDF ====================

    describe('loadPDF', () => {
        it('loads PDF from S3 with .xml replaced by .pdf in key', async () => {
            const pdfBuffer = Buffer.from('%PDF-mock')
            mockLoadPdfFromS3.mockResolvedValue(pdfBuffer)

            const result = await adapter.loadPDF(mockInvoice)

            expect(mockLoadPdfFromS3).toHaveBeenCalledWith(
                'my-bucket',
                'invoices/test-invoice.pdf'
            )
            expect(result).toBe(pdfBuffer)
        })

        it('returns null when s3Bucket is missing', async () => {
            const invoice = { ...mockInvoice, pdf: { s3Key: 'invoices/test-invoice.xml' } }

            const result = await adapter.loadPDF(invoice)

            expect(mockLoadPdfFromS3).not.toHaveBeenCalled()
            expect(result).toBeNull()
        })

        it('returns null when s3Key is missing', async () => {
            const invoice = { ...mockInvoice, pdf: { s3Bucket: 'my-bucket' } }

            const result = await adapter.loadPDF(invoice)

            expect(mockLoadPdfFromS3).not.toHaveBeenCalled()
            expect(result).toBeNull()
        })

        it('returns null when pdf is undefined', async () => {
            const invoice = { ...mockInvoice, pdf: undefined }

            const result = await adapter.loadPDF(invoice)

            expect(mockLoadPdfFromS3).not.toHaveBeenCalled()
            expect(result).toBeNull()
        })

        it('handles PDF key without .xml extension', async () => {
            const invoice = {
                ...mockInvoice,
                pdf: { s3Bucket: 'my-bucket', s3Key: 'invoices/test-invoice' },
            }
            mockLoadPdfFromS3.mockResolvedValue(Buffer.from('%PDF'))

            await adapter.loadPDF(invoice)

            expect(mockLoadPdfFromS3).toHaveBeenCalledWith(
                'my-bucket',
                'invoices/test-invoice'
            )
        })

        it('throws when loadPdfFromS3 fails', async () => {
            mockLoadPdfFromS3.mockRejectedValue(new Error('PDF not found'))

            await expect(adapter.loadPDF(mockInvoice)).rejects.toThrow('PDF not found')
        })
    })
})