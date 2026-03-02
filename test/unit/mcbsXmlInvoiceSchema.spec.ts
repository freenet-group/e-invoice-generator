import { parseMcbsDocument, McbsDocument } from '../../src/adapters/mcbs/zod/mcbsXmlInvoiceSchema'

// ==================== Fixtures ====================

function buildMinimalDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        TYPE: 'RG',
        ID: '123',
        HEADER: {
            INVOICE_DATE: '22.02.2026',
            INV_CURRENCY: 'EUR',
        },
        RECIPIENT: {
            ADDRESS: {},
        },
        INVOICE_DATA: {
            PAYMENT_MODE: {
                PAYMENT_TYPE: 'SEPADEBIT',
                DUE_DATE: '22.02.2026',
            },
            FRAMES: {
                FRAME: [],
                AMOUNTS: {
                    AMOUNT: [
                        { TYPE: 'TOTAL_NET', VALUE: '24,35' },
                        { TYPE: 'TOTAL_VAT', VALUE: '4,63' },
                        { TYPE: 'TOTAL', VALUE: '28,98' },
                        { TYPE: 'SUBTOTAL', VALUE: '28,98' },
                        { TYPE: 'INSEP_GROSS', VALUE: '0,99' },
                    ],
                },
                DIFF_VATS: {},
            },
        },
        ...overrides,
    }
}

// ==================== parseMcbsDocument ====================

describe('parseMcbsDocument', () => {

    // ==================== Happy Path ====================

    it('parses a minimal valid document', () => {
        const doc = parseMcbsDocument(buildMinimalDoc())

        expect(doc.ID).toBe('123')
        expect(doc.TYPE).toBe('RG')
        expect(doc.HEADER.INVOICE_DATE).toBe('2026-02-22')
        expect(doc.HEADER.INV_CURRENCY).toBe('EUR')
    })

    it('applies default TYPE "RG" when omitted', () => {
        const raw = buildMinimalDoc()
        delete raw['TYPE']
        const doc = parseMcbsDocument(raw)

        expect(doc.TYPE).toBe('RG')
    })

    it('applies default currency EUR when omitted', () => {
        const raw = buildMinimalDoc()
        const header = <Record<string, unknown>>raw['HEADER']
        delete header['INV_CURRENCY']
        const doc = parseMcbsDocument(raw)

        expect(doc.HEADER.INV_CURRENCY).toBe('EUR')
    })

    it('applies default country DE when ADDRESS has no COUNTRY', () => {
        const doc = parseMcbsDocument(buildMinimalDoc())

        expect(doc.RECIPIENT.ADDRESS.COUNTRY).toBe('DE')
    })

    it('applies default PAYMENT_TYPE TRANSFER when omitted', () => {
        const raw = buildMinimalDoc()
        const paymentMode = <Record<string, unknown>>(<Record<string, unknown>>raw['INVOICE_DATA'])['PAYMENT_MODE']
        delete paymentMode['PAYMENT_TYPE']
        const doc = parseMcbsDocument(raw)

        expect(doc.INVOICE_DATA.PAYMENT_MODE.PAYMENT_TYPE).toBe('TRANSFER')
    })

    it('applies default VAT_RATE 19 when omitted on BILLITEM', () => {
        const raw = buildMinimalDoc({
            INVOICE_DATA: {
                PAYMENT_MODE: { PAYMENT_TYPE: 'SEPADEBIT', DUE_DATE: '22.02.2026' },
                FRAMES: {
                    FRAME: [{
                        AREA: {
                            UNIT: [{
                                SECTIONS: {
                                    SECTION: [{
                                        BILLITEM_GRPS: {
                                            BILLITEM_GRP: [{
                                                BILLITEMS: {
                                                    BILLITEM: [{
                                                        PRODUCT_NAME: 'TestItem',
                                                        CHARGE: '10,00',
                                                        // VAT_RATE fehlt → default 19
                                                    }],
                                                },
                                            }],
                                        },
                                    }],
                                },
                            }],
                        },
                    }],
                    AMOUNTS: { AMOUNT: [{ TYPE: 'TOTAL', VALUE: '10,00' }] },
                    DIFF_VATS: {},
                },
            },
        })

        const doc = parseMcbsDocument(raw)
        const billitem = doc.INVOICE_DATA.FRAMES.FRAME[0]
            ?.AREA?.UNIT[0]
            ?.SECTIONS?.SECTION[0]
            ?.BILLITEM_GRPS?.BILLITEM_GRP[0]
            ?.BILLITEMS?.BILLITEM[0]

        expect(billitem?.VAT_RATE).toBe(19)
    })

    it('accepts VAT_RATE "INCLUDED" on BILLITEM', () => {
        const raw = buildMinimalDoc({
            INVOICE_DATA: {
                PAYMENT_MODE: { PAYMENT_TYPE: 'SEPADEBIT', DUE_DATE: '22.02.2026' },
                FRAMES: {
                    FRAME: [{
                        AREA: {
                            UNIT: [{
                                SECTIONS: {
                                    SECTION: [{
                                        BILLITEM_GRPS: {
                                            BILLITEM_GRP: [{
                                                BILLITEMS: {
                                                    BILLITEM: [{
                                                        PRODUCT_NAME: 'TestItem',
                                                        CHARGE: '5,00',
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
                    AMOUNTS: { AMOUNT: [{ TYPE: 'TOTAL', VALUE: '5,00' }] },
                    DIFF_VATS: {},
                },
            },
        })

        const doc = parseMcbsDocument(raw)
        const billitem = doc.INVOICE_DATA.FRAMES.FRAME[0]
            ?.AREA?.UNIT[0]
            ?.SECTIONS?.SECTION[0]
            ?.BILLITEM_GRPS?.BILLITEM_GRP[0]
            ?.BILLITEMS?.BILLITEM[0]

        expect(billitem?.VAT_RATE).toBe('INCLUDED')
    })

    // ==================== germanDecimal ====================

    it('parses german decimal with comma', () => {
        const doc = parseMcbsDocument(buildMinimalDoc())
        const amounts = doc.INVOICE_DATA.FRAMES.AMOUNTS

        // buildMinimalDoc enthält bereits '24,35' als TOTAL_NET
        expect(amounts.NET_AMOUNT).toBe(24.35)
    })

    it('parses german decimal with thousands separator', () => {
        const raw = buildMinimalDoc({
            INVOICE_DATA: {
                PAYMENT_MODE: { PAYMENT_TYPE: 'TRANSFER' },
                FRAMES: {
                    FRAME: [],
                    AMOUNTS: {
                        AMOUNT: [
                            { TYPE: 'TOTAL_NET', VALUE: '1.234,56' },
                            { TYPE: 'TOTAL', VALUE: '1.234,56' },
                        ],
                    },
                    DIFF_VATS: {},
                },
            },
        })

        const doc = parseMcbsDocument(raw)

        expect(doc.INVOICE_DATA.FRAMES.AMOUNTS.NET_AMOUNT).toBe(1234.56)
    })

    it('throws on invalid german decimal', () => {
        const raw = buildMinimalDoc({
            INVOICE_DATA: {
                PAYMENT_MODE: { PAYMENT_TYPE: 'TRANSFER' },
                FRAMES: {
                    FRAME: [],
                    AMOUNTS: {
                        AMOUNT: [
                            { TYPE: 'TOTAL_NET', VALUE: 'not-a-number' },
                            { TYPE: 'TOTAL', VALUE: 'not-a-number' },
                        ],
                    },
                    DIFF_VATS: {},
                },
            },
        })

        expect(() => parseMcbsDocument(raw)).toThrow()
    })

    // ==================== germanDate ====================

    it('parses german date to ISO format', () => {
        const doc = parseMcbsDocument(buildMinimalDoc())

        expect(doc.HEADER.INVOICE_DATE).toBe('2026-02-22')
    })

    it('parses DUE_DATE in PAYMENT_MODE', () => {
        const doc = parseMcbsDocument(buildMinimalDoc())

        expect(doc.INVOICE_DATA.PAYMENT_MODE.DUE_DATE).toBe('2026-02-22')
    })

    it('throws on invalid german date format', () => {
        const raw: Record<string, unknown> = buildMinimalDoc()
        const header = <Record<string, unknown>>raw['HEADER']
        header['INVOICE_DATE'] = '2026-02-22'

        expect(() => parseMcbsDocument(raw)).toThrow('Invalid MCBS XML structure')
    })

    // ==================== xmlArray ====================

    it('wraps single FRAME object into array', () => {
        const raw = buildMinimalDoc({
            INVOICE_DATA: {
                PAYMENT_MODE: { PAYMENT_TYPE: 'TRANSFER' },
                FRAMES: {
                    FRAME: { ID: 'single-frame' },
                    AMOUNTS: { AMOUNT: [] },
                    DIFF_VATS: {},
                },
            },
        })

        const doc = parseMcbsDocument(raw)

        expect(doc.INVOICE_DATA.FRAMES.FRAME).toHaveLength(1)
        expect(doc.INVOICE_DATA.FRAMES.FRAME[0]?.ID).toBe('single-frame')
    })

    it('handles empty FRAME array', () => {
        const doc = parseMcbsDocument(buildMinimalDoc())

        expect(doc.INVOICE_DATA.FRAMES.FRAME).toEqual([])
    })

    it('handles null DIFF_VAT as empty array', () => {
        const raw = buildMinimalDoc({
            INVOICE_DATA: {
                PAYMENT_MODE: { PAYMENT_TYPE: 'TRANSFER' },
                FRAMES: {
                    FRAME: [],
                    AMOUNTS: { AMOUNT: [] },
                    DIFF_VATS: { DIFF_VAT: null },
                },
            },
        })

        const doc = parseMcbsDocument(raw)

        expect(doc.INVOICE_DATA.FRAMES.DIFF_VATS.DIFF_VAT).toEqual([])
    })

    it('wraps single BILLITEM_GRP into array', () => {
        const raw = buildMinimalDoc({
            INVOICE_DATA: {
                PAYMENT_MODE: { PAYMENT_TYPE: 'TRANSFER' },
                FRAMES: {
                    FRAME: [{
                        AREA: {
                            UNIT: [{
                                SECTIONS: {
                                    SECTION: {
                                        BILLITEM_GRPS: {
                                            BILLITEM_GRP: {
                                                TITLE: 'single-grp',
                                                BILLITEMS: {
                                                    BILLITEM: {
                                                        PRODUCT_NAME: 'Item',
                                                        CHARGE: '1,00',
                                                    },
                                                },
                                            },
                                        },
                                    },
                                },
                            }],
                        },
                    }],
                    AMOUNTS: { AMOUNT: [] },
                    DIFF_VATS: {},
                },
            },
        })

        const doc = parseMcbsDocument(raw)
        const grps = doc.INVOICE_DATA.FRAMES.FRAME[0]
            ?.AREA?.UNIT[0]
            ?.SECTIONS?.SECTION[0]
            ?.BILLITEM_GRPS?.BILLITEM_GRP

        expect(grps).toHaveLength(1)
        expect(grps?.[0]?.TITLE).toBe('single-grp')
    })

    // ==================== AMOUNTS transform ====================

    it('transforms AMOUNTS to named fields', () => {
        const doc = parseMcbsDocument(buildMinimalDoc())
        const amounts = doc.INVOICE_DATA.FRAMES.AMOUNTS

        expect(amounts.NET_AMOUNT).toBe(24.35)
        expect(amounts.VAT_AMOUNT).toBe(4.63)
        expect(amounts.GROSS_AMOUNT).toBe(28.98)
        expect(amounts.SUBTOTAL).toBe(28.98)
        expect(amounts.INSEP_GROSS).toBe(0.99)
    })

    it('returns 0 for missing AMOUNTS types', () => {
        const raw = buildMinimalDoc({
            INVOICE_DATA: {
                PAYMENT_MODE: { PAYMENT_TYPE: 'TRANSFER' },
                FRAMES: {
                    FRAME: [],
                    AMOUNTS: { AMOUNT: [] },
                    DIFF_VATS: {},
                },
            },
        })

        const doc = parseMcbsDocument(raw)
        const amounts = doc.INVOICE_DATA.FRAMES.AMOUNTS

        expect(amounts.NET_AMOUNT).toBe(0)
        expect(amounts.VAT_AMOUNT).toBe(0)
        expect(amounts.GROSS_AMOUNT).toBe(0)
    })

    // ==================== Error Handling ====================

    it('throws with formatted error message on invalid input', () => {
        expect(() => parseMcbsDocument({})).toThrow('Invalid MCBS XML structure')
    })

    it('includes field path in error message', () => {
        const raw = buildMinimalDoc()
        const header = <Record<string, unknown>>raw['HEADER']
        header['INVOICE_DATE'] = '2026-02-22'

        expect(() => parseMcbsDocument(raw)).toThrow('HEADER.INVOICE_DATE')
    })

    it('coerces numeric ID to string', () => {
        const raw = buildMinimalDoc({ ID: 12345 })
        const doc = parseMcbsDocument(raw)

        expect(doc.ID).toBe('12345')
    })

    it('parses full document with all optional fields', () => {
        const raw = buildMinimalDoc({
            HEADER: {
                INVOICE_DATE: '22.02.2026',
                INVOICE_NO: 'M26008957394',
                INV_CURRENCY: 'EUR',
                BILLRUN_ID: '150580',
                BILLING_SYSTEM: 'MCBS',
                SOURCE_SYSTEM: 'LIFE',
                MANDANT: 'MC',
                CLIENTBANK_ACNT: 'DE08214400450844443200',
                CLIENTBANK_CODE: 'COBADEFFXXX',
                BRAND: { DESC: 'freenet DLS GmbH', CODE_DESC: 'freenet' },
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
        })

        const doc: McbsDocument = parseMcbsDocument(raw)

        expect(doc.HEADER.INVOICE_NO).toBe('M26008957394')
        expect(doc.HEADER.BRAND?.DESC).toBe('freenet DLS GmbH')
        expect(doc.RECIPIENT.PERSON_NO).toBe('2120710')
        expect(doc.RECIPIENT.ADDRESS.FIRSTNAME).toBe('Erika')
        expect(doc.RECIPIENT.ADDRESS.NAME).toBe('Mustermann')
        expect(doc.RECIPIENT.ADDRESS.POSTCODE).toBe('20095')
        expect(doc.RECIPIENT.ADDRESS.CITY).toBe('Hamburg')
    })
})