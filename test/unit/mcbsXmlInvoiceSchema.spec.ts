import { McbsXmlRootSchema as McbsXmlInvoiceSchema, parseMcbsDocument } from '../../src/adapters/mcbs/zod/mcbsXmlInvoiceSchema'

describe('mcbsXmlInvoiceSchema', () => {

    const validBase = {
        DOCUMENT: {
            TYPE: 'RE',
            ID: 'INV-001',
            HEADER: {
                INVOICE_NO: 'INV-001',
                INVOICE_DATE: '01.01.2025',
                INV_CURRENCY: 'EUR',
                BRAND: { DESC: 'Test' },
            },
            RECIPIENT: {
                PERSON_NO: 'R-001',
                ADDRESS: {
                    NAME: 'Mustermann',
                    STREET: 'Str. 1',
                    CITY: 'Berlin',
                    POSTCODE: '10001',
                    COUNTRY: 'DE',
                },
            },
            INVOICE_DATA: {
                PAYMENT_MODE: {
                    PAYMENT_TYPE: 'TRANSFER',
                    DUE_DATE: '01.02.2025',
                    BANK_ACCOUNT: 'DE89370400440532013000',
                    BANK_CODE: 'COBADEFFXXX',
                },
                FRAMES: {
                    AMOUNTS: {
                        AMOUNT: [
                            { TYPE: 'TOTAL_NET', VALUE: '100,00' },
                            { TYPE: 'TOTAL_VAT', VALUE: '19,00' },
                            { TYPE: 'TOTAL', VALUE: '119,00' },
                            { TYPE: 'TO_PAY', VALUE: '119,00' },
                        ],
                    },
                    DIFF_VATS: {
                        DIFF_VAT: { VAT_RATE: 19, NET: '100,00', VAT: '19,00' },
                    },
                    FRAME: { ID: 'MAIN' },
                },
            },
        },
    }

    it('parses valid invoice', () => {
        const result = McbsXmlInvoiceSchema.safeParse(validBase)
        expect(result.success).toBe(true)
    })

    it('fails when INVOICE_DATE has invalid format', () => {
        const invalid = {
            ...validBase,
            DOCUMENT: {
                ...validBase.DOCUMENT,
                HEADER: { ...validBase.DOCUMENT.HEADER, INVOICE_DATE: '2025-01-01' },
            },
        }
        expect(McbsXmlInvoiceSchema.safeParse(invalid).success).toBe(false)
    })

    it('fails when DUE_DATE has invalid format', () => {
        const invalid = {
            ...validBase,
            DOCUMENT: {
                ...validBase.DOCUMENT,
                INVOICE_DATA: {
                    ...validBase.DOCUMENT.INVOICE_DATA,
                    PAYMENT_MODE: {
                        ...validBase.DOCUMENT.INVOICE_DATA.PAYMENT_MODE,
                        DUE_DATE: '2025-02-01',
                    },
                },
            },
        }
        expect(McbsXmlInvoiceSchema.safeParse(invalid).success).toBe(false)
    })

    // ── germanDecimal: non-finite value ──

    it('throws when AMOUNT VALUE is not a valid decimal', () => {
        const invalid = {
            ...validBase,
            DOCUMENT: {
                ...validBase.DOCUMENT,
                INVOICE_DATA: {
                    ...validBase.DOCUMENT.INVOICE_DATA,
                    FRAMES: {
                        ...validBase.DOCUMENT.INVOICE_DATA.FRAMES,
                        AMOUNTS: {
                            AMOUNT: [
                                { TYPE: 'TOTAL_NET', VALUE: 'not-a-number' },
                            ],
                        },
                    },
                },
            },
        }
        expect(() => McbsXmlInvoiceSchema.safeParse(invalid)).toThrow('Expected German decimal number')
    })

    // ── xmlArray: null/undefined → empty array ──

    it('accepts missing DIFF_VAT (null/undefined → empty array)', () => {
        const base = {
            ...validBase,
            DOCUMENT: {
                ...validBase.DOCUMENT,
                INVOICE_DATA: {
                    ...validBase.DOCUMENT.INVOICE_DATA,
                    FRAMES: {
                        ...validBase.DOCUMENT.INVOICE_DATA.FRAMES,
                        DIFF_VATS: {},
                    },
                },
            },
        }
        const result = McbsXmlInvoiceSchema.safeParse(base)
        expect(result.success).toBe(true)
    })

    // ── McbsAmountsSchema: UNPAID present (findOptional returns value) ──

    it('parses UNPAID amount from AMOUNTS list', () => {
        const base = {
            ...validBase,
            DOCUMENT: {
                ...validBase.DOCUMENT,
                INVOICE_DATA: {
                    ...validBase.DOCUMENT.INVOICE_DATA,
                    FRAMES: {
                        ...validBase.DOCUMENT.INVOICE_DATA.FRAMES,
                        AMOUNTS: {
                            AMOUNT: [
                                { TYPE: 'TOTAL_NET', VALUE: '100,00' },
                                { TYPE: 'TOTAL_VAT', VALUE: '19,00' },
                                { TYPE: 'TOTAL', VALUE: '119,00' },
                                { TYPE: 'UNPAID', VALUE: '50,00' },
                                { TYPE: 'TO_PAY', VALUE: '69,00' },
                            ],
                        },
                    },
                },
            },
        }
        const result = McbsXmlInvoiceSchema.safeParse(base)
        expect(result.success).toBe(true)
        if (result.success) {
            expect(result.data.DOCUMENT.INVOICE_DATA.FRAMES.AMOUNTS.UNPAID).toBe(50)
            expect(result.data.DOCUMENT.INVOICE_DATA.FRAMES.AMOUNTS.TO_PAY).toBe(69)
        }
    })

    // ── McbsAddressSchema: COUNTRY = '' → 'DE' ──

    it('defaults COUNTRY to DE when empty string', () => {
        const base = {
            ...validBase,
            DOCUMENT: {
                ...validBase.DOCUMENT,
                RECIPIENT: {
                    ...validBase.DOCUMENT.RECIPIENT,
                    ADDRESS: { ...validBase.DOCUMENT.RECIPIENT.ADDRESS, COUNTRY: '' },
                },
            },
        }
        const result = McbsXmlInvoiceSchema.safeParse(base)
        expect(result.success).toBe(true)
        if (result.success) {
            expect(result.data.DOCUMENT.RECIPIENT.ADDRESS.COUNTRY).toBe('DE')
        }
    })

    // ── RECIPIENT.PERSON_NO = '' → undefined ──

    it('transforms empty RECIPIENT PERSON_NO to undefined', () => {
        const base = {
            ...validBase,
            DOCUMENT: {
                ...validBase.DOCUMENT,
                RECIPIENT: { ...validBase.DOCUMENT.RECIPIENT, PERSON_NO: '' },
            },
        }
        const result = McbsXmlInvoiceSchema.safeParse(base)
        expect(result.success).toBe(true)
        if (result.success) {
            expect(result.data.DOCUMENT.RECIPIENT.PERSON_NO).toBeUndefined()
        }
    })

    // ── CUSTOMER fields: '' → undefined ──

    it('transforms empty CUSTOMER fields to undefined', () => {
        const base = {
            ...validBase,
            DOCUMENT: {
                ...validBase.DOCUMENT,
                CUSTOMER: { PERSON_NO: '', VAT_ID: '' },
            },
        }
        const result = McbsXmlInvoiceSchema.safeParse(base)
        expect(result.success).toBe(true)
        if (result.success) {
            expect(result.data.DOCUMENT.CUSTOMER?.PERSON_NO).toBeUndefined()
            expect(result.data.DOCUMENT.CUSTOMER?.VAT_ID).toBeUndefined()
        }
    })

    // ── parseMcbsDocument: success path ──

    it('parseMcbsDocument returns parsed data for valid input', () => {
        const doc = parseMcbsDocument(<Record<string, unknown>>validBase.DOCUMENT)
        expect(doc.HEADER.INVOICE_NO).toBe('INV-001')
    })

    // ── parseMcbsDocument: error path ──

    it('parseMcbsDocument throws with formatted error for invalid input', () => {
        expect(() =>
            parseMcbsDocument(<Record<string, unknown>>{ HEADER: { INVOICE_DATE: 'invalid' } })
        ).toThrow('Invalid MCBS XML structure:')
    })

    // ── germanDecimal: Tausenderpunkt-Format ──

    it('parses German thousand-separator decimal correctly', () => {
        const base = {
            ...validBase,
            DOCUMENT: {
                ...validBase.DOCUMENT,
                INVOICE_DATA: {
                    ...validBase.DOCUMENT.INVOICE_DATA,
                    FRAMES: {
                        ...validBase.DOCUMENT.INVOICE_DATA.FRAMES,
                        AMOUNTS: {
                            AMOUNT: [
                                { TYPE: 'TOTAL_NET', VALUE: '1.234,56' },
                                { TYPE: 'TOTAL_VAT', VALUE: '234,56' },
                                { TYPE: 'TOTAL', VALUE: '1.469,12' },
                            ],
                        },
                    },
                },
            },
        }
        const result = McbsXmlInvoiceSchema.safeParse(base)
        expect(result.success).toBe(true)
        if (result.success) {
            expect(result.data.DOCUMENT.INVOICE_DATA.FRAMES.AMOUNTS.NET_AMOUNT).toBe(1234.56)
        }
    })
})