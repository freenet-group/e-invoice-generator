import {McbsXmlRootSchema as McbsXmlInvoiceSchema} from '../../../src/adapters/mcbs/zod/mcbsXmlInvoiceSchema'

describe('McbsXmlInvoiceSchema', () => {
    it('should validate a valid XML invoice', () => {
        const validInvoice = {} // Beispiel für eine gültige Rechnung
        const result = McbsXmlInvoiceSchema.safeParse(validInvoice)
        expect(result.success).toBe(true)
    })

    it('should invalidate an invalid XML invoice', () => {
        const invalidInvoice = {} // Beispiel für eine ungültige Rechnung
        const result = McbsXmlInvoiceSchema.safeParse(invalidInvoice)
        expect(result.success).toBe(false)
    })
})
