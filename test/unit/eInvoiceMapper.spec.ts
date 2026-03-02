import {
  buildBuyer,
  buildPaymentMeans,
  buildSeller,
  formatAmount,
  mapToEInvoice,
} from '../../src/mappers/eInvoiceMapper'
import {
  CommonInvoice,
  InvoiceType,
  TaxCategoryCode,
  UnitCode,
  PaymentMeansCode,
} from '../../src/models/commonInvoice'

// ==================== Fixture ====================

function createInvoice(): CommonInvoice {
  return {
    invoiceNumber: 'INV-TEST-001',
    invoiceDate: '2026-02-21',
    invoiceType: InvoiceType.COMMERCIAL,
    currency: 'EUR',
    source: {
      system: 'MCBS',
      id: 'mcbs-123',
      timestamp: '2026-02-22T10:00:00Z',
    },
    seller: {
      name: 'freenet DLS GmbH',
      postalAddress: {
        postalCode: '24937',
        cityName: 'Flensburg',
        countryCode: 'DE',
      },
      electronicAddress: {
        value: 'rechnung@freenet.example',
        schemeId: 'EM',
      },
      taxRegistration: [
        {
          id: {
            value: 'DE123456789',
            schemeId: 'VA',
          },
        },
      ],
    },
    buyer: {
      name: 'Erika Mustermann',
      postalAddress: {
        postalCode: '12345',
        cityName: 'Berlin',
        countryCode: 'DE',
      },
    },
    lineItems: [
      {
        id: 1,
        name: 'freenet Unlimited Tarif',
        description: 'Monatlicher Mobilfunktarif',
        quantity: 1,
        unitCode: UnitCode.PIECE,
        unitPrice: 100,
        netAmount: 100,
        tax: {
          typeCode: 'VAT',
          categoryCode: TaxCategoryCode.STANDARD,
          rate: 19,
        },
      },
    ],
    paymentMeans: [
      {
        typeCode: PaymentMeansCode.SEPA_DIRECT_DEBIT,
        information: 'SEPA-Lastschrift',
        payeeAccount: {
          iban: 'DE44500105175407324931',
          accountName: 'freenet DLS GmbH',
        },
        payeeInstitution: {
          bic: 'INGDDEFFXXX',
        },
        mandate: {
          reference: 'MANDATE-123',
        },
      },
    ],
    paymentTerms: {
      description: 'Zahlbar innerhalb von 14 Tagen',
    },
    taxes: [
      {
        typeCode: 'VAT',
        categoryCode: TaxCategoryCode.STANDARD,
        rate: 19,
        basisAmount: 100,
        calculatedAmount: 19,
      },
    ],
    totals: {
      lineTotal: 100,
      taxBasisTotal: 100,
      taxTotal: 19,
      grandTotal: 119,
      duePayable: 119,
      totalPrepaidAmount: 0,
    },
  }
}

// ==================== Tests ====================

describe('eInvoiceMapper', () => {
  it('maps optional and numeric fields correctly', () => {
    const invoice = createInvoice()
    const mapped = mapToEInvoice(invoice)
    const ublInvoice = mapped['ubl:Invoice']

    expect(ublInvoice['cbc:IssueDate']).toBe('2026-02-21')
    expect(ublInvoice['cac:PaymentTerms']).toEqual({
      'cbc:Note': 'Zahlbar innerhalb von 14 Tagen',
    })
    expect(ublInvoice['cac:LegalMonetaryTotal']).toMatchObject({
      'cbc:LineExtensionAmount': '100.00',
      'cbc:TaxInclusiveAmount': '119.00',
      'cbc:PrepaidAmount': '0.00',
    })
    expect(ublInvoice['cac:InvoiceLine'][0]).toMatchObject({
      'cbc:InvoicedQuantity': '1',
      'cbc:LineExtensionAmount': '100.00',
      'cbc:Note': 'Monatlicher Mobilfunktarif', // description → Note
    })
  })

  it('builds seller contact fields when contact is present', () => {
    const invoice = createInvoice()
    invoice.seller.contact = {
      name: 'Support Team',
      telephone: '+49-123-456789',
      email: 'support@freenet.example',
    }

    const seller = buildSeller(invoice)
    expect(seller).toMatchObject({
      'cac:Party': {
        'cac:Contact': {
          'cbc:Name': 'Support Team',
          'cbc:Telephone': '+49-123-456789',
          'cbc:ElectronicMail': 'support@freenet.example',
        },
      },
    })
  })

  it('builds buyer endpoint id when electronic address exists', () => {
    const invoice = createInvoice()
    invoice.buyer.electronicAddress = {
      value: 'buyer@example.org',
      schemeId: 'EM',
    }

    const buyer = buildBuyer(invoice)
    expect(buyer).toMatchObject({
      'cac:Party': {
        'cbc:EndpointID': 'buyer@example.org',
        'cbc:EndpointID@schemeID': 'EM',
      },
    })
  })

  it('omits optional structures when optional input fields are missing', () => {
    const invoice = createInvoice()
    invoice.paymentTerms = undefined
    invoice.totals.totalPrepaidAmount = undefined
    invoice.seller.electronicAddress = undefined
    invoice.seller.taxRegistration = undefined
    invoice.seller.contact = {}
    invoice.buyer.electronicAddress = undefined
    const [firstLineItem] = invoice.lineItems
    expect(firstLineItem).toBeDefined()
    ;(<NonNullable<typeof firstLineItem>>firstLineItem).description = undefined
    invoice.paymentMeans = [{ typeCode: PaymentMeansCode.CREDIT_TRANSFER }]

    const mapped = mapToEInvoice(invoice)
    const ublInvoice = mapped['ubl:Invoice']

    expect(ublInvoice['cac:PaymentTerms']).toBeUndefined()
    expect(ublInvoice['cac:LegalMonetaryTotal']['cbc:PrepaidAmount']).toBeUndefined()
    expect(ublInvoice['cac:InvoiceLine'][0]['cbc:Note']).toBeUndefined()
    expect(ublInvoice['cac:InvoiceLine'][0]['cac:Item']['cbc:Description']).toBeUndefined()

    const seller = buildSeller(invoice)
    const sellerParty = <Record<string, unknown>>seller['cac:Party']
    expect(sellerParty['cbc:EndpointID']).toBeUndefined()
    expect(sellerParty['cac:PartyTaxScheme']).toBeUndefined()
    expect(sellerParty['cac:Contact']).toEqual({})

    const buyer = buildBuyer(invoice)
    const buyerParty = <Record<string, unknown>>buyer['cac:Party']
    expect(buyerParty['cbc:EndpointID']).toBeUndefined()

    const [firstPaymentMeans] = invoice.paymentMeans
    expect(firstPaymentMeans).toBeDefined()
    const paymentMeans = buildPaymentMeans(
      <NonNullable<typeof firstPaymentMeans>>firstPaymentMeans
    )
    expect(paymentMeans).toEqual({ 'cbc:PaymentMeansCode': '58' })
  })

  it('builds payment means with account, institution and mandate data', () => {
    const invoice = createInvoice()
    const [firstPaymentMeans] = invoice.paymentMeans
    expect(firstPaymentMeans).toBeDefined()
    const paymentMeans = buildPaymentMeans(
      <NonNullable<typeof firstPaymentMeans>>firstPaymentMeans
    )

    expect(paymentMeans).toEqual({
      'cbc:PaymentMeansCode': '59',
      'cbc:PaymentMeansCode@name': 'SEPA-Lastschrift',
      'cac:PayeeFinancialAccount': {
        'cbc:ID': 'DE44500105175407324931',
        'cbc:Name': 'freenet DLS GmbH',
        'cac:FinancialInstitutionBranch': {
          'cbc:ID': 'INGDDEFFXXX',
        },
      },
      'cac:PaymentMandate': {
        'cbc:ID': 'MANDATE-123',
      },
    })
  })

  it('formats amounts with two decimal places', () => {
    expect(formatAmount(12)).toBe('12.00')
    expect(formatAmount(12.3)).toBe('12.30')
    expect(formatAmount(12.345)).toBe('12.35')
  })
})
