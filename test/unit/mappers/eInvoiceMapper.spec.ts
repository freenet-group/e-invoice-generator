import {buildBuyer, buildPaymentMeans, buildSeller, mapToEInvoice} from '../../../src/mappers/eInvoiceMapper'
import {CommonInvoice, InvoiceType, PaymentMeansCode, TaxCategoryCode, UnitCode} from '../../../src/models/commonInvoice'

const baseInvoice: CommonInvoice = {
    invoiceNumber: 'INV-001',
    invoiceDate: '2025-01-01',
    invoiceType: InvoiceType.COMMERCIAL,
    currency: 'EUR',
    buyerReference: 'REF-001',
    seller: {
        name: 'Seller GmbH',
        postalAddress: {
            streetName: 'Seller Str. 1',
            cityName: 'Berlin',
            postalCode: '10001',
            countryCode: 'DE'
        }
    },
    buyer: {
        name: 'Buyer AG',
        postalAddress: {
            streetName: 'Buyer Str. 2',
            cityName: 'Hamburg',
            postalCode: '20001',
            countryCode: 'DE'
        }
    },
    paymentMeans: [
        {
            typeCode: PaymentMeansCode.CREDIT_TRANSFER,
            payeeAccount: {iban: 'DE89370400440532013000'},
            payeeInstitution: {bic: 'COBADEFFXXX'}
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
    },
    lineItems: [
        {
            id: 1,
            name: 'Test Produkt',
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
    source: {system: 'MCBS', timestamp: '2025-01-01T00:00:00Z', partyId: 'P-001', billingAccountId: 'BA-TEST'},
    pdf: {s3Bucket: 'bucket', s3Key: 'key.pdf'}
}

describe('eInvoiceMapper', () => {
    // ── buildPaymentTerms ──

    it('builds paymentTerms with dueDate only', () => {
        const ci: CommonInvoice = {...baseInvoice, paymentTerms: {dueDate: '2025-02-01'}}
        const invoice = <Record<string, unknown>>mapToEInvoice(ci)['ubl:Invoice']
        const paymentTerms = <Record<string, unknown>>invoice['cac:PaymentTerms']
        expect(paymentTerms['cbc:Note']).toBe('Fällig am: 2025-02-01')
    })

    it('builds paymentTerms with description only', () => {
        const ci: CommonInvoice = {...baseInvoice, paymentTerms: {description: '30 Tage netto'}}
        const invoice = <Record<string, unknown>>mapToEInvoice(ci)['ubl:Invoice']
        const paymentTerms = <Record<string, unknown>>invoice['cac:PaymentTerms']
        expect(paymentTerms['cbc:Note']).toBe('30 Tage netto')
    })

    it('builds paymentTerms with both description and dueDate', () => {
        const ci: CommonInvoice = {
            ...baseInvoice,
            paymentTerms: {description: '30 Tage netto', dueDate: '2025-02-01'}
        }
        const invoice = <Record<string, unknown>>mapToEInvoice(ci)['ubl:Invoice']
        const paymentTerms = <Record<string, unknown>>invoice['cac:PaymentTerms']
        expect(paymentTerms['cbc:Note']).toBe('30 Tage netto – Fällig am: 2025-02-01')
    })

    it('omits paymentTerms when undefined', () => {
        const ci: CommonInvoice = {...baseInvoice, paymentTerms: undefined}
        const invoice = <Record<string, unknown>>mapToEInvoice(ci)['ubl:Invoice']
        expect(invoice['cac:PaymentTerms']).toBeUndefined()
    })

    // ── buildTaxTotal ──

    it('omits Percent and adds TaxExemptionReasonCode for OUTSIDE_SCOPE tax', () => {
        const ci: CommonInvoice = {
            ...baseInvoice,
            taxes: [
                {
                    typeCode: 'VAT',
                    categoryCode: TaxCategoryCode.OUTSIDE_SCOPE,
                    rate: 0,
                    basisAmount: 100,
                    calculatedAmount: 0
                }
            ]
        }
        const invoice = <Record<string, unknown>>mapToEInvoice(ci)['ubl:Invoice']
        const taxTotals = <Record<string, unknown>[]>invoice['cac:TaxTotal']
        expect(taxTotals).toHaveLength(1)
        const taxSubtotals = <Record<string, unknown>[]>taxTotals[0]?.['cac:TaxSubtotal']
        expect(taxSubtotals).toHaveLength(1)
        const taxCategory = <Record<string, unknown>>taxSubtotals[0]?.['cac:TaxCategory']
        expect(taxCategory['cbc:Percent']).toBeUndefined()
        expect(taxCategory['cbc:TaxExemptionReasonCode']).toBe('VATEX-EU-O')
    })

    it('adds TaxExemptionReason for EXEMPT tax', () => {
        const ci: CommonInvoice = {
            ...baseInvoice,
            taxes: [
                {
                    typeCode: 'VAT',
                    categoryCode: TaxCategoryCode.EXEMPT,
                    rate: 0,
                    basisAmount: 100,
                    calculatedAmount: 0
                }
            ]
        }
        const invoice = <Record<string, unknown>>mapToEInvoice(ci)['ubl:Invoice']
        const taxTotals = <Record<string, unknown>[]>invoice['cac:TaxTotal']
        expect(taxTotals).toHaveLength(1)
        const taxSubtotals = <Record<string, unknown>[]>taxTotals[0]?.['cac:TaxSubtotal']
        expect(taxSubtotals).toHaveLength(1)
        const taxCategory = <Record<string, unknown>>taxSubtotals[0]?.['cac:TaxCategory']
        expect(taxCategory['cbc:TaxExemptionReason']).toBe('Umsatzsteuerbefreit gemäß § 3a Abs. 5 UStG')
    })

    // ── buildLegalMonetaryTotal ──

    it('includes PrepaidAmount when totalPrepaidAmount is set', () => {
        const ci: CommonInvoice = {
            ...baseInvoice,
            totals: {...baseInvoice.totals, totalPrepaidAmount: -50, duePayable: 69}
        }
        const invoice = <Record<string, unknown>>mapToEInvoice(ci)['ubl:Invoice']
        const monetary = <Record<string, unknown>>invoice['cac:LegalMonetaryTotal']
        expect(monetary['cbc:PrepaidAmount']).toBe('-50.00')
    })

    // ── buildSeller ──

    it('includes electronicAddress in seller when set', () => {
        const ci: CommonInvoice = {
            ...baseInvoice,
            seller: {...baseInvoice.seller, electronicAddress: {value: '0088:123456789', schemeId: '0088'}}
        }
        const party = <Record<string, unknown>>buildSeller(ci)['cac:Party']
        expect(party['cbc:EndpointID']).toBe('0088:123456789')
        expect(party['cbc:EndpointID@schemeID']).toBe('0088')
    })

    it('includes taxRegistration in seller when set', () => {
        const ci: CommonInvoice = {
            ...baseInvoice,
            seller: {
                ...baseInvoice.seller,
                taxRegistration: [{id: {value: 'DE123456789', schemeId: 'VAT'}}]
            }
        }
        const party = <Record<string, unknown>>buildSeller(ci)['cac:Party']
        const taxSchemes = <Record<string, unknown>[]>party['cac:PartyTaxScheme']
        expect(taxSchemes[0]?.['cbc:CompanyID']).toBe('DE123456789')
    })

    it('includes contact in seller when set', () => {
        const ci: CommonInvoice = {
            ...baseInvoice,
            seller: {
                ...baseInvoice.seller,
                contact: {name: 'Max Muster', telephone: '+49123456', email: 'max@example.com'}
            }
        }
        const party = <Record<string, unknown>>buildSeller(ci)['cac:Party']
        const contact = <Record<string, unknown>>party['cac:Contact']
        expect(contact['cbc:Name']).toBe('Max Muster')
        expect(contact['cbc:Telephone']).toBe('+49123456')
        expect(contact['cbc:ElectronicMail']).toBe('max@example.com')
    })

    // ── buildBuyer ──

    it('includes electronicAddress in buyer when set', () => {
        const ci: CommonInvoice = {
            ...baseInvoice,
            buyer: {...baseInvoice.buyer, electronicAddress: {value: '0088:987654321', schemeId: '0088'}}
        }
        const party = <Record<string, unknown>>buildBuyer(ci)['cac:Party']
        expect(party['cbc:EndpointID']).toBe('0088:987654321')
    })

    // ── buildPaymentMeans ──

    it('includes information in paymentMeans when set', () => {
        const pm: CommonInvoice['paymentMeans'][number] = {
            typeCode: PaymentMeansCode.SEPA_DIRECT_DEBIT,
            information: 'SEPA Lastschrift'
        }
        expect(buildPaymentMeans(pm)['cbc:PaymentMeansCode@name']).toBe('SEPA Lastschrift')
    })

    it('includes mandate reference in paymentMeans when set', () => {
        const pm: CommonInvoice['paymentMeans'][number] = {
            typeCode: PaymentMeansCode.SEPA_DIRECT_DEBIT,
            mandate: {reference: 'MANDATE-001'}
        }
        const mandate = <Record<string, unknown>>buildPaymentMeans(pm)['cac:PaymentMandate']
        expect(mandate['cbc:ID']).toBe('MANDATE-001')
    })

    // ── buildInvoiceLines ──

    it('omits Percent for OUTSIDE_SCOPE line item tax', () => {
        const firstLineItem = baseInvoice.lineItems[0]
        if (firstLineItem === undefined) {
            throw new Error('baseInvoice.lineItems[0] is undefined')
        }
        const ci: CommonInvoice = {
            ...baseInvoice,
            lineItems: [
                {
                    ...firstLineItem,
                    tax: {typeCode: 'VAT', categoryCode: TaxCategoryCode.OUTSIDE_SCOPE, rate: 0}
                }
            ]
        }
        const invoice = <Record<string, unknown>>mapToEInvoice(ci)['ubl:Invoice']
        const lines = <Record<string, unknown>[]>invoice['cac:InvoiceLine']
        const item = <Record<string, unknown>>lines[0]?.['cac:Item']
        const taxCategory = <Record<string, unknown>>item['cac:ClassifiedTaxCategory']
        expect(taxCategory['cbc:Percent']).toBeUndefined()
    })

    it('includes period in line item when set', () => {
        const firstLineItem = baseInvoice.lineItems[0]
        if (firstLineItem === undefined) {
            throw new Error('baseInvoice.lineItems[0] is undefined')
        }
        const ci: CommonInvoice = {
            ...baseInvoice,
            lineItems: [
                {
                    ...firstLineItem,
                    period: {start: '2025-01-01', end: '2025-01-31'}
                }
            ]
        }
        const invoice = <Record<string, unknown>>mapToEInvoice(ci)['ubl:Invoice']
        const lines = <Record<string, unknown>[]>invoice['cac:InvoiceLine']
        const period = <Record<string, unknown>>lines[0]?.['cac:InvoicePeriod']
        expect(period['cbc:StartDate']).toBe('2025-01-01')
        expect(period['cbc:EndDate']).toBe('2025-01-31')
    })

    it('omits StartDate in period when start is undefined', () => {
        const firstLineItem = baseInvoice.lineItems[0]
        if (firstLineItem === undefined) {
            throw new Error('baseInvoice.lineItems[0] is undefined')
        }
        const ci: CommonInvoice = {
            ...baseInvoice,
            lineItems: [{...firstLineItem, period: {end: '2025-01-31'}}]
        }
        const invoice = <Record<string, unknown>>mapToEInvoice(ci)['ubl:Invoice']
        const lines = <Record<string, unknown>[]>invoice['cac:InvoiceLine']
        const period = <Record<string, unknown>>lines[0]?.['cac:InvoicePeriod']
        expect(period['cbc:StartDate']).toBeUndefined()
        expect(period['cbc:EndDate']).toBe('2025-01-31')
    })

    it('omits EndDate in period when end is undefined', () => {
        const firstLineItem = baseInvoice.lineItems[0]
        if (firstLineItem === undefined) {
            throw new Error('baseInvoice.lineItems[0] is undefined')
        }
        const ci: CommonInvoice = {
            ...baseInvoice,
            lineItems: [{...firstLineItem, period: {start: '2025-01-01'}}]
        }
        const invoice = <Record<string, unknown>>mapToEInvoice(ci)['ubl:Invoice']
        const lines = <Record<string, unknown>[]>invoice['cac:InvoiceLine']
        const period = <Record<string, unknown>>lines[0]?.['cac:InvoicePeriod']
        expect(period['cbc:StartDate']).toBe('2025-01-01')
        expect(period['cbc:EndDate']).toBeUndefined()
    })

    it('includes description in Note and Item when set', () => {
        const firstLineItem = baseInvoice.lineItems[0]
        if (firstLineItem === undefined) {
            throw new Error('baseInvoice.lineItems[0] is undefined')
        }
        const ci: CommonInvoice = {
            ...baseInvoice,
            lineItems: [{...firstLineItem, description: 'Detailed service description'}]
        }
        const invoice = <Record<string, unknown>>mapToEInvoice(ci)['ubl:Invoice']
        const lines = <Record<string, unknown>[]>invoice['cac:InvoiceLine']
        expect(lines[0]?.['cbc:Note']).toBe('Detailed service description')
        const item = <Record<string, unknown>>lines[0]?.['cac:Item']
        expect(item['cbc:Description']).toBe('Detailed service description')
    })

    it('includes contact with partial fields in seller', () => {
        const ci: CommonInvoice = {
            ...baseInvoice,
            seller: {
                ...baseInvoice.seller,
                contact: {name: 'Only Name'}
            }
        }
        const party = <Record<string, unknown>>buildSeller(ci)['cac:Party']
        const contact = <Record<string, unknown>>party['cac:Contact']
        expect(contact['cbc:Name']).toBe('Only Name')
        expect(contact['cbc:Telephone']).toBeUndefined()
        expect(contact['cbc:ElectronicMail']).toBeUndefined()
    })

    it('includes payeeAccount without iban or bic', () => {
        const pm: CommonInvoice['paymentMeans'][number] = {
            typeCode: PaymentMeansCode.CREDIT_TRANSFER,
            payeeAccount: {accountName: 'My Account'}
        }
        const result = buildPaymentMeans(pm)
        const account = <Record<string, unknown>>result['cac:PayeeFinancialAccount']
        expect(account['cbc:ID']).toBeUndefined()
        expect(account['cbc:Name']).toBe('My Account')
        expect(account['cac:FinancialInstitutionBranch']).toBeUndefined()
    })

    it('omits FinancialInstitutionBranch when bic is not provided', () => {
        const pm: CommonInvoice['paymentMeans'][number] = {
            typeCode: PaymentMeansCode.CREDIT_TRANSFER,
            payeeAccount: {iban: 'DE89370400440532013000'}
        }
        const result = buildPaymentMeans(pm)
        const account = <Record<string, unknown>>result['cac:PayeeFinancialAccount']
        expect(account['cac:FinancialInstitutionBranch']).toBeUndefined()
    })
})
