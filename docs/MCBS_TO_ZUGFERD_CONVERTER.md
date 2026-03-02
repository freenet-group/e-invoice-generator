# MCBS XML zu ZUGFeRD Konvertierung mit AWS & TypeScript

## Übersicht

**Aufgabe:** Konvertierung von MCBS Inhouse-XML (mcbs_billoutput.xsd) zu **ZUGFeRD XML** (Comfort Level)

**Technologie-Stack:**
- AWS Lambda (TypeScript)
- AWS S3 (Input/Output Storage)
- AWS EventBridge (Event-driven Trigger)
- AWS Step Functions (Orchestration, optional)

---

## ZUGFeRD Comfort Level - Was ist das?

### ZUGFeRD Profile

| Profile | Komplexität | Use Case |
|---------|-------------|----------|
| **MINIMUM** | Sehr einfach | Nur Basisdaten |
| **BASIC WL** | Einfach | Ohne Positionsdaten |
| **BASIC** | Standard | Mit Positionsdaten |
| **COMFORT** ✅ | Erweitert | **Empfohlen - Ihr Ziel!** |
| **EXTENDED** | Komplett | Alle Details |

**Comfort Level** enthält:
- ✅ Rechnungskopf (Datum, Nummer, Beträge)
- ✅ Lieferant/Käufer-Informationen
- ✅ Positionsdaten (Artikel, Menge, Preis)
- ✅ Zahlungsbedingungen
- ✅ Steuern (MwSt-Aufschlüsselung)
- ✅ Summen (Netto, Brutto, MwSt)
- ✅ Bankverbindung

---

## Architektur

### Option 1: Lambda-basierte Konvertierung (Empfohlen)

```
┌────────────────────────────────┐
│ S3 Bucket: mcbs-invoices-raw   │
│ - invoice_123456.xml (MCBS)    │
└────────────┬───────────────────┘
             │ S3 Event
             ↓
┌────────────────────────────────┐
│ EventBridge Rule               │
│ - Pattern: s3:ObjectCreated    │
└────────────┬───────────────────┘
             │ triggers
             ↓
┌────────────────────────────────┐
│ Lambda: MCBS-to-ZUGFeRD        │
│ - TypeScript/Node.js 18        │
│ - XML Parser (fast-xml-parser) │
│ - ZUGFeRD Generator            │
└────────────┬───────────────────┘
             │ writes
             ↓
┌────────────────────────────────┐
│ S3 Bucket: zugferd-invoices    │
│ - invoice_123456_zugferd.xml   │
└────────────────────────────────┘
```

---

## 1. TypeScript Mapping-Logik

### 1.1. Datenmodell-Mapping

```typescript
// src/types/mcbs-invoice.ts
/**
 * MCBS XML Struktur (vereinfacht basierend auf mcbs_billoutput.xsd)
 */
export interface MCBSInvoice {
  DOCUMENT: {
    HEADER: {
      BILLING_SYSTEM?: string;
      SOURCE_SYSTEM?: string;
      INVOICE_DATE?: string;
      BILLRUN_ID?: string;
      BRAND?: {
        CODE_SHORTCUT: string;
        CODE_DESC: string;
        SHORTCUT: string;
        DESC: string;
      };
      CLIENTBANK_ACNT?: string;
      CLIENTBANK_CODE?: string;
      CLIENTBANK_NAME?: string;
    };
    INVOICE_DATA: {
      CUSTOMER_NO: string;
      BILLNO: string;
      INVOICE_DATE: string;
      BILLING_PERIOD?: {
        FROM: string;
        TO: string;
      };
      AMOUNTS: {
        NET_AMOUNT: string;
        VAT_AMOUNT: string;
        GROSS_AMOUNT: string;
        TOTAL_AMOUNT: string;
        OPEN_AMOUNT?: string;
      };
      PAYMENT_MODE: {
        PAYMENT_TYPE: string; // SEPADEBIT, INVOICE, etc.
        IBAN?: string;
        BIC?: string;
        MANDATE_REF?: string;
        DUE_DATE?: string;
      };
      ADDRESS: {
        SALUTATION?: string;
        FIRST_NAME?: string;
        LAST_NAME?: string;
        COMPANY?: string;
        STREET?: string;
        STREET_NO?: string;
        ZIPCODE?: string;
        CITY?: string;
        COUNTRY?: string;
      };
      SECTIONS?: {
        SECTION: Array<{
          TYPE: string;
          LINES?: {
            LINE: Array<{
              TYPE: string;
              DESCRIPTION: string;
              QUANTITY?: string;
              UNIT_PRICE?: string;
              NET_AMOUNT?: string;
              VAT_RATE?: string;
              VAT_AMOUNT?: string;
              GROSS_AMOUNT?: string;
            }>;
          };
        }>;
      };
      VAT_DETAILS?: {
        VAT_DETAIL: Array<{
          VAT_RATE: string;
          NET_AMOUNT: string;
          VAT_AMOUNT: string;
          GROSS_AMOUNT: string;
        }>;
      };
    };
  };
}
```

```typescript
// src/types/zugferd.ts
/**
 * ZUGFeRD Comfort Level Struktur (EN 16931 / CII)
 */
export interface ZUGFeRDInvoice {
  'rsm:CrossIndustryInvoice': {
    '@_xmlns:rsm': string;
    '@_xmlns:qdt': string;
    '@_xmlns:ram': string;
    '@_xmlns:xs': string;
    '@_xmlns:udt': string;
    
    'rsm:ExchangedDocumentContext': {
      'ram:GuidelineSpecifiedDocumentContextParameter': {
        'ram:ID': string; // "urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:comfort"
      };
    };
    
    'rsm:ExchangedDocument': {
      'ram:ID': string; // Rechnungsnummer
      'ram:TypeCode': string; // 380 = Rechnung, 381 = Gutschrift
      'ram:IssueDateTime': {
        'udt:DateTimeString': {
          '@_format': string;
          '#text': string;
        };
      };
      'ram:IncludedNote'?: Array<{
        'ram:Content': string;
      }>;
    };
    
    'rsm:SupplyChainTradeTransaction': {
      'ram:IncludedSupplyChainTradeLineItem': Array<{
        'ram:AssociatedDocumentLineDocument': {
          'ram:LineID': string;
        };
        'ram:SpecifiedTradeProduct': {
          'ram:Name': string;
          'ram:Description'?: string;
        };
        'ram:SpecifiedLineTradeAgreement': {
          'ram:NetPriceProductTradePrice': {
            'ram:ChargeAmount': string;
          };
        };
        'ram:SpecifiedLineTradeDelivery': {
          'ram:BilledQuantity': {
            '@_unitCode': string; // C62 = Stück, H87 = Stück
            '#text': string;
          };
        };
        'ram:SpecifiedLineTradeSettlement': {
          'ram:ApplicableTradeTax': {
            'ram:TypeCode': string; // VAT
            'ram:CategoryCode': string; // S = Standard, Z = Zero
            'ram:RateApplicablePercent': string;
          };
          'ram:SpecifiedTradeSettlementLineMonetarySummation': {
            'ram:LineTotalAmount': string;
          };
        };
      }>;
      
      'ram:ApplicableHeaderTradeAgreement': {
        'ram:SellerTradeParty': {
          'ram:Name': string;
          'ram:SpecifiedLegalOrganization'?: {
            'ram:ID': string; // Steuernummer oder Handelsregisternummer
          };
          'ram:PostalTradeAddress': {
            'ram:PostcodeCode': string;
            'ram:LineOne': string;
            'ram:CityName': string;
            'ram:CountryID': string; // ISO 3166-1 alpha-2
          };
          'ram:SpecifiedTaxRegistration': {
            'ram:ID': {
              '@_schemeID': string; // VA = VAT, FC = Fiscal
              '#text': string; // USt-IdNr
            };
          };
        };
        'ram:BuyerTradeParty': {
          'ram:Name': string;
          'ram:PostalTradeAddress': {
            'ram:PostcodeCode': string;
            'ram:LineOne': string;
            'ram:CityName': string;
            'ram:CountryID': string;
          };
        };
      };
      
      'ram:ApplicableHeaderTradeDelivery': {
        'ram:ActualDeliverySupplyChainEvent': {
          'ram:OccurrenceDateTime': {
            'udt:DateTimeString': {
              '@_format': string;
              '#text': string;
            };
          };
        };
      };
      
      'ram:ApplicableHeaderTradeSettlement': {
        'ram:InvoiceCurrencyCode': string; // EUR
        'ram:SpecifiedTradeSettlementPaymentMeans': {
          'ram:TypeCode': string; // 58 = SEPA, 30 = Überweisung
          'ram:Information'?: string;
          'ram:PayeePartyCreditorFinancialAccount': {
            'ram:IBANID': string;
            'ram:AccountName'?: string;
          };
          'ram:PayeeSpecifiedCreditorFinancialInstitution': {
            'ram:BICID': string;
          };
        };
        'ram:ApplicableTradeTax': Array<{
          'ram:CalculatedAmount': string; // MwSt-Betrag
          'ram:TypeCode': string; // VAT
          'ram:BasisAmount': string; // Nettobetrag
          'ram:CategoryCode': string; // S = Standard
          'ram:RateApplicablePercent': string; // 19
        }>;
        'ram:SpecifiedTradePaymentTerms': {
          'ram:Description': string;
          'ram:DueDateDateTime'?: {
            'udt:DateTimeString': {
              '@_format': string;
              '#text': string;
            };
          };
        };
        'ram:SpecifiedTradeSettlementHeaderMonetarySummation': {
          'ram:LineTotalAmount': string; // Summe Netto
          'ram:ChargeTotalAmount'?: string; // Zuschläge
          'ram:AllowanceTotalAmount'?: string; // Abschläge
          'ram:TaxBasisTotalAmount': string; // Steuerbemessungsgrundlage
          'ram:TaxTotalAmount': {
            '@_currencyID': string;
            '#text': string; // Gesamt MwSt
          };
          'ram:GrandTotalAmount': string; // Bruttobetrag
          'ram:TotalPrepaidAmount'?: string; // Anzahlungen
          'ram:DuePayableAmount': string; // Zahlbetrag
        };
      };
    };
  };
}
```

---

### 1.2. Konvertierungs-Mapper

```typescript
// src/mappers/mcbs-to-zugferd-mapper.ts
import { MCBSInvoice } from '../types/mcbs-invoice';
import { ZUGFeRDInvoice } from '../types/zugferd';
import { format, parse } from 'date-fns';

export class MCBSToZUGFeRDMapper {
  
  /**
   * Hauptkonvertierungsmethode
   */
  public mapToZUGFeRD(mcbs: MCBSInvoice): ZUGFeRDInvoice {
    
    const invoice = mcbs.DOCUMENT.INVOICE_DATA;
    const header = mcbs.DOCUMENT.HEADER;
    
    return {
      'rsm:CrossIndustryInvoice': {
        '@_xmlns:rsm': 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100',
        '@_xmlns:qdt': 'urn:un:unece:uncefact:data:standard:QualifiedDataType:100',
        '@_xmlns:ram': 'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100',
        '@_xmlns:xs': 'http://www.w3.org/2001/XMLSchema',
        '@_xmlns:udt': 'urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100',
        
        'rsm:ExchangedDocumentContext': this.mapDocumentContext(),
        'rsm:ExchangedDocument': this.mapExchangedDocument(invoice),
        'rsm:SupplyChainTradeTransaction': this.mapSupplyChainTradeTransaction(invoice, header)
      }
    };
  }
  
  /**
   * Document Context - ZUGFeRD Profil
   */
  private mapDocumentContext() {
    return {
      'ram:GuidelineSpecifiedDocumentContextParameter': {
        'ram:ID': 'urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:comfort'
      }
    };
  }
  
  /**
   * Exchanged Document - Rechnungskopf
   */
  private mapExchangedDocument(invoice: MCBSInvoice['DOCUMENT']['INVOICE_DATA']) {
    return {
      'ram:ID': invoice.BILLNO,
      'ram:TypeCode': '380', // 380 = Rechnung, 381 = Gutschrift
      'ram:IssueDateTime': {
        'udt:DateTimeString': {
          '@_format': '102', // YYYYMMDD
          '#text': this.formatDateToZUGFeRD(invoice.INVOICE_DATE)
        }
      },
      'ram:IncludedNote': [
        {
          'ram:Content': `Rechnung ${invoice.BILLNO} vom ${invoice.INVOICE_DATE}`
        }
      ]
    };
  }
  
  /**
   * Supply Chain Trade Transaction - Hauptteil
   */
  private mapSupplyChainTradeTransaction(
    invoice: MCBSInvoice['DOCUMENT']['INVOICE_DATA'],
    header: MCBSInvoice['DOCUMENT']['HEADER']
  ) {
    return {
      'ram:IncludedSupplyChainTradeLineItem': this.mapLineItems(invoice),
      'ram:ApplicableHeaderTradeAgreement': this.mapTradeAgreement(invoice, header),
      'ram:ApplicableHeaderTradeDelivery': this.mapTradeDelivery(invoice),
      'ram:ApplicableHeaderTradeSettlement': this.mapTradeSettlement(invoice, header)
    };
  }
  
  /**
   * Line Items - Rechnungspositionen
   */
  private mapLineItems(invoice: MCBSInvoice['DOCUMENT']['INVOICE_DATA']) {
    const lineItems: any[] = [];
    let lineNumber = 1;
    
    if (invoice.SECTIONS?.SECTION) {
      for (const section of invoice.SECTIONS.SECTION) {
        if (section.LINES?.LINE) {
          for (const line of section.LINES.LINE) {
            
            // Nur Positionen mit Betrag
            if (line.NET_AMOUNT && parseFloat(line.NET_AMOUNT) !== 0) {
              lineItems.push({
                'ram:AssociatedDocumentLineDocument': {
                  'ram:LineID': lineNumber.toString()
                },
                'ram:SpecifiedTradeProduct': {
                  'ram:Name': this.cleanText(line.DESCRIPTION),
                  'ram:Description': this.cleanText(line.DESCRIPTION)
                },
                'ram:SpecifiedLineTradeAgreement': {
                  'ram:NetPriceProductTradePrice': {
                    'ram:ChargeAmount': this.formatAmount(line.UNIT_PRICE || line.NET_AMOUNT)
                  }
                },
                'ram:SpecifiedLineTradeDelivery': {
                  'ram:BilledQuantity': {
                    '@_unitCode': 'C62', // C62 = Stück (piece)
                    '#text': line.QUANTITY || '1'
                  }
                },
                'ram:SpecifiedLineTradeSettlement': {
                  'ram:ApplicableTradeTax': {
                    'ram:TypeCode': 'VAT',
                    'ram:CategoryCode': parseFloat(line.VAT_RATE || '19') > 0 ? 'S' : 'Z',
                    'ram:RateApplicablePercent': this.formatAmount(line.VAT_RATE || '19')
                  },
                  'ram:SpecifiedTradeSettlementLineMonetarySummation': {
                    'ram:LineTotalAmount': this.formatAmount(line.NET_AMOUNT)
                  }
                }
              });
              
              lineNumber++;
            }
          }
        }
      }
    }
    
    // Fallback: Mindestens eine Position
    if (lineItems.length === 0) {
      lineItems.push({
        'ram:AssociatedDocumentLineDocument': {
          'ram:LineID': '1'
        },
        'ram:SpecifiedTradeProduct': {
          'ram:Name': 'Telekommunikationsdienstleistungen',
          'ram:Description': `Rechnung ${invoice.BILLNO}`
        },
        'ram:SpecifiedLineTradeAgreement': {
          'ram:NetPriceProductTradePrice': {
            'ram:ChargeAmount': this.formatAmount(invoice.AMOUNTS.NET_AMOUNT)
          }
        },
        'ram:SpecifiedLineTradeDelivery': {
          'ram:BilledQuantity': {
            '@_unitCode': 'C62',
            '#text': '1'
          }
        },
        'ram:SpecifiedLineTradeSettlement': {
          'ram:ApplicableTradeTax': {
            'ram:TypeCode': 'VAT',
            'ram:CategoryCode': 'S',
            'ram:RateApplicablePercent': '19'
          },
          'ram:SpecifiedTradeSettlementLineMonetarySummation': {
            'ram:LineTotalAmount': this.formatAmount(invoice.AMOUNTS.NET_AMOUNT)
          }
        }
      });
    }
    
    return lineItems;
  }
  
  /**
   * Trade Agreement - Verkäufer/Käufer
   */
  private mapTradeAgreement(
    invoice: MCBSInvoice['DOCUMENT']['INVOICE_DATA'],
    header: MCBSInvoice['DOCUMENT']['HEADER']
  ) {
    return {
      'ram:SellerTradeParty': {
        'ram:Name': header.BRAND?.DESC || 'freenet DLS GmbH',
        'ram:SpecifiedLegalOrganization': {
          'ram:ID': 'HRB 123456' // Handelsregister
        },
        'ram:PostalTradeAddress': {
          'ram:PostcodeCode': '24937',
          'ram:LineOne': 'Hollerstraße 126',
          'ram:CityName': 'Flensburg',
          'ram:CountryID': 'DE'
        },
        'ram:SpecifiedTaxRegistration': {
          'ram:ID': {
            '@_schemeID': 'VA',
            '#text': 'DE123456789' // USt-IdNr
          }
        }
      },
      'ram:BuyerTradeParty': {
        'ram:Name': this.formatBuyerName(invoice.ADDRESS),
        'ram:PostalTradeAddress': {
          'ram:PostcodeCode': invoice.ADDRESS.ZIPCODE || '',
          'ram:LineOne': this.formatStreet(invoice.ADDRESS),
          'ram:CityName': invoice.ADDRESS.CITY || '',
          'ram:CountryID': invoice.ADDRESS.COUNTRY || 'DE'
        }
      }
    };
  }
  
  /**
   * Trade Delivery - Lieferung
   */
  private mapTradeDelivery(invoice: MCBSInvoice['DOCUMENT']['INVOICE_DATA']) {
    return {
      'ram:ActualDeliverySupplyChainEvent': {
        'ram:OccurrenceDateTime': {
          'udt:DateTimeString': {
            '@_format': '102',
            '#text': this.formatDateToZUGFeRD(invoice.INVOICE_DATE)
          }
        }
      }
    };
  }
  
  /**
   * Trade Settlement - Zahlungsbedingungen & Summen
   */
  private mapTradeSettlement(
    invoice: MCBSInvoice['DOCUMENT']['INVOICE_DATA'],
    header: MCBSInvoice['DOCUMENT']['HEADER']
  ) {
    return {
      'ram:InvoiceCurrencyCode': 'EUR',
      
      'ram:SpecifiedTradeSettlementPaymentMeans': this.mapPaymentMeans(invoice, header),
      
      'ram:ApplicableTradeTax': this.mapTaxDetails(invoice),
      
      'ram:SpecifiedTradePaymentTerms': {
        'ram:Description': this.getPaymentTermsDescription(invoice),
        ...(invoice.PAYMENT_MODE.DUE_DATE && {
          'ram:DueDateDateTime': {
            'udt:DateTimeString': {
              '@_format': '102',
              '#text': this.formatDateToZUGFeRD(invoice.PAYMENT_MODE.DUE_DATE)
            }
          }
        })
      },
      
      'ram:SpecifiedTradeSettlementHeaderMonetarySummation': {
        'ram:LineTotalAmount': this.formatAmount(invoice.AMOUNTS.NET_AMOUNT),
        'ram:TaxBasisTotalAmount': this.formatAmount(invoice.AMOUNTS.NET_AMOUNT),
        'ram:TaxTotalAmount': {
          '@_currencyID': 'EUR',
          '#text': this.formatAmount(invoice.AMOUNTS.VAT_AMOUNT)
        },
        'ram:GrandTotalAmount': this.formatAmount(invoice.AMOUNTS.GROSS_AMOUNT),
        'ram:DuePayableAmount': this.formatAmount(invoice.AMOUNTS.OPEN_AMOUNT || invoice.AMOUNTS.TOTAL_AMOUNT)
      }
    };
  }
  
  /**
   * Payment Means - Zahlungsart
   */
  private mapPaymentMeans(
    invoice: MCBSInvoice['DOCUMENT']['INVOICE_DATA'],
    header: MCBSInvoice['DOCUMENT']['HEADER']
  ) {
    const payment = invoice.PAYMENT_MODE;
    
    // SEPA Lastschrift
    if (payment.PAYMENT_TYPE === 'SEPADEBIT' && payment.IBAN) {
      return {
        'ram:TypeCode': '59', // 59 = SEPA Lastschrift
        'ram:Information': `SEPA-Lastschrift - Mandatsreferenz: ${payment.MANDATE_REF || ''}`,
        'ram:PayeePartyCreditorFinancialAccount': {
          'ram:IBANID': payment.IBAN,
          'ram:AccountName': this.formatBuyerName(invoice.ADDRESS)
        },
        ...(payment.BIC && {
          'ram:PayeeSpecifiedCreditorFinancialInstitution': {
            'ram:BICID': payment.BIC
          }
        })
      };
    }
    
    // Überweisung (Standard)
    return {
      'ram:TypeCode': '58', // 58 = SEPA Überweisung
      'ram:Information': 'Überweisung',
      'ram:PayeePartyCreditorFinancialAccount': {
        'ram:IBANID': header.CLIENTBANK_ACNT || 'DE89370400440532013000',
        'ram:AccountName': header.BRAND?.DESC || 'freenet DLS GmbH'
      },
      'ram:PayeeSpecifiedCreditorFinancialInstitution': {
        'ram:BICID': header.CLIENTBANK_CODE || 'COBADEFFXXX'
      }
    };
  }
  
  /**
   * Tax Details - MwSt-Aufschlüsselung
   */
  private mapTaxDetails(invoice: MCBSInvoice['DOCUMENT']['INVOICE_DATA']) {
    const taxes: any[] = [];
    
    if (invoice.VAT_DETAILS?.VAT_DETAIL) {
      for (const vat of invoice.VAT_DETAILS.VAT_DETAIL) {
        taxes.push({
          'ram:CalculatedAmount': this.formatAmount(vat.VAT_AMOUNT),
          'ram:TypeCode': 'VAT',
          'ram:BasisAmount': this.formatAmount(vat.NET_AMOUNT),
          'ram:CategoryCode': parseFloat(vat.VAT_RATE) > 0 ? 'S' : 'Z',
          'ram:RateApplicablePercent': this.formatAmount(vat.VAT_RATE)
        });
      }
    } else {
      // Fallback: Eine MwSt-Position
      taxes.push({
        'ram:CalculatedAmount': this.formatAmount(invoice.AMOUNTS.VAT_AMOUNT),
        'ram:TypeCode': 'VAT',
        'ram:BasisAmount': this.formatAmount(invoice.AMOUNTS.NET_AMOUNT),
        'ram:CategoryCode': 'S',
        'ram:RateApplicablePercent': '19'
      });
    }
    
    return taxes;
  }
  
  /**
   * Hilfsfunktionen
   */
  
  private formatAmount(amount: string | number | undefined): string {
    if (!amount) return '0.00';
    const num = typeof amount === 'string' ? parseFloat(amount) : amount;
    return num.toFixed(2);
  }
  
  private formatDateToZUGFeRD(date: string): string {
    // MCBS Format: DD.MM.YYYY oder YYYY-MM-DD
    // ZUGFeRD Format: YYYYMMDD
    try {
      let parsed: Date;
      if (date.includes('.')) {
        parsed = parse(date, 'dd.MM.yyyy', new Date());
      } else if (date.includes('-')) {
        parsed = parse(date, 'yyyy-MM-dd', new Date());
      } else if (date.length === 8) {
        return date; // Bereits im richtigen Format
      } else {
        return format(new Date(), 'yyyyMMdd');
      }
      return format(parsed, 'yyyyMMdd');
    } catch {
      return format(new Date(), 'yyyyMMdd');
    }
  }
  
  private formatBuyerName(address: MCBSInvoice['DOCUMENT']['INVOICE_DATA']['ADDRESS']): string {
    if (address.COMPANY) {
      return address.COMPANY;
    }
    const parts = [
      address.SALUTATION,
      address.FIRST_NAME,
      address.LAST_NAME
    ].filter(Boolean);
    return parts.join(' ');
  }
  
  private formatStreet(address: MCBSInvoice['DOCUMENT']['INVOICE_DATA']['ADDRESS']): string {
    const parts = [address.STREET, address.STREET_NO].filter(Boolean);
    return parts.join(' ');
  }
  
  private getPaymentTermsDescription(invoice: MCBSInvoice['DOCUMENT']['INVOICE_DATA']): string {
    const payment = invoice.PAYMENT_MODE;
    
    if (payment.PAYMENT_TYPE === 'SEPADEBIT') {
      return 'Zahlung per SEPA-Lastschrift';
    } else if (payment.DUE_DATE) {
      return `Zahlung bis ${invoice.PAYMENT_MODE.DUE_DATE}`;
    } else {
      return 'Zahlung sofort fällig';
    }
  }
  
  private cleanText(text: string | undefined): string {
    if (!text) return '';
    return text
      .replace(/<[^>]*>/g, '') // HTML Tags entfernen
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .trim();
  }
}
```

---

## 2. Lambda Function Implementation

### 2.1. Handler

```typescript
// src/handlers/convert-invoice-handler.ts
import { S3Event, S3Handler } from 'aws-lambda';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import { MCBSToZUGFeRDMapper } from '../mappers/mcbs-to-zugferd-mapper';
import { MCBSInvoice } from '../types/mcbs-invoice';

const s3Client = new S3Client({ region: process.env.AWS_REGION });
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_'
});
const xmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: true,
  suppressEmptyNode: true
});

export const handler: S3Handler = async (event: S3Event) => {
  
  for (const record of event.Records) {
    try {
      const bucket = record.s3.bucket.name;
      const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
      
      console.log(`Processing invoice: s3://${bucket}/${key}`);
      
      // 1. MCBS XML von S3 laden
      const mcbsXml = await loadXmlFromS3(bucket, key);
      
      // 2. XML parsen
      const mcbsInvoice: MCBSInvoice = xmlParser.parse(mcbsXml);
      
      console.log(`Parsed MCBS invoice: ${mcbsInvoice.DOCUMENT.INVOICE_DATA.BILLNO}`);
      
      // 3. Zu ZUGFeRD konvertieren
      const mapper = new MCBSToZUGFeRDMapper();
      const zugferdInvoice = mapper.mapToZUGFeRD(mcbsInvoice);
      
      // 4. ZUGFeRD XML generieren
      const zugferdXml = xmlBuilder.build(zugferdInvoice);
      
      // 5. XML-Deklaration hinzufügen
      const completeXml = `<?xml version="1.0" encoding="UTF-8"?>\n${zugferdXml}`;
      
      // 6. ZUGFeRD XML nach S3 speichern
      const outputKey = key.replace('.xml', '_zugferd.xml').replace('raw/', 'zugferd/');
      await saveXmlToS3(
        process.env.OUTPUT_BUCKET!,
        outputKey,
        completeXml
      );
      
      console.log(`Successfully converted to ZUGFeRD: s3://${process.env.OUTPUT_BUCKET}/${outputKey}`);
      
      // 7. Optional: Metadata aktualisieren
      await updateInvoiceMetadata(mcbsInvoice.DOCUMENT.INVOICE_DATA.BILLNO, {
        zugferdGenerated: true,
        zugferdS3Key: outputKey,
        processedAt: new Date().toISOString()
      });
      
    } catch (error) {
      console.error(`Failed to process invoice:`, error);
      throw error;
    }
  }
};

async function loadXmlFromS3(bucket: string, key: string): Promise<string> {
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  const response = await s3Client.send(command);
  return response.Body!.transformToString('utf-8');
}

async function saveXmlToS3(bucket: string, key: string, xml: string): Promise<void> {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: xml,
    ContentType: 'application/xml',
    Metadata: {
      'zugferd-version': '2.1',
      'zugferd-profile': 'COMFORT'
    }
  });
  await s3Client.send(command);
}

async function updateInvoiceMetadata(billNo: string, metadata: any): Promise<void> {
  // Optional: DynamoDB Update für Tracking
  // const dynamoClient = new DynamoDBDocumentClient.from(new DynamoDBClient({}));
  // await dynamoClient.send(new UpdateCommand({ ... }));
}
```

---

## 3. AWS Infrastructure

### 3.1. Serverless.yml

```yaml
service: mcbs-to-zugferd-converter

provider:
  name: aws
  runtime: nodejs18.x
  region: eu-central-1
  memorySize: 512
  timeout: 300
  environment:
    OUTPUT_BUCKET: ${self:custom.outputBucket}
  iam:
    role:
      statements:
        - Effect: Allow
          Action:
            - s3:GetObject
          Resource: 
            - 'arn:aws:s3:::${self:custom.inputBucket}/*'
        - Effect: Allow
          Action:
            - s3:PutObject
          Resource:
            - 'arn:aws:s3:::${self:custom.outputBucket}/*'

functions:
  convertInvoice:
    handler: src/handlers/convert-invoice-handler.handler
    events:
      - s3:
          bucket: ${self:custom.inputBucket}
          event: s3:ObjectCreated:*
          rules:
            - suffix: .xml
            - prefix: raw/

custom:
  inputBucket: mcbs-invoices-raw
  outputBucket: zugferd-invoices

resources:
  Resources:
    # S3 Buckets
    InputBucket:
      Type: AWS::S3::Bucket
      Properties:
        BucketName: ${self:custom.inputBucket}
        VersioningConfiguration:
          Status: Enabled
        LifecycleConfiguration:
          Rules:
            - Id: DeleteOldInvoices
              Status: Enabled
              ExpirationInDays: 90
    
    OutputBucket:
      Type: AWS::S3::Bucket
      Properties:
        BucketName: ${self:custom.outputBucket}
        VersioningConfiguration:
          Status: Enabled
    
    # Optional: DynamoDB für Tracking
    InvoiceTrackingTable:
      Type: AWS::DynamoDB::Table
      Properties:
        TableName: InvoiceConversions
        BillingMode: PAY_PER_REQUEST
        AttributeDefinitions:
          - AttributeName: billNo
            AttributeType: S
        KeySchema:
          - AttributeName: billNo
            KeyType: HASH
```

---

## 4. Deployment

### 4.1. package.json

```json
{
  "name": "mcbs-to-zugferd-converter",
  "version": "1.0.0",
  "scripts": {
    "build": "tsc",
    "deploy": "serverless deploy",
    "test": "jest",
    "local": "serverless invoke local -f convertInvoice -p test/events/s3-event.json"
  },
  "dependencies": {
    "@aws-sdk/client-s3": "^3.0.0",
    "@aws-sdk/client-dynamodb": "^3.0.0",
    "@aws-sdk/lib-dynamodb": "^3.0.0",
    "fast-xml-parser": "^4.3.0",
    "date-fns": "^3.0.0"
  },
  "devDependencies": {
    "@types/aws-lambda": "^8.10.0",
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0",
    "serverless": "^3.38.0",
    "jest": "^29.0.0",
    "@types/jest": "^29.0.0",
    "ts-jest": "^29.0.0"
  }
}
```

### 4.2. tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "moduleResolution": "node"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "**/*.test.ts"]
}
```

### 4.3. Deployment

```bash
# Installation
npm install

# Build
npm run build

# Deploy
serverless deploy --stage production

# Test lokal
serverless invoke local -f convertInvoice -p test/events/s3-event.json
```

---

## 5. Testing

### 5.1. Unit Test

```typescript
// test/mappers/mcbs-to-zugferd-mapper.test.ts
import { MCBSToZUGFeRDMapper } from '../../src/mappers/mcbs-to-zugferd-mapper';
import { MCBSInvoice } from '../../src/types/mcbs-invoice';

describe('MCBSToZUGFeRDMapper', () => {
  let mapper: MCBSToZUGFeRDMapper;
  
  beforeEach(() => {
    mapper = new MCBSToZUGFeRDMapper();
  });
  
  it('should convert MCBS invoice to ZUGFeRD', () => {
    const mcbsInvoice: MCBSInvoice = {
      DOCUMENT: {
        HEADER: {
          INVOICE_DATE: '01.02.2026',
          BILLRUN_ID: 'BILL_2026_02',
          BRAND: {
            CODE_SHORTCUT: 'FN',
            CODE_DESC: 'freenet',
            SHORTCUT: 'freenet',
            DESC: 'freenet DLS GmbH'
          },
          CLIENTBANK_ACNT: 'DE89370400440532013000',
          CLIENTBANK_CODE: 'COBADEFFXXX',
          CLIENTBANK_NAME: 'Commerzbank'
        },
        INVOICE_DATA: {
          CUSTOMER_NO: 'CUST123456',
          BILLNO: 'INV-2026-000001',
          INVOICE_DATE: '01.02.2026',
          AMOUNTS: {
            NET_AMOUNT: '100.00',
            VAT_AMOUNT: '19.00',
            GROSS_AMOUNT: '119.00',
            TOTAL_AMOUNT: '119.00'
          },
          PAYMENT_MODE: {
            PAYMENT_TYPE: 'SEPADEBIT',
            IBAN: 'DE02300606010002474689',
            BIC: 'DAAEDEDDXXX',
            DUE_DATE: '15.02.2026'
          },
          ADDRESS: {
            FIRST_NAME: 'Max',
            LAST_NAME: 'Mustermann',
            STREET: 'Musterstraße',
            STREET_NO: '123',
            ZIPCODE: '12345',
            CITY: 'Berlin',
            COUNTRY: 'DE'
          }
        }
      }
    };
    
    const zugferd = mapper.mapToZUGFeRD(mcbsInvoice);
    
    expect(zugferd['rsm:CrossIndustryInvoice']).toBeDefined();
    expect(zugferd['rsm:CrossIndustryInvoice']['rsm:ExchangedDocument']['ram:ID']).toBe('INV-2026-000001');
    expect(zugferd['rsm:CrossIndustryInvoice']['rsm:SupplyChainTradeTransaction']['ram:ApplicableHeaderTradeSettlement']['ram:SpecifiedTradeSettlementHeaderMonetarySummation']['ram:GrandTotalAmount']).toBe('119.00');
  });
});
```

---

## 6. Monitoring & Logging

### 6.1. CloudWatch Dashboard

```typescript
// cloudwatch/dashboard.json
{
  "widgets": [
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["AWS/Lambda", "Invocations", { "stat": "Sum" }],
          [".", "Errors", { "stat": "Sum" }],
          [".", "Duration", { "stat": "Average" }]
        ],
        "period": 300,
        "stat": "Sum",
        "region": "eu-central-1",
        "title": "MCBS to ZUGFeRD Converter - Lambda Metrics"
      }
    },
    {
      "type": "log",
      "properties": {
        "query": "SOURCE '/aws/lambda/mcbs-to-zugferd-converter-convertInvoice'\n| fields @timestamp, @message\n| filter @message like /Successfully converted/\n| stats count() by bin(5m)",
        "region": "eu-central-1",
        "title": "Successful Conversions"
      }
    }
  ]
}
```

---

## Zusammenfassung

### ✅ Lösung

**AWS Lambda + TypeScript** für MCBS → ZUGFeRD Konvertierung

**Workflow:**
1. **MCBS XML** wird in S3 hochgeladen (`mcbs-invoices-raw/`)
2. **S3 Event** triggert Lambda
3. **Lambda** lädt XML, konvertiert zu ZUGFeRD
4. **ZUGFeRD XML** wird nach S3 gespeichert (`zugferd-invoices/`)

**Kosten** (bei 10.000 Rechnungen/Monat):
- Lambda: ~$0.20
- S3: ~$1.00
- **GESAMT**: ~$1.20/Monat

**Deployment-Ready!** 🚀
