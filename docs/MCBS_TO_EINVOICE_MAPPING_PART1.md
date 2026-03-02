# MCBS XML → @e-invoice-eu/core Mapping Guide (Teil 1)

## 🎯 Ziel

MCBS XML Rechnung (mcbs_billoutput.xsd) → @e-invoice-eu/core API → ZUGFeRD/XRechnung

---

## 📦 Installation

```bash
npm install @e-invoice-eu/core fast-xml-parser
```

---

## 📋 MCBS XML Struktur

```xml
<DOCUMENT>
  <HEADER>
    <BRAND>...</BRAND>
    <BILLING_ENTITY>...</BILLING_ENTITY>
  </HEADER>
  <INVOICE_DATA>
    <BILLNO>...</BILLNO>
    <INVOICE_DATE>...</INVOICE_DATE>
    <ADDRESS>...</ADDRESS>
    <AMOUNTS>...</AMOUNTS>
    <PAYMENT_MODE>...</PAYMENT_MODE>
    <SECTIONS>...</SECTIONS>
  </INVOICE_DATA>
</DOCUMENT>
```

---

## 💻 Schritt 1: TypeScript Types

```typescript
// src/types/mcbs-invoice.ts

export interface MCBSDocument {
  DOCUMENT: {
    HEADER: MCBSHeader;
    INVOICE_DATA: MCBSInvoiceData;
  };
}

export interface MCBSHeader {
  BRAND: {
    DESC: string;
  };
  BILLING_ENTITY: {
    NAME: string;
    ZIPCODE: string;
    CITY: string;
  };
  CLIENTBANK_ACNT?: string;
  CLIENTBANK_CODE?: string;
}

export interface MCBSInvoiceData {
  BILLNO: string;
  INVOICE_DATE: string;
  
  ADDRESS: {
    COMPANY?: string;
    FIRST_NAME?: string;
    LAST_NAME?: string;
    STREET: string;
    STREET_NO: string;
    ZIPCODE: string;
    CITY: string;
  };
  
  AMOUNTS: {
    NET_AMOUNT: string;
    VAT_AMOUNT: string;
    GROSS_AMOUNT: string;
    TOTAL_AMOUNT: string;
  };
  
  PAYMENT_MODE: {
    PAYMENT_TYPE: string;
    IBAN?: string;
    BIC?: string;
    MANDATE_REF?: string;
  };
  
  SECTIONS?: {
    SECTION: Array<{
      LINES?: {
        LINE: Array<{
          DESCRIPTION: string;
          QUANTITY?: string;
          NET_AMOUNT: string;
          VAT_RATE?: string;
        }>;
      };
    }>;
  };
}
```

---

## 💻 Schritt 2: MCBS Parser

```typescript
// src/services/mcbs-parser.service.ts
import { XMLParser } from 'fast-xml-parser';
import { MCBSDocument } from '../types/mcbs-invoice';

export class MCBSParserService {
  private parser: XMLParser;
  
  constructor() {
    this.parser = new XMLParser({
      ignoreAttributes: false,
      parseTagValue: true,
      trimValues: true
    });
  }
  
  parse(xmlString: string): MCBSDocument {
    const parsed = this.parser.parse(xmlString);
    
    // Normalisiere Arrays
    this.normalizeArrays(parsed);
    
    return parsed as MCBSDocument;
  }
  
  private normalizeArrays(parsed: any): void {
    // XMLParser macht einzelne Elemente zu Objects statt Arrays
    if (parsed.DOCUMENT?.INVOICE_DATA?.SECTIONS?.SECTION) {
      if (!Array.isArray(parsed.DOCUMENT.INVOICE_DATA.SECTIONS.SECTION)) {
        parsed.DOCUMENT.INVOICE_DATA.SECTIONS.SECTION = 
          [parsed.DOCUMENT.INVOICE_DATA.SECTIONS.SECTION];
      }
    }
  }
}
```

Fortsetzung in Teil 2...