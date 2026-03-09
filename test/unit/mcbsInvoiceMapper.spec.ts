import {parseMcbsXml, mapMcbsToCommonInvoice} from '../../src/adapters/mcbs/mcbsInvoiceMapper'
import {TaxCategoryCode, PaymentMeansCode, InvoiceType} from '../../src/models/commonInvoice'

const baseMetadata = {
    id: 'test-id',
    timestamp: '2025-01-01T00:00:00Z',
    s3Bucket: 'test-bucket',
    s3Key: 'test-key.xml'
}

function buildXml(overrides: {
    type?: string
    invoiceNo?: string
    paymentType?: string
    unpaid?: string
    vatRate?: string
    diffVatRate?: string
    insepGross?: string
    billitemExtra?: string
    customerId?: string
    customerVatId?: string
    recipientPersonNo?: string
    periodString?: string
    unitContractDataXml?: string
    brandXml?: string
    extraFrameXml?: string
}): string {
    const {
        type = 'RE',
        invoiceNo = 'INV-001',
        paymentType = 'TRANSFER',
        unpaid = '0',
        vatRate = '19',
        diffVatRate = '19',
        insepGross = '0',
        billitemExtra = '',
        customerId = '',
        customerVatId = '',
        recipientPersonNo = 'RECIP-001',
        periodString = '',
        unitContractDataXml = '',
        brandXml = '<BRAND><DESC>Test Brand</DESC></BRAND>',
        extraFrameXml = ''
    } = overrides

    const customerContent = [
        customerId === '' ? '' : `<PERSON_NO>${customerId}</PERSON_NO>`,
        customerVatId === '' ? '' : `<VAT_ID>${customerVatId}</VAT_ID>`
    ]
        .filter(Boolean)
        .join('\n    ')

    const amountEntries = [
        `<AMOUNT><TYPE>TOTAL_NET</TYPE><VALUE>100</VALUE></AMOUNT>`,
        `<AMOUNT><TYPE>TOTAL_VAT</TYPE><VALUE>19</VALUE></AMOUNT>`,
        `<AMOUNT><TYPE>TOTAL</TYPE><VALUE>119</VALUE></AMOUNT>`,
        insepGross === '0' ? '' : `<AMOUNT><TYPE>INSEP_GROSS</TYPE><VALUE>${insepGross}</VALUE></AMOUNT>`,
        unpaid === '0' ? '' : `<AMOUNT><TYPE>UNPAID</TYPE><VALUE>${unpaid}</VALUE></AMOUNT>`,
        `<AMOUNT><TYPE>TO_PAY</TYPE><VALUE>119</VALUE></AMOUNT>`
    ]
        .filter(Boolean)
        .join('\n        ')

    return `<?xml version="1.0"?>
<DOCUMENT>
  <TYPE>${type}</TYPE>
  <HEADER>
    <INVOICE_NO>${invoiceNo}</INVOICE_NO>
    <INVOICE_DATE>01.01.2025</INVOICE_DATE>
    <INV_CURRENCY>EUR</INV_CURRENCY>
    ${brandXml}
  </HEADER>
  ${customerContent === '' ? '' : `<CUSTOMER>${customerContent}</CUSTOMER>`}
  <RECIPIENT>
    <PERSON_NO>${recipientPersonNo}</PERSON_NO>
    <ADDRESS>
      <FIRSTNAME>Max</FIRSTNAME>
      <NAME>Mustermann</NAME>
      <STREET>Musterstr. 1</STREET>
      <CITY>Berlin</CITY>
      <POSTCODE>10001</POSTCODE>
      <COUNTRY>DE</COUNTRY>
    </ADDRESS>
  </RECIPIENT>
  <INVOICE_DATA>
    <PAYMENT_MODE>
      <PAYMENT_TYPE>${paymentType}</PAYMENT_TYPE>
      <DUE_DATE>01.02.2025</DUE_DATE>
      <BANK_ACCOUNT>DE89370400440532013000</BANK_ACCOUNT>
      <BANK_CODE>COBADEFFXXX</BANK_CODE>
    </PAYMENT_MODE>
    <FRAMES>
      <AMOUNTS>
        ${amountEntries}
      </AMOUNTS>
      <DIFF_VATS>
        <DIFF_VAT>
          <VAT_RATE>${diffVatRate}</VAT_RATE>
          <NET>100</NET>
          <VAT>19</VAT>
        </DIFF_VAT>
      </DIFF_VATS>
      <FRAME>
        <ID>MAIN</ID>
        <AREA>
          <UNIT>
            ${unitContractDataXml}
            <SECTIONS>
              <SECTION>
                <BILLITEM_GRPS>
                  <BILLITEM_GRP>
                    <BILLITEMS>
                      <BILLITEM>
                        <SEQUENCE_NO>1</SEQUENCE_NO>
                        <PRODUCT_NAME>Test Produkt</PRODUCT_NAME>
                        <CHARGE>100</CHARGE>
                        <VAT_RATE>${vatRate}</VAT_RATE>
                        ${periodString === '' ? '' : `<PERIOD>${periodString}</PERIOD>`}
                        ${billitemExtra}
                      </BILLITEM>
                    </BILLITEMS>
                  </BILLITEM_GRP>
                </BILLITEM_GRPS>
              </SECTION>
            </SECTIONS>
          </UNIT>
        </AREA>
      </FRAME>
      ${extraFrameXml}
    </FRAMES>
  </INVOICE_DATA>
</DOCUMENT>`
}

describe('mcbsInvoiceMapper', () => {
    // ── parseMcbsXml ──

    it('throws when DOCUMENT root element is missing', () => {
        const xml = '<OTHER><foo/></OTHER>'
        expect(() => parseMcbsXml(xml, 'test', baseMetadata)).toThrow('Invalid MCBS XML')
    })

    // ── mapMcbsToCommonInvoice: invoiceType ──

    it('maps TYPE=GS to CREDIT_NOTE', () => {
        const raw = parseMcbsXml(buildXml({type: 'GS'}), 'test', baseMetadata)
        const result = mapMcbsToCommonInvoice(raw)
        expect(result.invoiceType).toBe(InvoiceType.CREDIT_NOTE)
    })

    it('maps TYPE=RE to COMMERCIAL', () => {
        const raw = parseMcbsXml(buildXml({type: 'RE'}), 'test', baseMetadata)
        const result = mapMcbsToCommonInvoice(raw)
        expect(result.invoiceType).toBe(InvoiceType.COMMERCIAL)
    })

    // ── paymentMeans ──

    it('maps SEPADEBIT to SEPA_DIRECT_DEBIT', () => {
        const raw = parseMcbsXml(buildXml({paymentType: 'SEPADEBIT'}), 'test', baseMetadata)
        const result = mapMcbsToCommonInvoice(raw)
        expect(result.paymentMeans[0]?.typeCode).toBe(PaymentMeansCode.SEPA_DIRECT_DEBIT)
    })

    it('maps other payment type to CREDIT_TRANSFER', () => {
        const raw = parseMcbsXml(buildXml({paymentType: 'TRANSFER'}), 'test', baseMetadata)
        const result = mapMcbsToCommonInvoice(raw)
        expect(result.paymentMeans[0]?.typeCode).toBe(PaymentMeansCode.CREDIT_TRANSFER)
    })

    // ── totalPrepaidAmount ──

    it('sets totalPrepaidAmount when UNPAID is non-zero', () => {
        const raw = parseMcbsXml(buildXml({unpaid: '50'}), 'test', baseMetadata)
        const result = mapMcbsToCommonInvoice(raw)
        expect(result.totals.totalPrepaidAmount).toBe(-50)
    })

    it('omits totalPrepaidAmount when UNPAID is zero', () => {
        const raw = parseMcbsXml(buildXml({unpaid: '0'}), 'test', baseMetadata)
        const result = mapMcbsToCommonInvoice(raw)
        expect(result.totals.totalPrepaidAmount).toBeUndefined()
    })

    // ── mapTaxes: INSEP_GROSS > 0 (Zeile 400 EXEMPT) ──

    it('adds EXEMPT tax when INSEP_GROSS > 0', () => {
        const raw = parseMcbsXml(buildXml({insepGross: '20', diffVatRate: '19'}), 'test', baseMetadata)
        const result = mapMcbsToCommonInvoice(raw)
        const exemptTax = result.taxes.find((t) => t.categoryCode === TaxCategoryCode.EXEMPT)
        expect(exemptTax).toBeDefined()
        expect(exemptTax?.basisAmount).toBe(20)
    })

    // ── mapBillItem: VAT_RATE=INCLUDED → EXEMPT (Zeile 400) ──

    it('maps VAT_RATE=INCLUDED to EXEMPT tax category in line item', () => {
        const raw = parseMcbsXml(buildXml({vatRate: 'INCLUDED', diffVatRate: '0'}), 'test', baseMetadata)
        const result = mapMcbsToCommonInvoice(raw)
        expect(result.lineItems[0]?.tax.categoryCode).toBe(TaxCategoryCode.EXEMPT)
        expect(result.lineItems[0]?.tax.rate).toBe(0)
    })

    // ── mapBillItem: contentProvider (Zeile 409) ──

    it('maps contentProvider contact and services when present', () => {
        const billitemExtra = `
            <OPT_PARAMS>
                <CONT_PROVIDER>
                    <CONTACT>provider@example.com</CONTACT>
                    <SERVICES>Premium Service</SERVICES>
                </CONT_PROVIDER>
            </OPT_PARAMS>`
        const raw = parseMcbsXml(buildXml({billitemExtra}), 'test', baseMetadata)
        const result = mapMcbsToCommonInvoice(raw)
        expect(result.lineItems[0]?.contentProvider?.contact).toBe('provider@example.com')
        expect(result.lineItems[0]?.contentProvider?.services).toBe('Premium Service')
    })

    // ── parsePeriod: ungültiges Format (Zeile 262) ──

    it('omits period when period string has invalid format', () => {
        const raw = parseMcbsXml(buildXml({periodString: 'invalid-period'}), 'test', baseMetadata)
        const result = mapMcbsToCommonInvoice(raw)
        expect(result.lineItems[0]?.period).toBeUndefined()
    })

    it('maps valid period string to start/end dates', () => {
        const raw = parseMcbsXml(buildXml({periodString: '01.09.2025 - 28.02.2026'}), 'test', baseMetadata)
        const result = mapMcbsToCommonInvoice(raw)
        expect(result.lineItems[0]?.period?.start).toBe('2025-09-01')
        expect(result.lineItems[0]?.period?.end).toBe('2026-02-28')
    })

    // ── resolveSubscriberInfo: alle Felder undefined (Zeile 331-334) ──

    it('omits subscriberInfo when no contract data is present', () => {
        const raw = parseMcbsXml(buildXml({}), 'test', baseMetadata)
        const result = mapMcbsToCommonInvoice(raw)
        expect(result.lineItems[0]?.subscriberInfo).toBeUndefined()
    })

    // ── resolveBuyerReference ──

    it('uses PEPPOL_PA entry as buyerReference when TYPE=PEPPOL_PA', () => {
        const xml = `<?xml version="1.0"?>
<DOCUMENT>
  <TYPE>RE</TYPE>
  <HEADER>
    <INVOICE_NO>INV-001</INVOICE_NO>
    <INVOICE_DATE>01.01.2025</INVOICE_DATE>
    <INV_CURRENCY>EUR</INV_CURRENCY>
    <BRAND><DESC>Test Brand</DESC></BRAND>
    <DELIVERY_MODE>
      <SUPPLY>
        <TYPE>PEPPOL_PA</TYPE>
        <ENTRY>0088:123456789</ENTRY>
      </SUPPLY>
    </DELIVERY_MODE>
  </HEADER>
  <RECIPIENT>
    <PERSON_NO>RECIP-001</PERSON_NO>
    <ADDRESS>
      <NAME>Mustermann</NAME>
      <STREET>Str. 1</STREET>
      <CITY>Berlin</CITY>
      <POSTCODE>10001</POSTCODE>
      <COUNTRY>DE</COUNTRY>
    </ADDRESS>
  </RECIPIENT>
  <INVOICE_DATA>
    <PAYMENT_MODE>
      <PAYMENT_TYPE>TRANSFER</PAYMENT_TYPE>
      <DUE_DATE>01.02.2025</DUE_DATE>
      <BANK_ACCOUNT>DE89370400440532013000</BANK_ACCOUNT>
      <BANK_CODE>COBADEFFXXX</BANK_CODE>
    </PAYMENT_MODE>
    <FRAMES>
      <AMOUNTS>
        <NET_AMOUNT>100</NET_AMOUNT>
        <INSEP_GROSS>0</INSEP_GROSS>
        <VAT_AMOUNT>19</VAT_AMOUNT>
        <GROSS_AMOUNT>119</GROSS_AMOUNT>
        <UNPAID>0</UNPAID>
        <TO_PAY>119</TO_PAY>
      </AMOUNTS>
      <DIFF_VATS>
        <DIFF_VAT><VAT_RATE>19</VAT_RATE><NET>100</NET><VAT>19</VAT></DIFF_VAT>
      </DIFF_VATS>
      <FRAME><ID>MAIN</ID></FRAME>
    </FRAMES>
  </INVOICE_DATA>
</DOCUMENT>`
        const raw = parseMcbsXml(xml, 'test', baseMetadata)
        const result = mapMcbsToCommonInvoice(raw)
        expect(result.buyerReference).toBe('0088:123456789')
    })

    it('uses VAT_ID as buyerReference when present', () => {
        const raw = parseMcbsXml(buildXml({customerVatId: 'DE123456789'}), 'test', baseMetadata)
        const result = mapMcbsToCommonInvoice(raw)
        expect(result.buyerReference).toBe('DE123456789')
    })

    it('uses CUSTOMER PERSON_NO as buyerReference when no VAT_ID', () => {
        const raw = parseMcbsXml(buildXml({customerId: 'CUST-001'}), 'test', baseMetadata)
        const result = mapMcbsToCommonInvoice(raw)
        expect(result.buyerReference).toBe('CUST-001')
    })

    it('falls back to RECIPIENT PERSON_NO as buyerReference', () => {
        const raw = parseMcbsXml(buildXml({recipientPersonNo: 'RECIP-999'}), 'test', baseMetadata)
        const result = mapMcbsToCommonInvoice(raw)
        expect(result.buyerReference).toBe('RECIP-999')
    })

    // ── seller name fallback to CODE_DESC ──

    it('uses CODE_DESC as seller name when DESC is absent', () => {
        const raw = parseMcbsXml(
            buildXml({brandXml: '<BRAND><CODE_DESC>Freenet Mobile</CODE_DESC></BRAND>'}),
            'test',
            baseMetadata
        )
        const result = mapMcbsToCommonInvoice(raw)
        expect(result.seller.name).toBe('freenet DLS GmbH')
    })

    // ── pdfKey in metadata ──

    it('uses pdfKey as pdf.s3Key when provided', () => {
        const raw = parseMcbsXml(buildXml({}), 'test', {
            ...baseMetadata,
            pdfKey: 'invoices/invoice.pdf'
        })
        const result = mapMcbsToCommonInvoice(raw)
        expect(result.pdf?.s3Key).toBe('invoices/invoice.pdf')
    })

    // ── VOUCHERS frame filtered out ──

    it('filters out VOUCHERS frame from line items', () => {
        const vouchersFrame = `
            <FRAME>
                <ID>VOUCHERS</ID>
                <AREA>
                    <UNIT>
                        <SECTIONS>
                            <SECTION>
                                <BILLITEM_GRPS>
                                    <BILLITEM_GRP>
                                        <BILLITEMS>
                                            <BILLITEM>
                                                <SEQUENCE_NO>99</SEQUENCE_NO>
                                                <PRODUCT_NAME>Voucher</PRODUCT_NAME>
                                                <CHARGE>10,00</CHARGE>
                                                <VAT_RATE>19</VAT_RATE>
                                            </BILLITEM>
                                        </BILLITEMS>
                                    </BILLITEM_GRP>
                                </BILLITEM_GRPS>
                            </SECTION>
                        </SECTIONS>
                    </UNIT>
                </AREA>
            </FRAME>`
        const raw = parseMcbsXml(buildXml({extraFrameXml: vouchersFrame}), 'test', baseMetadata)
        const result = mapMcbsToCommonInvoice(raw)
        const ids = result.lineItems.map((i) => i.id)
        expect(ids).not.toContain(99)
    })

    // ── CONTRACT_DATA: TELCO with all context fields ──

    it('maps telco contract data to subscriberInfo and contractReference', () => {
        const contractDataXml = `
            <CONTRACT_DATA>
                <TYPE>TELCO</TYPE>
                <CONTRACT_NO>C-12345</CONTRACT_NO>
                <TARIFF>FLAT_L</TARIFF>
                <NETWORK>O2</NETWORK>
                <TCS_VALUE>Max Mustermann</TCS_VALUE>
                <CONNECTS>
                    <CONNECT>
                        <TYPE>MAIN</TYPE>
                        <CONNECT_NO>015112345678</CONNECT_NO>
                    </CONNECT>
                </CONNECTS>
            </CONTRACT_DATA>`
        const raw = parseMcbsXml(buildXml({unitContractDataXml: contractDataXml}), 'test', baseMetadata)
        const result = mapMcbsToCommonInvoice(raw)
        const item = result.lineItems[0]
        expect(item?.contractReference).toBe('C-12345')
        expect(item?.subscriberInfo?.phoneNumber).toBe('015112345678')
        expect(item?.subscriberInfo?.name).toBe('Max Mustermann')
        expect(item?.subscriberInfo?.network).toBe('O2')
        expect(item?.subscriberInfo?.tariff).toBe('FLAT_L')
    })

    it('maps non-TELCO contract with only contractReference (no tariff)', () => {
        const contractDataXml = `
            <CONTRACT_DATA>
                <TYPE>INTERNET</TYPE>
                <CONTRACT_NO>C-99999</CONTRACT_NO>
            </CONTRACT_DATA>`
        const raw = parseMcbsXml(buildXml({unitContractDataXml: contractDataXml}), 'test', baseMetadata)
        const result = mapMcbsToCommonInvoice(raw)
        expect(result.lineItems[0]?.contractReference).toBe('C-99999')
        expect(result.lineItems[0]?.subscriberInfo).toBeUndefined()
    })

    // ── parsePeriod: only one valid date part ──

    it('returns only start when end date has invalid format', () => {
        const raw = parseMcbsXml(buildXml({periodString: '01.09.2025 - 2026-02-28'}), 'test', baseMetadata)
        const result = mapMcbsToCommonInvoice(raw)
        expect(result.lineItems[0]?.period?.start).toBe('2025-09-01')
        expect(result.lineItems[0]?.period?.end).toBeUndefined()
    })

    it('returns only end when start date has invalid format', () => {
        const raw = parseMcbsXml(buildXml({periodString: '2025-09-01 - 28.02.2026'}), 'test', baseMetadata)
        const result = mapMcbsToCommonInvoice(raw)
        expect(result.lineItems[0]?.period?.start).toBeUndefined()
        expect(result.lineItems[0]?.period?.end).toBe('2026-02-28')
    })

    // ── PEPPOL_PA without ENTRY falls through ──

    it('falls through PEPPOL_PA to PERSON_NO when ENTRY is absent', () => {
        const xml = `<?xml version="1.0"?>
<DOCUMENT>
  <TYPE>RE</TYPE>
  <HEADER>
    <INVOICE_NO>INV-001</INVOICE_NO>
    <INVOICE_DATE>01.01.2025</INVOICE_DATE>
    <INV_CURRENCY>EUR</INV_CURRENCY>
    <BRAND><DESC>Test Brand</DESC></BRAND>
    <DELIVERY_MODE>
      <SUPPLY>
        <TYPE>PEPPOL_PA</TYPE>
      </SUPPLY>
    </DELIVERY_MODE>
  </HEADER>
  <RECIPIENT>
    <PERSON_NO>RECIP-FALLBACK</PERSON_NO>
    <ADDRESS>
      <NAME>Mustermann</NAME>
      <STREET>Str. 1</STREET>
      <CITY>Berlin</CITY>
      <POSTCODE>10001</POSTCODE>
      <COUNTRY>DE</COUNTRY>
    </ADDRESS>
  </RECIPIENT>
  <INVOICE_DATA>
    <PAYMENT_MODE>
      <PAYMENT_TYPE>TRANSFER</PAYMENT_TYPE>
      <DUE_DATE>01.02.2025</DUE_DATE>
      <BANK_ACCOUNT>DE89370400440532013000</BANK_ACCOUNT>
      <BANK_CODE>COBADEFFXXX</BANK_CODE>
    </PAYMENT_MODE>
    <FRAMES>
      <AMOUNTS>
        <AMOUNT><TYPE>TOTAL_NET</TYPE><VALUE>100</VALUE></AMOUNT>
        <AMOUNT><TYPE>TOTAL_VAT</TYPE><VALUE>19</VALUE></AMOUNT>
        <AMOUNT><TYPE>TOTAL</TYPE><VALUE>119</VALUE></AMOUNT>
      </AMOUNTS>
      <DIFF_VATS>
        <DIFF_VAT><VAT_RATE>19</VAT_RATE><NET>100</NET><VAT>19</VAT></DIFF_VAT>
      </DIFF_VATS>
      <FRAME><ID>MAIN</ID></FRAME>
    </FRAMES>
  </INVOICE_DATA>
</DOCUMENT>`
        const raw = parseMcbsXml(xml, 'test', baseMetadata)
        const result = mapMcbsToCommonInvoice(raw)
        expect(result.buyerReference).toBe('RECIP-FALLBACK')
    })

    // ── contentProvider with only one field ──

    it('maps contentProvider with only services (no contact)', () => {
        const billitemExtra = `
            <OPT_PARAMS>
                <CONT_PROVIDER>
                    <SERVICES>Basic Service</SERVICES>
                </CONT_PROVIDER>
            </OPT_PARAMS>`
        const raw = parseMcbsXml(buildXml({billitemExtra}), 'test', baseMetadata)
        const result = mapMcbsToCommonInvoice(raw)
        expect(result.lineItems[0]?.contentProvider?.services).toBe('Basic Service')
        expect(result.lineItems[0]?.contentProvider?.contact).toBeUndefined()
    })
})
