import {InvoiceService} from '@e-invoice-eu/core'
import {generateEInvoice} from '../../../src/services/eInvoiceGeneratorService'
import {CommonInvoice, InvoiceType, TaxCategoryCode, UnitCode, PaymentMeansCode} from '../../../src/models/commonInvoice'

// ==================== Mocks ====================

const mockGenerate = jest.fn()

jest.mock('@e-invoice-eu/core', () => ({
    InvoiceService: jest.fn().mockImplementation(() => ({
        generate: mockGenerate
    }))
}))

jest.mock('../../../src/core/logger', () => ({
    logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        child: jest.fn().mockReturnThis()
    }
}))

// Nach den jest.mock-Aufrufen importieren
import {logger} from '../../../src/core/logger'
const mockServiceLogger = <
    {
        info: jest.Mock
        warn: jest.Mock
        error: jest.Mock
        child: jest.Mock
    }
>(<unknown>logger)

// ==================== Fixture ====================

function createInvoice(): CommonInvoice {
    return {
        invoiceNumber: 'INV-TEST-001',
        invoiceDate: '2026-02-21',
        invoiceType: InvoiceType.COMMERCIAL,
        currency: 'EUR',
        source: {
            system: 'MCBS',
            timestamp: '2026-02-22T10:00:00Z',
            partyId: 'P-MCBS-123',
            billingAccountId: 'BA-MCBS-123'
        },
        seller: {
            name: 'freenet DLS GmbH',
            postalAddress: {
                postalCode: '24937',
                cityName: 'Flensburg',
                countryCode: 'DE'
            }
        },
        buyer: {
            name: 'Erika Mustermann',
            postalAddress: {
                postalCode: '12345',
                cityName: 'Berlin',
                countryCode: 'DE'
            }
        },
        lineItems: [
            {
                id: 1,
                name: 'freenet Unlimited Tarif',
                quantity: 1,
                unitCode: UnitCode.PIECE,
                unitPrice: 100,
                netAmount: 100,
                tax: {
                    typeCode: 'VAT',
                    categoryCode: TaxCategoryCode.STANDARD,
                    rate: 19
                }
            }
        ],
        paymentMeans: [
            {
                typeCode: PaymentMeansCode.CREDIT_TRANSFER
            }
        ],
        taxes: [
            {
                typeCode: 'VAT',
                categoryCode: TaxCategoryCode.STANDARD,
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

// ==================== Tests ====================

describe('eInvoiceGeneratorService', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockGenerate.mockResolvedValue('<xml>ok</xml>')
        mockServiceLogger.child.mockReturnValue(mockServiceLogger)
    })

    it('generates XML with default profile and passes mapped invoice to InvoiceService', async () => {
        const invoice = createInvoice()

        const result = await generateEInvoice(invoice)

        expect(result).toBe('<xml>ok</xml>')
        expect(InvoiceService).toHaveBeenCalledTimes(1)
        expect(mockGenerate).toHaveBeenCalledTimes(1)

        const [mappedInvoice, options] = <[Record<string, unknown>, Record<string, unknown>]>mockGenerate.mock.calls[0]

        expect(options).toMatchObject({
            format: 'factur-x-en16931',
            lang: 'de',
            noWarnings: true
        })
        expect(mappedInvoice).toHaveProperty('ubl:Invoice')
        const ublInvoice = <Record<string, unknown>>mappedInvoice['ubl:Invoice']
        expect(ublInvoice['cbc:ID']).toBe('INV-TEST-001')
    })

    it('adds PDF embedding options when pdf is provided', async () => {
        const invoice = createInvoice()
        const pdf = new Uint8Array([1, 2, 3])

        await generateEInvoice(invoice, {
            profile: 'factur-x-basic',
            pdf,
            pdfFilename: 'rechnung.pdf'
        })

        const [, options] = <[Record<string, unknown>, Record<string, unknown>]>mockGenerate.mock.calls[0]
        expect(options).toMatchObject({
            format: 'factur-x-basic',
            pdf: {
                buffer: pdf,
                filename: 'rechnung.pdf',
                mimetype: 'application/pdf'
            }
        })
    })

    it('passes a logger to InvoiceService that delegates to pino', async () => {
        const invoice = createInvoice()

        await generateEInvoice(invoice)

        const mockCalls = <unknown[][]>(<jest.Mock>InvoiceService).mock.calls
        const invoiceServiceLogger = <
            {
                log: (m: string) => void
                warn: (m: string) => void
                error: (m: string) => void
            }
        >mockCalls[0]?.[0]

        invoiceServiceLogger.log('hello')
        invoiceServiceLogger.warn('attention')
        invoiceServiceLogger.error('boom')

        expect(mockServiceLogger.info).toHaveBeenCalledWith('hello')
        expect(mockServiceLogger.warn).toHaveBeenCalledWith('attention')
        expect(mockServiceLogger.error).toHaveBeenCalledWith('boom')
    })

    it('uses invoiceNumber as default PDF filename when pdfFilename is omitted', async () => {
        const invoice = createInvoice()
        const pdf = new Uint8Array([4, 5, 6])

        await generateEInvoice(invoice, {pdf})

        const [, options] = <[Record<string, unknown>, Record<string, unknown>]>mockGenerate.mock.calls[0]
        expect(options).toMatchObject({
            pdf: {
                filename: 'INV-TEST-001.pdf'
            }
        })
    })

    it('logs and rethrows when generate throws an Error', async () => {
        const invoice = createInvoice()
        const error = new Error('generation failed')
        mockGenerate.mockRejectedValueOnce(error)

        await expect(generateEInvoice(invoice)).rejects.toThrow('generation failed')

        expect(mockServiceLogger.error).toHaveBeenCalledWith(
            {invoiceNumber: 'INV-TEST-001', error: 'generation failed'},
            'E-Invoice Generierung fehlgeschlagen'
        )
    })

    it('logs and wraps as FatalProcessingError when generate throws a non-Error value', async () => {
        const invoice = createInvoice()
        mockGenerate.mockRejectedValueOnce('plain string error')

        await expect(generateEInvoice(invoice)).rejects.toMatchObject({
            name: 'FatalProcessingError',
            message: <string>expect.stringContaining('plain string error')
        })

        expect(mockServiceLogger.error).toHaveBeenCalledWith(
            {invoiceNumber: 'INV-TEST-001', error: 'plain string error'},
            'E-Invoice Generierung fehlgeschlagen'
        )
    })
})
