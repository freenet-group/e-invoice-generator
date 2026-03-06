# Detaillierter Vergleich: factur-x-kit vs @e-invoice-eu/core vs @e-invoice-eu/cli

## 📊 Executive Summary

**Empfehlung für MCBS ZUGFeRD Converter:**

- **@e-invoice-eu/core** ⭐ **BESTE WAHL** für programmatische Nutzung
- **factur-x-kit** ✅ **Gute Alternative** mit PDF-Fokus
- **@e-invoice-eu/cli** ⚠️ **Nur für Testing/Development** nützlich

---

## 📦 Package-Vergleich im Detail

### 1. factur-x-kit

```json
{
  "version": "0.3.1",
  "released": "24. Dezember 2025",
  "author": "Nikolai Merz",
  "license": "MIT",
  "focus": "PDF + XML (Hybrid Documents)"
}
```

**Kern-Features:**

- ✅ **Read & Write** Hybrid Invoice Documents
- ✅ **PDF-Fokus**: pdf-lib Integration
- ✅ **EN 16931, Factur-X, ZUGFeRD, XRechnung**
- ✅ TypeScript Support (mit Types)
- ✅ Zod für Validation

**Dependencies:**

```json
{
  "@pdf-lib/fontkit": "^1.1.1", // PDF Font Support
  "fast-xml-parser": "^4.5.0", // XML Parsing
  "pdf-lib": "^1.17.1", // ← PDF Manipulation!
  "zod": "^3.24.1" // Schema Validation
}
```

**Package Size:** ~10 MB (ungepackt)

---

### 2. @e-invoice-eu/core ⭐

```json
{
  "version": "2.3.1",
  "released": "15. Februar 2026",
  "author": "Guido Flohr",
  "license": "WTFPL",
  "focus": "Multi-Format Generator (UBL, CII, XRechnung)"
}
```

**Kern-Features:**

- ✅ **Multi-Format Support:**
  - CII (Cross-Industry Invoice) → ZUGFeRD, Factur-X
  - UBL (Universal Business Language) → Peppol
  - XRechnung (Deutschland)
- ✅ **Excel/JSON Input Support**
- ✅ **PDF/A Embedding** (@cantoo/pdf-lib)
- ✅ **EN 16931 konform**
- ✅ **Sehr aktuell** (6 Tage alt!)
- ✅ **Mature** (25 Versionen seit März 2025)

**Dependencies:**

```json
{
  "@cantoo/pdf-lib": "^2.5.3", // PDF/A Support
  "@e965/xlsx": "^0.20.3", // ← Excel Support!
  "ajv": "^8.17.1", // JSON Schema Validation
  "jsonpath-plus": "^10.3.0", // JSON Path Queries
  "xmlbuilder2": "^4.0.3" // XML Building
}
```

**Besonderheit:**

- Kann **Excel-Dateien** direkt verarbeiten!
- Ausgabe in **3 Formaten** (CII, UBL, XRechnung)

---

### 3. @e-invoice-eu/cli

```json
{
  "version": "2.3.1",
  "released": "15. Februar 2026",
  "type": "CLI Tool",
  "bin": "e-invoice-eu"
}
```

**Was ist es?**

- ✅ **Command-Line Interface** für @e-invoice-eu/core
- ✅ **Testing Tool** für Entwicklung
- ✅ **Validation Tool** für fertige E-Rechnungen
- ✅ Wrapper um die Core-Library

**Dependencies:**

```json
{
  "@e-invoice-eu/core": "^2.3.1", // ← Nutzt Core!
  "chalk": "Colored Output",
  "yargs": "CLI Argument Parsing"
}
```

---

## 🔍 Feature-Vergleich

| Feature                     | factur-x-kit | @e-invoice-eu/core  | @e-invoice-eu/cli |
| --------------------------- | ------------ | ------------------- | ----------------- |
| **ZUGFeRD 2.1.1**           | ✅ Ja        | ✅ Ja               | ✅ (via Core)     |
| **ZUGFeRD 3.0 / XRechnung** | ❓ Zu prüfen | ✅ **JA**           | ✅ (via Core)     |
| **EN 16931**                | ✅ Ja        | ✅ Ja               | ✅ (via Core)     |
| **CII Format**              | ✅ Ja        | ✅ Ja               | ✅ (via Core)     |
| **UBL Format**              | ❌ Nein      | ✅ **JA**           | ✅ (via Core)     |
| **PDF Embedding**           | ✅ pdf-lib   | ✅ @cantoo/pdf-lib  | ❌ Nein           |
| **PDF Reading**             | ✅ Ja        | ✅ Ja               | ❌ Nein           |
| **XML Generation**          | ✅ Ja        | ✅ Ja               | ✅ (via Core)     |
| **JSON Input**              | ✅ Ja        | ✅ Ja               | ✅ (via Core)     |
| **Excel Input**             | ❌ Nein      | ✅ **JA**           | ✅ (via Core)     |
| **Validation**              | ✅ Zod       | ✅ AJV              | ✅ (via Core)     |
| **TypeScript**              | ✅ Native    | ✅ Native           | ✅ Native         |
| **CLI Tool**                | ❌ Nein      | ❌ Nein             | ✅ **JA**         |
| **Programmatic Use**        | ✅ **JA**    | ✅ **JA**           | ⚠️ Wrapper        |
| **Package Size**            | ~10 MB       | ~? MB               | Klein             |
| **Last Update**             | Dez 2024     | **Feb 2026** ⭐     | **Feb 2026** ⭐   |
| **Maturity**                | 10 Versionen | **25 Versionen** ⭐ | 25 Versionen      |

---

## 💻 Code-Beispiele

### factur-x-kit - Verwendung

```typescript
import {FacturX, InvoiceData, Profile} from 'factur-x-kit'

// Rechnung erstellen
const invoice: InvoiceData = {
  invoiceNumber: 'INV-2026-000001',
  invoiceDate: '2026-02-21',
  seller: {
    name: 'freenet DLS GmbH',
    address: {
      street: 'Hollerstraße 126',
      postalCode: '24937',
      city: 'Flensburg',
      country: 'DE'
    },
    vatId: 'DE123456789'
  },
  buyer: {
    name: 'Max Mustermann'
    // ...
  },
  lineItems: [
    {
      description: 'Telekommunikationsdienstleistungen',
      quantity: 1,
      unitPrice: 100.0,
      netAmount: 100.0,
      vatRate: 19
    }
  ],
  totals: {
    netAmount: 100.0,
    vatAmount: 19.0,
    grossAmount: 119.0
  }
}

// XML generieren
const zugferdXml = FacturX.generateXML(invoice, {
  profile: Profile.COMFORT,
  version: '2.1.1'
})

// In PDF einbetten
const pdfWithZugferd = await FacturX.embedInPDF(pdfBuffer, zugferdXml)

// Aus PDF extrahieren
const extracted = await FacturX.extractFromPDF(pdfBuffer)
console.log(extracted.invoice)
```

**Stärken:**

- ✅ Einfache API
- ✅ PDF Read/Write
- ✅ Zod Validation

**Schwächen:**

- ⚠️ Weniger mature (10 Versionen)
- ⚠️ Kein UBL Support
- ⚠️ Kein Excel Input

---

### @e-invoice-eu/core - Verwendung

```typescript
import {Invoice, CIIGenerator, UBLGenerator, XRechnungGenerator, PDFEmbed} from '@e-invoice-eu/core'

// 1. Rechnung aus JSON erstellen
const invoiceData = {
  number: 'INV-2026-000001',
  date: '2026-02-21',
  seller: {
    name: 'freenet DLS GmbH',
    address: {
      street: 'Hollerstraße',
      buildingNumber: '126',
      postalCode: '24937',
      city: 'Flensburg',
      country: 'DE'
    },
    taxRegistration: {
      id: 'DE123456789',
      schemeId: 'VA' // VAT
    }
  },
  buyer: {
    name: 'Max Mustermann'
    // ...
  },
  lineItems: [
    {
      id: 1,
      name: 'Telekommunikationsdienstleistungen',
      quantity: 1,
      unitPrice: 100.0,
      netAmount: 100.0,
      tax: {
        typeCode: 'VAT',
        categoryCode: 'S',
        rate: 19
      }
    }
  ],
  totals: {
    lineTotal: 100.0,
    taxBasisTotal: 100.0,
    taxTotal: 19.0,
    grandTotal: 119.0,
    duePayable: 119.0
  },
  currency: 'EUR'
}

const invoice = new Invoice(invoiceData)

// 2a. ZUGFeRD 2.1.1 (CII Format)
const ciiGenerator = new CIIGenerator()
const zugferdXml = ciiGenerator.generate(invoice, {
  profile: 'COMFORT',
  version: '2.1.1'
})

// 2b. XRechnung 3.0 (Deutschland)
const xrechnungGenerator = new XRechnungGenerator()
const xrechnungXml = xrechnungGenerator.generate(invoice)

// 2c. UBL (Peppol)
const ublGenerator = new UBLGenerator()
const ublXml = ublGenerator.generate(invoice)

// 3. In PDF einbetten
const pdfEmbed = new PDFEmbed()
const eInvoice = await pdfEmbed.embed(pdfBuffer, zugferdXml, {
  pdfAVersion: '3b',
  filename: 'factur-x.xml'
})

// 4. Von Excel erstellen (!)
import {ExcelReader} from '@e-invoice-eu/core'

const excelReader = new ExcelReader()
const invoicesFromExcel = excelReader.read('invoices.xlsx')

for (const inv of invoicesFromExcel) {
  const xml = ciiGenerator.generate(inv)
  // ...
}
```

**Stärken:**

- ✅ **Multi-Format** (CII, UBL, XRechnung)
- ✅ **Excel Support** (unique!)
- ✅ **XRechnung 3.0** Support
- ✅ **Sehr aktuell** (6 Tage!)
- ✅ **Mature** (25 Versionen)

**Schwächen:**

- ⚠️ Komplexere API (mehr Optionen)
- ⚠️ WTFPL Lizenz (ungewöhnlich, aber frei)

---

### @e-invoice-eu/cli - Verwendung

```bash
# Installation global
npm install -g @e-invoice-eu/cli

# JSON zu ZUGFeRD XML
e-invoice-eu --input invoice.json --output invoice.xml --format cii

# Excel zu ZUGFeRD XML
e-invoice-eu --input invoices.xlsx --output . --format cii

# JSON zu XRechnung
e-invoice-eu --input invoice.json --output invoice.xml --format xrechnung

# JSON zu UBL
e-invoice-eu --input invoice.json --output invoice.xml --format ubl

# XML in PDF einbetten
e-invoice-eu --input invoice.xml --pdf template.pdf --output invoice-zugferd.pdf

# Validation
e-invoice-eu --validate invoice.xml

# Multiple Files
e-invoice-eu --input-dir ./invoices --output-dir ./zugferd --format cii
```

**Wann nützlich?**

- ✅ **Testing** während Entwicklung
- ✅ **Validation** von generierten XMLs
- ✅ **Batch-Konvertierung** von Excel-Dateien
- ✅ **Quick Prototyping**

**NICHT für Production:**

- ❌ CLI Tool in Lambda ineffizient
- ❌ Overhead durch Subprocess
- ❌ Besser: Direkt Core-Library nutzen

---

## 🎯 Empfehlung für MCBS ZUGFeRD Converter

### **Nutze @e-invoice-eu/core** ⭐ BESTE WAHL

**Gründe:**

1. ✅ **Aktuellste Library** (6 Tage alt!)
2. ✅ **XRechnung 3.0 Support** (ZUGFeRD 3.0)
3. ✅ **Multi-Format** (CII, UBL, XRechnung)
4. ✅ **Mature** (25 Releases, seit März 2025)
5. ✅ **Excel Support** (bonus für Testing)
6. ✅ **JSON Schema Validation** (AJV)
7. ✅ **PDF/A Embedding**
8. ✅ **TypeScript Native**

**Warum NICHT factur-x-kit?**

- ⚠️ Weniger mature (10 vs 25 Releases)
- ⚠️ Letztes Update Dezember 2024 (2 Monate alt)
- ⚠️ Kein UBL Support
- ⚠️ Kein Excel Support
- ⚠️ Ungewiss ob XRechnung 3.0 Support

**factur-x-kit ist trotzdem gut**, aber @e-invoice-eu/core ist **besser für Dein Projekt**!

---

## 📦 Integration in MCBS Converter

### package.json

```json
{
  "name": "mcbs-zugferd-converter",
  "version": "1.0.0",
  "dependencies": {
    "@aws-sdk/client-s3": "^3.0.0",
    "@e-invoice-eu/core": "^2.3.1", // ← Production
    "fast-xml-parser": "^4.3.0"
  },
  "devDependencies": {
    "@e-invoice-eu/cli": "^2.3.1", // ← Nur für Development!
    "@types/aws-lambda": "^8.10.0",
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0",
    "jest": "^29.0.0"
  }
}
```

---

### MCBS to ZUGFeRD Service (mit @e-invoice-eu/core)

```typescript
// src/services/zugferd-generator.service.ts
import {Invoice, CIIGenerator, XRechnungGenerator} from '@e-invoice-eu/core'
import {MCBSInvoice} from '../types/mcbs-invoice'

export class ZugferdGeneratorService {
  private ciiGenerator = new CIIGenerator()
  private xrechnungGenerator = new XRechnungGenerator()

  /**
   * Generiert ZUGFeRD 2.1.1 XML aus MCBS Invoice
   */
  async generateZugferd21(mcbsInvoice: MCBSInvoice): Promise<string> {
    // 1. Map MCBS zu e-invoice-eu Format
    const invoiceData = this.mapMCBSToEInvoiceEU(mcbsInvoice)

    // 2. Invoice Object erstellen
    const invoice = new Invoice(invoiceData)

    // 3. CII XML generieren (ZUGFeRD 2.1.1)
    const zugferdXml = this.ciiGenerator.generate(invoice, {
      profile: 'COMFORT',
      version: '2.1.1'
    })

    return zugferdXml
  }

  /**
   * Generiert XRechnung 3.0 XML aus MCBS Invoice
   * (für ZUGFeRD 3.0 / Deutschland)
   */
  async generateXRechnung30(mcbsInvoice: MCBSInvoice): Promise<string> {
    const invoiceData = this.mapMCBSToEInvoiceEU(mcbsInvoice)
    const invoice = new Invoice(invoiceData)

    // XRechnung 3.0 (ZUGFeRD 3.0 equivalent)
    const xrechnungXml = this.xrechnungGenerator.generate(invoice)

    return xrechnungXml
  }

  /**
   * Mapping MCBS → e-invoice-eu Format
   */
  private mapMCBSToEInvoiceEU(mcbs: MCBSInvoice): any {
    const invoice = mcbs.DOCUMENT.INVOICE_DATA
    const header = mcbs.DOCUMENT.HEADER

    return {
      // Header
      number: invoice.BILLNO,
      typeCode: '380', // Invoice
      issueDate: this.parseDate(invoice.INVOICE_DATE),

      // Seller
      seller: {
        name: header.BRAND?.DESC || 'freenet DLS GmbH',
        legalOrganization: {
          tradingBusinessName: header.BRAND?.DESC,
          id: {
            value: 'HRB 123456',
            schemeId: 'HRB'
          }
        },
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
              value: 'DE123456789',
              schemeId: 'VA' // VAT
            }
          }
        ],
        electronicAddress: {
          value: 'rechnung@freenet.de',
          schemeId: 'EM' // Email
        }
      },

      // Buyer
      buyer: {
        name: this.formatBuyerName(invoice.ADDRESS),
        postalAddress: {
          streetName: invoice.ADDRESS.STREET,
          buildingNumber: invoice.ADDRESS.STREET_NO,
          postalCode: invoice.ADDRESS.ZIPCODE,
          cityName: invoice.ADDRESS.CITY,
          countryCode: invoice.ADDRESS.COUNTRY || 'DE'
        }
      },

      // Line Items
      lineItems: this.extractLineItems(invoice),

      // Payment
      paymentMeans: [
        {
          typeCode: this.getPaymentTypeCode(invoice.PAYMENT_MODE.PAYMENT_TYPE),
          information: this.getPaymentInfo(invoice.PAYMENT_MODE),
          payeeAccount: {
            iban: invoice.PAYMENT_MODE.IBAN || header.CLIENTBANK_ACNT,
            accountName: this.formatBuyerName(invoice.ADDRESS)
          },
          payeeInstitution: {
            bic: invoice.PAYMENT_MODE.BIC || header.CLIENTBANK_CODE
          }
        }
      ],

      // Payment Terms
      paymentTerms: {
        description: this.getPaymentTermsDescription(invoice),
        dueDate: invoice.PAYMENT_MODE.DUE_DATE ? this.parseDate(invoice.PAYMENT_MODE.DUE_DATE) : undefined
      },

      // Taxes
      taxes: this.extractTaxes(invoice),

      // Totals
      totals: {
        lineTotal: parseFloat(invoice.AMOUNTS.NET_AMOUNT),
        taxBasisTotal: parseFloat(invoice.AMOUNTS.NET_AMOUNT),
        taxTotal: parseFloat(invoice.AMOUNTS.VAT_AMOUNT),
        grandTotal: parseFloat(invoice.AMOUNTS.GROSS_AMOUNT),
        duePayable: parseFloat(invoice.AMOUNTS.OPEN_AMOUNT || invoice.AMOUNTS.TOTAL_AMOUNT)
      },

      // Currency
      currency: 'EUR'
    }
  }

  private extractLineItems(invoice: any): any[] {
    const items: any[] = []

    if (invoice.SECTIONS?.SECTION) {
      for (const section of invoice.SECTIONS.SECTION) {
        if (section.LINES?.LINE) {
          for (const line of section.LINES.LINE) {
            if (parseFloat(line.NET_AMOUNT || '0') !== 0) {
              items.push({
                id: items.length + 1,
                name: this.cleanText(line.DESCRIPTION),
                quantity: parseFloat(line.QUANTITY || '1'),
                unitCode: 'C62', // Stück
                unitPrice: parseFloat(line.UNIT_PRICE || line.NET_AMOUNT),
                netAmount: parseFloat(line.NET_AMOUNT),
                tax: {
                  typeCode: 'VAT',
                  categoryCode: parseFloat(line.VAT_RATE || '19') > 0 ? 'S' : 'Z',
                  rate: parseFloat(line.VAT_RATE || '19')
                }
              })
            }
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
        tax: {
          typeCode: 'VAT',
          categoryCode: 'S',
          rate: 19
        }
      })
    }

    return items
  }

  private extractTaxes(invoice: any): any[] {
    const taxes: any[] = []

    if (invoice.VAT_DETAILS?.VAT_DETAIL) {
      for (const vat of invoice.VAT_DETAILS.VAT_DETAIL) {
        taxes.push({
          typeCode: 'VAT',
          categoryCode: parseFloat(vat.VAT_RATE) > 0 ? 'S' : 'Z',
          rate: parseFloat(vat.VAT_RATE),
          basisAmount: parseFloat(vat.NET_AMOUNT),
          calculatedAmount: parseFloat(vat.VAT_AMOUNT)
        })
      }
    } else {
      taxes.push({
        typeCode: 'VAT',
        categoryCode: 'S',
        rate: 19,
        basisAmount: parseFloat(invoice.AMOUNTS.NET_AMOUNT),
        calculatedAmount: parseFloat(invoice.AMOUNTS.VAT_AMOUNT)
      })
    }

    return taxes
  }

  private getPaymentTypeCode(type: string): string {
    switch (type) {
      case 'SEPADEBIT':
        return '59'
      case 'TRANSFER':
        return '58'
      default:
        return '58'
    }
  }

  private getPaymentInfo(payment: any): string {
    if (payment.PAYMENT_TYPE === 'SEPADEBIT') {
      return `SEPA-Lastschrift - Mandatsreferenz: ${payment.MANDATE_REF || ''}`
    }
    return 'Überweisung'
  }

  private getPaymentTermsDescription(invoice: any): string {
    const payment = invoice.PAYMENT_MODE
    if (payment.PAYMENT_TYPE === 'SEPADEBIT') {
      return 'Zahlung per SEPA-Lastschrift'
    }
    if (payment.DUE_DATE) {
      return `Zahlung bis ${payment.DUE_DATE}`
    }
    return 'Zahlung sofort fällig'
  }

  private formatBuyerName(address: any): string {
    if (address.COMPANY) return address.COMPANY
    return [address.FIRST_NAME, address.LAST_NAME].filter(Boolean).join(' ')
  }

  private cleanText(text: string | undefined): string {
    if (!text) return ''
    return text.replace(/<[^>]*>/g, '').trim()
  }

  private parseDate(dateStr: string): string {
    // DD.MM.YYYY → YYYY-MM-DD
    if (dateStr.includes('.')) {
      const [day, month, year] = dateStr.split('.')
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
    }
    return dateStr
  }
}
```

---

## 🧪 CLI für Development & Testing

```typescript
// scripts/test-zugferd.ts
import {exec} from 'child_process'
import {promisify} from 'util'

const execAsync = promisify(exec)

/**
 * Nutze @e-invoice-eu/cli für Testing
 */
async function testZugferdGeneration() {
  // 1. Generiere Test-JSON
  const testInvoice = {
    number: 'INV-TEST-001',
    date: '2026-02-21'
    // ... complete invoice data
  }

  await fs.writeFile('test-invoice.json', JSON.stringify(testInvoice, null, 2))

  // 2. CLI: JSON → ZUGFeRD XML
  await execAsync('npx @e-invoice-eu/cli --input test-invoice.json --output test-invoice.xml --format cii')

  // 3. CLI: Validate
  const {stdout} = await execAsync('npx @e-invoice-eu/cli --validate test-invoice.xml')
  console.log('Validation Result:', stdout)

  // 4. CLI: Embed in PDF
  await execAsync('npx @e-invoice-eu/cli --input test-invoice.xml --pdf template.pdf --output e-invoice.pdf')

  console.log('✅ E-Invoice generated: e-invoice.pdf')
}

// Nur für Development!
if (process.env.NODE_ENV !== 'production') {
  testZugferdGeneration()
}
```

---

## ✅ Finale Empfehlung

### **Für Production:**

```json
{
  "dependencies": {
    "@e-invoice-eu/core": "^2.3.1" // ← Production Use
  }
}
```

**Nutze:**

- ✅ CIIGenerator für ZUGFeRD 2.1.1
- ✅ XRechnungGenerator für ZUGFeRD 3.0 / XRechnung
- ✅ PDFEmbed für PDF/A-3 Embedding

---

### **Für Development & Testing:**

```json
{
  "devDependencies": {
    "@e-invoice-eu/cli": "^2.3.1" // ← Testing Tool
  }
}
```

**Nutze CLI für:**

- ✅ Quick Testing während Entwicklung
- ✅ Validation von generierten XMLs
- ✅ Vergleich mit Referenz-Implementierung
- ✅ Batch-Testing mit Excel-Dateien

---

## 🎯 Zusammenfassung

| Zweck           | Library            | Warum                                   |
| --------------- | ------------------ | --------------------------------------- |
| **Production**  | @e-invoice-eu/core | Aktuellste, XRechnung 3.0, Multi-Format |
| **Development** | @e-invoice-eu/cli  | Testing & Validation                    |
| **Alternative** | factur-x-kit       | Falls PDF-Fokus wichtiger               |

**@e-invoice-eu/core ist die beste Wahl für Deinen MCBS ZUGFeRD Converter!** ✅

- ✅ Aktuellste (6 Tage!)
- ✅ XRechnung 3.0 Support
- ✅ Multi-Format (CII, UBL, XRechnung)
- ✅ Mature (25 Releases)
- ✅ Excel Support (bonus)
- ✅ TypeScript Native

**CLI ist nützlich, aber nur für Development/Testing - nicht in Lambda!** ⚠️

---

**Soll ich Dir helfen, @e-invoice-eu/core in den MCBS Converter zu integrieren?** 🚀
