import { parseMcbsXml, mapMcbsToCommonInvoice } from '../../src/adapters/mcbs/mcbsInvoiceMapper'
import { loadXmlFromS3OrLocal } from '../../src/core/s3/s3XmlLoader'
import { loadPdfFromS3 } from '../../src/core/s3/s3PdfLoader'
import { InvoiceType, PaymentMeansCode } from '../../src/models/commonInvoice'

const mockReadFile = jest.fn()
const mockSend = jest.fn()

jest.mock('node:fs/promises', () => ({
    readFile: async (...args: unknown[]): Promise<Buffer> => <Promise<Buffer>>mockReadFile(...args),
}))

jest.mock('@aws-sdk/client-s3', () => ({
    S3Client: jest.fn().mockImplementation(() => ({
        send: async (...args: unknown[]): Promise<unknown> => <Promise<unknown>>mockSend(...args),
    })),
    GetObjectCommand: jest.fn().mockImplementation((input: unknown) => input),
}))

type RawInvoiceData = Parameters<typeof mapMcbsToCommonInvoice>[0]

type DeepPartial<T> = {
    [K in keyof T]?: T[K] extends Array<infer U>
        ? Array<DeepPartial<U>>
        : T[K] extends object
          ? DeepPartial<T[K]>
          : T[K]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function deepMerge<T extends Record<string, unknown>>(base: T, patch?: DeepPartial<T>): T {
    if (patch === undefined) {
        return base
    }

    const out: Record<string, unknown> = { ...base }

    for (const [key, patchValue] of Object.entries(<Record<string, unknown>>patch)) {
        if (patchValue === undefined) {
            continue
        }

        const baseValue = out[key]
        // Arrays immer ersetzen, nicht mergen
        if (Array.isArray(patchValue)) {
            out[key] = patchValue
        } else if (isPlainObject(baseValue) && isPlainObject(patchValue)) {
            out[key] = deepMerge(baseValue, patchValue)
        } else {
            out[key] = patchValue
        }
    }

    return <T><unknown>out
}

function buildRawData(overrides?: DeepPartial<RawInvoiceData>): RawInvoiceData {
    const defaults: RawInvoiceData = {
        source: 'MCBS',
        metadata: {
            id: 'INV-TEST-001',
            timestamp: '2026-02-22T00:00:00.000Z',
        },
        data: {
            ID: 'INV-TEST-001',
            TYPE: 'RE',
            HEADER: {
                INVOICE_DATE: '22.02.2026',
                INV_CURRENCY: 'EUR',
                INVOICE_NO: 'M26008957394',
                BILLRUN_ID: '150580',
                BILLING_SYSTEM: 'MCBS',
                SOURCE_SYSTEM: 'LIFE',
                MANDANT: 'MC',
                CLIENTBANK_ACNT: 'DE08214400450844443200',
                CLIENTBANK_CODE: 'COBADEFFXXX',
                BRAND: {
                    DESC: 'freenet DLS GmbH',
                    CODE_DESC: 'freenet',
                },
            },
            RECIPIENT: {
                PERSON_NO: '2120710',
                ADDRESS: {
                    SHORT_OPENING: 'Herr',
                    FIRSTNAME: 'Erika',
                    NAME: 'Mustermann',
                    STREET: 'Musterstraße 1',
                    POSTCODE: '20095',
                    CITY: 'Hamburg',
                    COUNTRY: 'DE',
                },
            },
            INVOICE_DATA: {
                PAYMENT_MODE: {
                    PAYMENT_TYPE: 'SEPADEBIT',
                    BANK_ACCOUNT: 'DE77630500000009165180',
                    BANK_CODE: 'SOLADES1ULM',
                    DUE_DATE: '16.02.2026',
                    SEPA_MANDATE: 'MC-2120710-000000001',
                },
                FRAMES: {
                    AMOUNTS: {
                        AMOUNT: [
                            { TYPE: 'TOTAL_NET', VALUE: '24,3529' },
                            { TYPE: 'TOTAL_VAT', VALUE: '4,63' },
                            { TYPE: 'TOTAL', VALUE: '29,97' },
                            { TYPE: 'SUBTOTAL', VALUE: '28,98' },
                            { TYPE: 'INSEP_GROSS', VALUE: '0,9900' },
                        ],
                    },
                    DIFF_VATS: {
                        DIFF_VAT: [
                            { VAT_RATE: '19', VAT: '4,63', NET: '24,3529' },
                        ],
                    },
                    FRAME: [
                        {
                            ID: 'TELCO',
                            AREA: {
                                UNIT: [
                                    {
                                        SEQUENCE_NO: '1',
                                        SECTIONS: {
                                            SECTION: [
                                                {
                                                    BILLITEM_GRPS: {
                                                        BILLITEM_GRP: [
                                                            {
                                                                BILLITEMS: {
                                                                    BILLITEM: [
                                                                        { SEQUENCE_NO: '1', PRODUCT_NAME: 'Grundgebühr', PRODUCT_CODE: '10001', CHARGE: '18,4790', VAT_RATE: '19' },
                                                                        { SEQUENCE_NO: '2', PRODUCT_NAME: 'Save.TV 1 Monat', PRODUCT_CODE: '12130', CHARGE: '5,8739', VAT_RATE: '19' },
                                                                    ],
                                                                },
                                                            },
                                                            { BILLITEMS: {} },
                                                        ],
                                                    },
                                                },
                                            ],
                                        },
                                    },
                                ],
                            },
                        },
                    ],
                },
            },
        },
    }

    return <RawInvoiceData><unknown>deepMerge(<Record<string, unknown>><unknown>defaults, overrides)
}

function buildMinimalDocumentXml(invoiceId: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<DOCUMENT>
  <ID>${invoiceId}</ID>
  <TYPE>RE</TYPE>
  <HEADER>
    <INVOICE_DATE>22.02.2026</INVOICE_DATE>
    <INV_CURRENCY>EUR</INV_CURRENCY>
    <CLIENTBANK_ACNT>DE08214400450844443200</CLIENTBANK_ACNT>
    <CLIENTBANK_CODE>COBADEFFXXX</CLIENTBANK_CODE>
    <BRAND>
      <DESC>freenet DLS GmbH</DESC>
      <CODE_DESC>freenet</CODE_DESC>
    </BRAND>
  </HEADER>
  <RECIPIENT>
    <ADDRESS>
      <SHORT_OPENING>Herr</SHORT_OPENING>
      <FIRSTNAME>Erika</FIRSTNAME>
      <NAME>Mustermann</NAME>
      <STREET>Musterstraße 1</STREET>
      <POSTCODE>20095</POSTCODE>
      <CITY>Hamburg</CITY>
      <COUNTRY>DE</COUNTRY>
    </ADDRESS>
  </RECIPIENT>
  <INVOICE_DATA>
    <PAYMENT_MODE>
      <PAYMENT_TYPE>SEPADEBIT</PAYMENT_TYPE>
      <BANK_ACCOUNT>DE77630500000009165180</BANK_ACCOUNT>
      <BANK_CODE>SOLADES1ULM</BANK_CODE>
      <DUE_DATE>16.02.2026</DUE_DATE>
    </PAYMENT_MODE>
    <FRAMES>
      <AMOUNTS>
        <AMOUNT><TYPE>TOTAL_NET</TYPE><VALUE>24,3529</VALUE></AMOUNT>
        <AMOUNT><TYPE>TOTAL_VAT</TYPE><VALUE>4,63</VALUE></AMOUNT>
        <AMOUNT><TYPE>TOTAL</TYPE><VALUE>29,97</VALUE></AMOUNT>
        <AMOUNT><TYPE>SUBTOTAL</TYPE><VALUE>28,98</VALUE></AMOUNT>
        <AMOUNT><TYPE>INSEP_GROSS</TYPE><VALUE>0,9900</VALUE></AMOUNT>
      </AMOUNTS>
      <DIFF_VATS>
        <DIFF_VAT><VAT_RATE>19</VAT_RATE><VAT>4,63</VAT><NET>24,3529</NET></DIFF_VAT>
      </DIFF_VATS>
      <FRAME />
    </FRAMES>
  </INVOICE_DATA>
</DOCUMENT>`
}

// ==================== parseMcbsXml ====================

describe('parseMcbsXml', () => {
    it('parses valid XML and returns RawInvoiceData with DOCUMENT root', () => {
        const xml = '<DOCUMENT><ID>INV-1</ID></DOCUMENT>'
        const metadata = { id: 'INV-1', timestamp: '2026-02-22T00:00:00Z' }

        const result = parseMcbsXml(xml, '/tmp/invoice.xml', metadata)

        expect(result.source).toBe('MCBS')
        expect(result.metadata.id).toBe('INV-1')
        expect(result.data).toBeDefined()
    })

    it('throws when XML has no DOCUMENT root', () => {
        expect(() =>
            parseMcbsXml('<NOT_DOCUMENT/>', '/tmp/bad.xml', { id: 'x', timestamp: '' })
        ).toThrow('Invalid MCBS XML: missing <DOCUMENT> root element in /tmp/bad.xml')
    })
})

// ==================== loadXmlFromS3OrLocal ====================

describe('loadXmlFromS3OrLocal', () => {
    beforeEach(() => jest.clearAllMocks())

    it('loads XML from local file path', async () => {
        mockReadFile.mockResolvedValue(buildMinimalDocumentXml('INV-FILE-1'))

        const xml = await loadXmlFromS3OrLocal({ filePath: '/tmp/invoice.xml' })

        expect(xml).toContain('INV-FILE-1')
        expect(mockReadFile).toHaveBeenCalledWith('/tmp/invoice.xml', 'utf-8')
    })

    it('loads XML from S3 when bucket and key are provided', async () => {
        mockSend.mockResolvedValue({
            Body: {
                transformToString: jest.fn().mockResolvedValue(buildMinimalDocumentXml('INV-S3-1')),
            },
        })

        const xml = await loadXmlFromS3OrLocal({ bucket: 'bucket', key: 'a/b.xml' })

        expect(xml).toContain('INV-S3-1')
    })

    it('throws when S3 body is empty', async () => {
        mockSend.mockResolvedValue({ Body: undefined })

        await expect(loadXmlFromS3OrLocal({ bucket: 'bucket', key: 'x.xml' })).rejects.toThrow(
            'Empty response from S3: s3://bucket/x.xml'
        )
    })

    it('throws when payload has neither filePath nor bucket/key', async () => {
        await expect(loadXmlFromS3OrLocal({})).rejects.toThrow(
            'Either filePath or bucket+key must be provided'
        )
    })
})

// ==================== loadPdfFromS3 ====================

describe('loadPdfFromS3', () => {
    beforeEach(() => jest.clearAllMocks())

    it('returns PDF buffer when S3 response contains bytes', async () => {
        mockSend.mockResolvedValue({
            Body: {
                transformToByteArray: jest.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
            },
        })

        const result = await loadPdfFromS3('bucket', 'a/b.xml')

        expect(Buffer.isBuffer(result)).toBe(true)
        expect(result?.length).toBe(3)
    })

    it('returns null when S3 body is missing', async () => {
        mockSend.mockResolvedValue({ Body: undefined })

        const result = await loadPdfFromS3('bucket', 'a/b.xml')

        expect(result).toBeNull()
    })

    it('returns null when S3 request fails', async () => {
        mockSend.mockRejectedValue(new Error('S3 unavailable'))

        const result = await loadPdfFromS3('bucket', 'a/b.xml')

        expect(result).toBeNull()
    })
})

// ==================== mapMcbsToCommonInvoice ====================

describe('mapMcbsToCommonInvoice', () => {
    beforeEach(() => jest.clearAllMocks())

    it('maps valid MCBS raw data to CommonInvoice', () => {
        const invoice = mapMcbsToCommonInvoice(buildRawData())
        const [firstPaymentMeans] = invoice.paymentMeans
        const [firstLineItem] = invoice.lineItems

        expect(invoice.invoiceNumber).toBe('M26008957394')
        expect(invoice.seller.name).toBe('freenet DLS GmbH')
        expect(invoice.buyer.name).toBe('Erika Mustermann')
        expect(invoice.totals.grandTotal).toBe(29.97)
        expect(firstPaymentMeans?.typeCode).toBe(PaymentMeansCode.SEPA_DIRECT_DEBIT)
        expect(firstLineItem?.name).toBe('Grundgebühr')
    })

    it('maps TYPE GS to CREDIT_NOTE', () => {
        const rawData = buildRawData({ data: { TYPE: 'GS' } })
        const invoice = mapMcbsToCommonInvoice(rawData)

        expect(invoice.invoiceType).toBe(InvoiceType.CREDIT_NOTE)
    })

    it('handles empty tax list and multiple billitem groups', () => {
        const rawData = buildRawData({
            data: {
                INVOICE_DATA: {
                    FRAMES: {
                        DIFF_VATS: { DIFF_VAT: [] },
                        AMOUNTS: {
                            AMOUNT: [
                                { TYPE: 'TOTAL_NET', VALUE: '0' },
                                { TYPE: 'TOTAL_VAT', VALUE: '0' },
                                { TYPE: 'TOTAL', VALUE: '0' },
                                { TYPE: 'SUBTOTAL', VALUE: '0' },
                                { TYPE: 'INSEP_GROSS', VALUE: '0' },  // ← kein INSEP
                            ],
                        },
                        FRAME: [
                            {
                                ID: 'TELCO',
                                AREA: {
                                    UNIT: [
                                        {
                                            SEQUENCE_NO: '1',
                                            SECTIONS: {
                                                SECTION: [
                                                    {
                                                        BILLITEM_GRPS: {
                                                            BILLITEM_GRP: [
                                                                {
                                                                    BILLITEMS: {
                                                                        BILLITEM: [
                                                                            { SEQUENCE_NO: '1', PRODUCT_NAME: 'A', CHARGE: '3', VAT_RATE: '19' },
                                                                            { SEQUENCE_NO: '2', PRODUCT_NAME: 'B', CHARGE: '7', VAT_RATE: '19' },
                                                                        ],
                                                                    },
                                                                },
                                                                { BILLITEMS: {} },
                                                            ],
                                                        },
                                                    },
                                                ],
                                            },
                                        },
                                    ],
                                },
                            },
                        ],
                    },
                },
            },
        })

        const invoice = mapMcbsToCommonInvoice(rawData)

        expect(invoice.taxes).toEqual([])
        expect(invoice.lineItems).toHaveLength(2)
        expect(invoice.lineItems[0]?.name).toBe('A')
        expect(invoice.lineItems[1]?.name).toBe('B')
    })

    it('uses fallbackId when SEQUENCE_NO is missing', () => {
        const rawData = buildRawData({
            data: {
                INVOICE_DATA: {
                    FRAMES: {
                        FRAME: [{
                            AREA: {
                                UNIT: [{
                                    SEQUENCE_NO: '1',
                                    SECTIONS: {
                                        SECTION: [{
                                            BILLITEM_GRPS: {
                                                BILLITEM_GRP: [{
                                                    BILLITEMS: {
                                                        BILLITEM: [
                                                            { PRODUCT_NAME: 'A', CHARGE: '10', VAT_RATE: '19' },
                                                            { PRODUCT_NAME: 'B', CHARGE: '5', VAT_RATE: '19' },
                                                        ],
                                                    },
                                                }],
                                            },
                                        }],
                                    },
                                }],
                            },
                        }],
                    },
                },
            },
        })

        const invoice = mapMcbsToCommonInvoice(rawData)

        expect(invoice.lineItems[0]?.id).toBe(1)
        expect(invoice.lineItems[1]?.id).toBe(2)
    })

    it('maps VAT_RATE INCLUDED to rate 0', () => {
        const rawData = buildRawData({
            data: {
                INVOICE_DATA: {
                    FRAMES: {
                        FRAME: [{
                            AREA: {
                                UNIT: [{
                                    SEQUENCE_NO: '1',
                                    SECTIONS: {
                                        SECTION: [{
                                            BILLITEM_GRPS: {
                                                BILLITEM_GRP: [{
                                                    BILLITEMS: {
                                                        BILLITEM: [{
                                                            SEQUENCE_NO: '1',
                                                            PRODUCT_NAME: 'Inklusivleistung',
                                                            CHARGE: '0',
                                                            VAT_RATE: 'INCLUDED',
                                                        }],
                                                    },
                                                }],
                                            },
                                        }],
                                    },
                                }],
                            },
                        }],
                    },
                },
            },
        })

        const invoice = mapMcbsToCommonInvoice(rawData)

        expect(invoice.lineItems[0]?.tax.rate).toBe(0)
    })

    it('maps PERIOD to period.start and period.end when present', () => {
        const rawData = buildRawData({
            data: {
                INVOICE_DATA: {
                    FRAMES: {
                        FRAME: [{
                            AREA: {
                                UNIT: [{
                                    SEQUENCE_NO: '1',
                                    SECTIONS: {
                                        SECTION: [{
                                            BILLITEM_GRPS: {
                                                BILLITEM_GRP: [{
                                                    BILLITEMS: {
                                                        BILLITEM: [{
                                                            SEQUENCE_NO: '1',
                                                            PRODUCT_NAME: 'Tarif',
                                                            CHARGE: '10',
                                                            VAT_RATE: '19',
                                                            PERIOD: '01.01.2026 - 31.01.2026',
                                                        }],
                                                    },
                                                }],
                                            },
                                        }],
                                    },
                                }],
                            },
                        }],
                    },
                },
            },
        })

        const invoice = mapMcbsToCommonInvoice(rawData)

        expect(invoice.lineItems[0]?.period?.start).toBe('2026-01-01')
        expect(invoice.lineItems[0]?.period?.end).toBe('2026-01-31')
    })

    it('returns empty name when PRODUCT_NAME is missing or undefined', () => {
        const rawData = buildRawData({
            data: {
                INVOICE_DATA: {
                    FRAMES: {
                        FRAME: [{
                            AREA: {
                                UNIT: [{
                                    SEQUENCE_NO: '1',
                                    SECTIONS: {
                                        SECTION: [{
                                            BILLITEM_GRPS: {
                                                BILLITEM_GRP: [{
                                                    BILLITEMS: {
                                                        BILLITEM: [{
                                                            SEQUENCE_NO: '1',
                                                            PRODUCT_NAME: '',   // ← leer statt fehlend
                                                            CHARGE: '10',
                                                            VAT_RATE: '19',
                                                        }],
                                                    },
                                                }],
                                            },
                                        }],
                                    },
                                }],
                            },
                        }],
                    },
                },
            },
        })

        const invoice = mapMcbsToCommonInvoice(rawData)

        expect(invoice.lineItems[0]?.name).toBe('')
    })


    it('returns empty taxes when DIFF_VAT array is empty', () => {
        const rawData = buildRawData({
            data: {
                INVOICE_DATA: {
                    FRAMES: {
                        DIFF_VATS: { DIFF_VAT: [] },
                        AMOUNTS: {
                            AMOUNT: [
                                { TYPE: 'TOTAL_NET', VALUE: '0' },
                                { TYPE: 'TOTAL_VAT', VALUE: '0' },
                                { TYPE: 'TOTAL', VALUE: '0' },
                                { TYPE: 'SUBTOTAL', VALUE: '0' },
                                { TYPE: 'INSEP_GROSS', VALUE: '0' },  // ← kein INSEP
                            ],
                        },
                        FRAME: [],
                    },
                },
            },
        })

        const invoice = mapMcbsToCommonInvoice(rawData)

        expect(invoice.taxes).toEqual([])
    })

    it('skips BILLITEM_GRP without BILLITEMS', () => {
        const rawData = buildRawData({
            data: {
                INVOICE_DATA: {
                    FRAMES: {
                        FRAME: [{
                            AREA: {
                                UNIT: [{
                                    SEQUENCE_NO: '1',
                                    SECTIONS: {
                                        SECTION: [{
                                            BILLITEM_GRPS: {
                                                BILLITEM_GRP: [
                                                    {},
                                                    {
                                                        BILLITEMS: {
                                                            BILLITEM: [{
                                                                SEQUENCE_NO: '1',
                                                                PRODUCT_NAME: 'Item',
                                                                CHARGE: '5',
                                                                VAT_RATE: '19',
                                                            }],
                                                        },
                                                    },
                                                ],
                                            },
                                        }],
                                    },
                                }],
                            },
                        }],
                    },
                },
            },
        })

        const invoice = mapMcbsToCommonInvoice(rawData)

        expect(invoice.lineItems).toHaveLength(1)
        expect(invoice.lineItems[0]?.name).toBe('Item')
    })

    it('skips SECTION without BILLITEM_GRPS', () => {
        const rawData = buildRawData({
            data: {
                INVOICE_DATA: {
                    FRAMES: {
                        FRAME: [{
                            AREA: {
                                UNIT: [{
                                    SEQUENCE_NO: '1',
                                    SECTIONS: {
                                        SECTION: [{}],
                                    },
                                }],
                            },
                        }],
                    },
                },
            },
        })

        const invoice = mapMcbsToCommonInvoice(rawData)

        expect(invoice.lineItems).toHaveLength(0)
    })

    it('returns empty taxes when DIFF_VAT array is empty', () => {
        const rawData = buildRawData({
            data: {
                INVOICE_DATA: {
                    FRAMES: {
                        DIFF_VATS: { DIFF_VAT: [] },
                        AMOUNTS: {
                            AMOUNT: [
                                { TYPE: 'TOTAL_NET', VALUE: '0' },
                                { TYPE: 'TOTAL_VAT', VALUE: '0' },
                                { TYPE: 'TOTAL', VALUE: '0' },
                                { TYPE: 'SUBTOTAL', VALUE: '0' },
                                { TYPE: 'INSEP_GROSS', VALUE: '0' },  // ← kein INSEP
                            ],
                        },
                        FRAME: [],
                    },
                },
            },
        })

        const invoice = mapMcbsToCommonInvoice(rawData)

        expect(invoice.taxes).toEqual([])
    })
})