import {getInvoiceFormat} from '../../../src/config/eInvoiceProfileConfiguration'

describe('eInvoiceProfileConfiguration', () => {
    beforeEach(() => {
        delete process.env['E_INVOICE_PROFILE']
    })

    afterEach(() => {
        delete process.env['E_INVOICE_PROFILE']
    })

    it('returns default format when E_INVOICE_PROFILE is not set', () => {
        delete process.env['E_INVOICE_PROFILE']
        expect(getInvoiceFormat()).toBe('factur-x-en16931')
    })

    it('returns valid format when E_INVOICE_PROFILE is set', () => {
        process.env['E_INVOICE_PROFILE'] = 'factur-x-xrechnung'
        expect(getInvoiceFormat()).toBe('factur-x-xrechnung')
    })

    // ── Zeile 15: ungültiges Format ──
    it('throws when E_INVOICE_PROFILE is invalid (Zeile 15)', () => {
        process.env['E_INVOICE_PROFILE'] = 'invalid-format'
        expect(() => getInvoiceFormat()).toThrow("Ungültiges E_INVOICE_PROFILE: 'invalid-format'")
    })
})
