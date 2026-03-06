# MCBS → @e-invoice-eu/core Mapping (Teil 2: Mapper)

## 💻 Schritt 3: Der Mapper

```typescript
// src/services/mcbs-to-einvoice-mapper.service.ts
import {MCBSDocument} from '../types/mcbs-invoice'

/**
 * @e-invoice-eu/core erwartet dieses Format
 */
export interface EInvoiceData {
  number: string
  typeCode: string
  issueDate: string
  currency: string

  seller: {
    name: string
    postalAddress: {
      streetName?: string
      buildingNumber?: string
      postalCode: string
      cityName: string
      countryCode: string
    }
    taxRegistration: Array<{
      id: {value: string; schemeId: string}
    }>
  }

  buyer: {
    name: string
    postalAddress: {
      streetName?: string
      buildingNumber?: string
      postalCode: string
      cityName: string
      countryCode: string
    }
  }

  lineItems: Array<{
    id: number
    name: string
    quantity: number
    unitCode: string
    unitPrice: number
    netAmount: number
    tax: {
      typeCode: string
      categoryCode: string
      rate: number
    }
  }>

  paymentMeans: Array<{
    typeCode: string
    information?: string
    payeeAccount?: {
      iban?: string
    }
  }>

  taxes: Array<{
    typeCode: string
    categoryCode: string
    rate: number
    basisAmount: number
    calculatedAmount: number
  }>

  totals: {
    lineTotal: number
    taxBasisTotal: number
    taxTotal: number
    grandTotal: number
    duePayable: number
  }
}

export class MCBSToEInvoiceMapper {
  map(mcbs: MCBSDocument): EInvoiceData {
    const invoice = mcbs.DOCUMENT.INVOICE_DATA
    const header = mcbs.DOCUMENT.HEADER

    return {
      // Header
      number: invoice.BILLNO,
      typeCode: '380', // Commercial Invoice
      issueDate: this.formatDate(invoice.INVOICE_DATE),
      currency: 'EUR',

      // Seller (freenet)
      seller: {
        name: header.BRAND?.DESC || 'freenet DLS GmbH',
        postalAddress: {
          streetName: 'Hollerstraße',
          buildingNumber: '126',
          postalCode: '24937',
          cityName: 'Flensburg',
          countryCode: 'DE'
        },
        taxRegistration: [
          {
            id: {
              value: 'DE134084432',
              schemeId: 'VA' // VAT
            }
          }
        ]
      },

      // Buyer (Kunde)
      buyer: {
        name: this.formatBuyerName(invoice.ADDRESS),
        postalAddress: {
          streetName: invoice.ADDRESS.STREET,
          buildingNumber: invoice.ADDRESS.STREET_NO,
          postalCode: invoice.ADDRESS.ZIPCODE,
          cityName: invoice.ADDRESS.CITY,
          countryCode: 'DE'
        }
      },

      // Line Items
      lineItems: this.mapLineItems(invoice),

      // Payment
      paymentMeans: [
        {
          typeCode: this.getPaymentTypeCode(invoice.PAYMENT_MODE.PAYMENT_TYPE),
          information: this.getPaymentInfo(invoice.PAYMENT_MODE),
          payeeAccount: invoice.PAYMENT_MODE.IBAN
            ? {
                iban: invoice.PAYMENT_MODE.IBAN
              }
            : undefined
        }
      ],

      // Taxes
      taxes: [
        {
          typeCode: 'VAT',
          categoryCode: 'S',
          rate: 19,
          basisAmount: parseFloat(invoice.AMOUNTS.NET_AMOUNT),
          calculatedAmount: parseFloat(invoice.AMOUNTS.VAT_AMOUNT)
        }
      ],

      // Totals
      totals: {
        lineTotal: parseFloat(invoice.AMOUNTS.NET_AMOUNT),
        taxBasisTotal: parseFloat(invoice.AMOUNTS.NET_AMOUNT),
        taxTotal: parseFloat(invoice.AMOUNTS.VAT_AMOUNT),
        grandTotal: parseFloat(invoice.AMOUNTS.GROSS_AMOUNT),
        duePayable: parseFloat(invoice.AMOUNTS.TOTAL_AMOUNT)
      }
    }
  }

  // Helper Methods

  private formatDate(dateStr: string): string {
    // DD.MM.YYYY → YYYY-MM-DD
    const [day, month, year] = dateStr.split('.')
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }

  private formatBuyerName(address: any): string {
    if (address.COMPANY) return address.COMPANY
    return [address.FIRST_NAME, address.LAST_NAME].filter(Boolean).join(' ')
  }

  private mapLineItems(invoice: any): EInvoiceData['lineItems'] {
    const items: EInvoiceData['lineItems'] = []

    if (invoice.SECTIONS?.SECTION) {
      let itemId = 1
      for (const section of invoice.SECTIONS.SECTION) {
        if (section.LINES?.LINE) {
          const lines = Array.isArray(section.LINES.LINE) ? section.LINES.LINE : [section.LINES.LINE]

          for (const line of lines) {
            items.push({
              id: itemId++,
              name: this.cleanText(line.DESCRIPTION),
              quantity: parseFloat(line.QUANTITY || '1'),
              unitCode: 'C62', // Stück
              unitPrice: parseFloat(line.NET_AMOUNT) / parseFloat(line.QUANTITY || '1'),
              netAmount: parseFloat(line.NET_AMOUNT),
              tax: {
                typeCode: 'VAT',
                categoryCode: 'S',
                rate: parseFloat(line.VAT_RATE || '19')
              }
            })
          }
        }
      }
    }

    // Fallback
    if (items.length === 0) {
      items.push({
        id: 1,
        name: 'Telekommunikationsdienstleistungen',
        quantity: 1,
        unitCode: 'C62',
        unitPrice: parseFloat(invoice.AMOUNTS.NET_AMOUNT),
        netAmount: parseFloat(invoice.AMOUNTS.NET_AMOUNT),
        tax: {typeCode: 'VAT', categoryCode: 'S', rate: 19}
      })
    }

    return items
  }

  private getPaymentTypeCode(type: string): string {
    return type === 'SEPADEBIT' ? '59' : '58'
  }

  private getPaymentInfo(payment: any): string {
    if (payment.PAYMENT_TYPE === 'SEPADEBIT' && payment.MANDATE_REF) {
      return `SEPA-Lastschrift - Mandatsreferenz: ${payment.MANDATE_REF}`
    }
    return 'Überweisung'
  }

  private cleanText(text: string): string {
    return text?.replace(/<[^>]*>/g, '').trim() || ''
  }
}
```

Fortsetzung in Teil 3...
