import {SQSRecord} from 'aws-lambda'
import {InvoiceAdapter, RawInvoiceData} from '../../src/adapters/invoiceAdapter'
import {AdapterRegistry} from '../../src/adapters/adapterRegistry'
import {EInvoiceProcessingService} from '../../src/services/eInvoiceProcessingService'
import {CommonInvoice, InvoiceType, TaxCategoryCode} from '../../src/models/commonInvoice'

function createInvoice(): CommonInvoice {
    return {
        invoiceNumber: 'INV-1000',
        invoiceDate: '2026-02-22',
        invoiceType: InvoiceType.COMMERCIAL,
        currency: 'EUR',
        source: {
            system: 'MCBS',
            id: 'source-1',
            timestamp: '2026-02-22T00:00:00Z'
        },
        seller: {
            name: 'Seller GmbH',
            postalAddress: {
                postalCode: '24937',
                cityName: 'Flensburg',
                countryCode: 'DE'
            }
        },
        buyer: {
            name: 'Buyer GmbH',
            postalAddress: {
                postalCode: '10115',
                cityName: 'Berlin',
                countryCode: 'DE'
            }
        },
        lineItems: [
            {
                id: 1,
                name: 'Leistung',
                quantity: 1,
                unitCode: 'C62',
                unitPrice: 100,
                netAmount: 100,
                tax: {
                    typeCode: 'VAT',
                    categoryCode: TaxCategoryCode.STANDARD, // Zeile 44
                    rate: 19
                }
            }
        ],
        paymentMeans: [{typeCode: '58'}],
        taxes: [
            {
                typeCode: 'VAT',
                categoryCode: TaxCategoryCode.STANDARD, // Zeile 53
                rate: 19,
                basisAmount: 100,
                calculatedAmount: 19
            }
        ],
        totals: {
            lineTotal: 100,
            taxBasisTotal: 100,
            taxTotal: 19,
            grandTotal: 119,
            duePayable: 119
        }
    }
}

function createRawData(): RawInvoiceData {
    return {
        source: 'MCBS',
        data: {},
        metadata: {
            id: 'raw-1',
            timestamp: '2026-02-22T00:00:00Z'
        }
    }
}

function createRecord(messageId: string, body: string): SQSRecord {
    return {
        messageId,
        receiptHandle: 'rh',
        body,
        attributes: {
            ApproximateReceiveCount: '1',
            SentTimestamp: '0',
            SenderId: 'sender',
            ApproximateFirstReceiveTimestamp: '0'
        },
        messageAttributes: {},
        md5OfBody: 'md5',
        eventSource: 'aws:sqs',
        eventSourceARN: 'arn:aws:sqs:eu-central-1:123456789012:queue',
        awsRegion: 'eu-central-1'
    }
}

jest.mock('../../src/core/s3/s3Uploader', () => ({
    uploadToS3: jest.fn().mockResolvedValue(undefined)
}))

const mockLoadInvoiceData = jest.fn()
const mockMapToCommonModel = jest.fn()
const mockLoadPDF = jest.fn()
const mockAdapter: InvoiceAdapter = {
    loadInvoiceData: mockLoadInvoiceData,
    mapToCommonModel: mockMapToCommonModel,
    loadPDF: mockLoadPDF
}

const mockHasAdapter = jest.fn().mockReturnValue(true)
const mockGetAdapter = jest.fn().mockReturnValue(mockAdapter)
const mockGetSources = jest.fn().mockReturnValue(['custom.mcbs'])

function createRegistry(adapter: InvoiceAdapter): AdapterRegistry {
    const registry = new AdapterRegistry()
    jest.spyOn(registry, 'hasAdapter').mockReturnValue(true)
    jest.spyOn(registry, 'getAdapter').mockReturnValue(adapter)
    jest.spyOn(registry, 'getSources').mockReturnValue(['custom.mcbs'])
    return registry
}

describe('EInvoiceProcessingService', () => {
    let service: EInvoiceProcessingService

    beforeEach(() => {
        jest.clearAllMocks()
        mockHasAdapter.mockReturnValue(true)
        mockGetAdapter.mockReturnValue(mockAdapter)
        mockGetSources.mockReturnValue(['custom.mcbs'])
        service = new EInvoiceProcessingService({
            adapterRegistry: <AdapterRegistry>(<unknown>{
                hasAdapter: mockHasAdapter,
                getAdapter: mockGetAdapter,
                getSources: mockGetSources
            }),
            generateXml: jest.fn().mockResolvedValue('<xml/>'),
            uploadResult: jest.fn().mockResolvedValue(undefined)
        })
    })

    it('processes one record and calls generate + upload with embedded pdf', async () => {
        const invoice = createInvoice()
        const rawData = createRawData()

        const loadInvoiceData = jest.fn().mockResolvedValue(rawData)
        const mapToCommonModel = jest.fn().mockReturnValue(invoice)
        const loadPDF = jest.fn().mockResolvedValue(Buffer.from([1, 2, 3]))
        const adapter: InvoiceAdapter = {loadInvoiceData, mapToCommonModel, loadPDF}

        const generateXml = jest.fn().mockResolvedValue('<xml/>')
        const uploadResult = jest.fn().mockResolvedValue(undefined)

        const svc = new EInvoiceProcessingService({
            adapterRegistry: createRegistry(adapter),
            generateXml,
            uploadResult
        })

        const record = createRecord(
            'msg-1',
            JSON.stringify({source: 'custom.mcbs', 'detail-type': 'invoice.created', detail: {id: '1'}})
        )

        await svc.processRecord(record)

        expect(loadInvoiceData).toHaveBeenCalledWith({id: '1'})
        expect(mapToCommonModel).toHaveBeenCalledWith(rawData)
        expect(generateXml).toHaveBeenCalledWith(invoice, {
            profile: 'factur-x-en16931',
            pdf: new Uint8Array(Buffer.from([1, 2, 3])),
            pdfFilename: 'INV-1000.pdf'
        })
        expect(uploadResult).toHaveBeenCalledWith('<xml/>', 'INV-1000')
    })

    it('omits pdf options when adapter returns null pdf', async () => {
        const invoice = createInvoice()
        const rawData = createRawData()
        const adapter: InvoiceAdapter = {
            loadInvoiceData: jest.fn().mockResolvedValue(rawData),
            mapToCommonModel: jest.fn().mockReturnValue(invoice),
            loadPDF: jest.fn().mockResolvedValue(null)
        }

        const generateXml = jest.fn().mockResolvedValue('<xml/>')
        const svc = new EInvoiceProcessingService({
            adapterRegistry: createRegistry(adapter),
            generateXml,
            uploadResult: jest.fn().mockResolvedValue(undefined)
        })

        const record = createRecord(
            'msg-1',
            JSON.stringify({source: 'custom.mcbs', 'detail-type': 'invoice.created', detail: {id: '1'}})
        )

        await svc.processRecord(record)
        expect(generateXml).toHaveBeenCalledWith(invoice, {profile: 'factur-x-en16931'})
    })

    it('returns batch item failures when one record processing fails', async () => {
        const invoice = createInvoice()
        const rawData = createRawData()
        const adapter: InvoiceAdapter = {
            loadInvoiceData: jest.fn().mockResolvedValue(rawData),
            mapToCommonModel: jest.fn().mockReturnValue(invoice),
            loadPDF: jest.fn().mockResolvedValue(null)
        }

        const svc = new EInvoiceProcessingService({
            adapterRegistry: createRegistry(adapter),
            generateXml: jest.fn().mockResolvedValue('<xml/>'),
            uploadResult: jest.fn().mockResolvedValue(undefined)
        })

        const okRecord = createRecord(
            'ok-id',
            JSON.stringify({source: 'custom.mcbs', 'detail-type': 'invoice.created', detail: {id: '1'}})
        )
        const invalidJsonRecord = createRecord('bad-id', '{not-json}')

        const result = await svc.processBatch([okRecord, invalidJsonRecord])
        expect(result).toEqual({batchItemFailures: [{itemIdentifier: 'bad-id'}]})
    })

    it('uses default uploadResult when not provided', async () => {
        process.env['OUTPUT_BUCKET_NAME'] = 'test-bucket'
        const invoice = createInvoice()
        const rawData = createRawData()
        const adapter: InvoiceAdapter = {
            loadInvoiceData: jest.fn().mockResolvedValue(rawData),
            mapToCommonModel: jest.fn().mockReturnValue(invoice),
            loadPDF: jest.fn().mockResolvedValue(null)
        }

        const generateXml = jest.fn().mockResolvedValue('<xml/>')
        const svc = new EInvoiceProcessingService({
            adapterRegistry: createRegistry(adapter),
            generateXml
        })

        const record = createRecord(
            'msg-default-upload',
            JSON.stringify({source: 'custom.mcbs', 'detail-type': 'invoice.created', detail: {id: '1'}})
        )

        await expect(svc.processRecord(record)).resolves.toBeUndefined()
        expect(generateXml).toHaveBeenCalledTimes(1)
        delete process.env['OUTPUT_BUCKET_NAME']
    })

    it('returns no batch failures when all records succeed', async () => {
        const invoice = createInvoice()
        const rawData = createRawData()
        const loadInvoiceData = jest.fn().mockResolvedValue(rawData)
        const adapter: InvoiceAdapter = {
            loadInvoiceData,
            mapToCommonModel: jest.fn().mockReturnValue(invoice),
            loadPDF: jest.fn().mockResolvedValue(null)
        }

        const svc = new EInvoiceProcessingService({
            adapterRegistry: createRegistry(adapter),
            generateXml: jest.fn().mockResolvedValue('<xml/>'),
            uploadResult: jest.fn().mockResolvedValue(undefined)
        })

        const r1 = createRecord(
            'm1',
            JSON.stringify({source: 'custom.mcbs', 'detail-type': 'invoice.created', detail: {id: '1'}})
        )
        const r2 = createRecord(
            'm2',
            JSON.stringify({source: 'custom.mcbs', 'detail-type': 'invoice.created', detail: {id: '2'}})
        )

        const result = await svc.processBatch([r1, r2])
        expect(result).toEqual({batchItemFailures: []})
        expect(loadInvoiceData).toHaveBeenCalledTimes(2)
    })

    it('continues batch processing after a failure', async () => {
        const invoice = createInvoice()
        const rawData = createRawData()
        const adapter: InvoiceAdapter = {
            loadInvoiceData: jest
                .fn()
                .mockRejectedValueOnce(new Error('Simulated parsing error'))
                .mockResolvedValueOnce(rawData),
            mapToCommonModel: jest.fn().mockReturnValue(invoice),
            loadPDF: jest.fn().mockResolvedValue(null)
        }

        const uploadResult = jest.fn().mockResolvedValue(undefined)
        const svc = new EInvoiceProcessingService({
            adapterRegistry: createRegistry(adapter),
            generateXml: jest.fn().mockResolvedValue('<xml/>'),
            uploadResult
        })

        const bad = createRecord('bad', JSON.stringify({source: 'aws.s3', 'detail-type': 'Object Created', detail: {id: 'x'}}))
        const ok = createRecord('ok', JSON.stringify({source: 'aws.s3', 'detail-type': 'Object Created', detail: {id: '1'}}))

        const result = await svc.processBatch([bad, ok])
        expect(result).toEqual({batchItemFailures: [{itemIdentifier: 'bad'}]})
        expect(uploadResult).toHaveBeenCalledTimes(1)
    })

    it('rejects processRecord and does not upload when generateXml fails', async () => {
        const invoice = createInvoice()
        const rawData = createRawData()
        const adapter: InvoiceAdapter = {
            loadInvoiceData: jest.fn().mockResolvedValue(rawData),
            mapToCommonModel: jest.fn().mockReturnValue(invoice),
            loadPDF: jest.fn().mockResolvedValue(null)
        }

        const uploadResult = jest.fn().mockResolvedValue(undefined)
        const svc = new EInvoiceProcessingService({
            adapterRegistry: createRegistry(adapter),
            generateXml: jest.fn().mockRejectedValue(new Error('xml generation failed')),
            uploadResult
        })

        const record = createRecord(
            'msg-fail-generate',
            JSON.stringify({source: 'custom.mcbs', 'detail-type': 'invoice.created', detail: {id: '1'}})
        )

        await expect(svc.processRecord(record)).rejects.toThrow('xml generation failed')
        expect(uploadResult).not.toHaveBeenCalled()
    })

    it('throws when adapter is unknown (Zeile 71)', async () => {
        mockHasAdapter.mockReturnValueOnce(false)
        const record = createRecord(
            'msg-unknown-adapter',
            JSON.stringify({source: 'custom.mcbs', 'detail-type': 'invoice.created', detail: {id: '1'}})
        )
        await expect(service.processRecord(record)).rejects.toThrow("Unknown adapter: 'custom.mcbs'")
    })

    it('throws when record body is not valid EventBridge format (Zeile 63)', async () => {
        const record = createRecord('msg-invalid', JSON.stringify({invalid: 'format'}))
        await expect(service.processRecord(record)).rejects.toThrow()
    })

    it('logs error and rethrows when getInvoiceFormat throws (Zeile 84-85)', async () => {
        process.env['ACTIVE_ADAPTER'] = 'custom.mcbs'
        process.env['INVOICE_FORMAT'] = 'invalid-format'
        const svc = new EInvoiceProcessingService({
            adapterRegistry: <AdapterRegistry>(<unknown>{
                hasAdapter: jest.fn().mockReturnValue(true),
                getAdapter: jest.fn().mockReturnValue(mockAdapter),
                getSources: jest.fn().mockReturnValue(['custom.mcbs'])
            }),
            generateXml: jest.fn().mockResolvedValue('<xml/>'),
            uploadResult: jest.fn().mockResolvedValue(undefined)
        })
        const record = createRecord(
            'msg-bad-format',
            JSON.stringify({source: 'custom.mcbs', 'detail-type': 'invoice.created', detail: {id: '1'}})
        )
        await expect(svc.processRecord(record)).rejects.toThrow()
    })
})
