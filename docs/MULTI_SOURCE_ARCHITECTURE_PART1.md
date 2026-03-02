# Multi-Source E-Invoice Architecture: Legacy MCBS + AWS Billing Service

## 🎯 Die Herausforderung

**Zwei parallele Billing-Systeme:**

```
Legacy System (MCBS):
├── Output: Inhouse XML
├── Storage: File System / S3
└── Trigger: S3 Events

Neues AWS Billing Service:
├── Output: JSON (REST API)
├── Storage: DynamoDB
└── Trigger: EventBridge / API Gateway
```

**Ziel:** E-Invoice Generator soll **BEIDE** bedienen!

---

## 🏗️ Empfohlene Architektur: Event-Driven mit Adapter Pattern

### Option 1: Unified Event-Driven Architecture ⭐ EMPFOHLEN

```
┌─────────────────────────────────────────────────────────────────┐
│ Event Sources                                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ Legacy MCBS:                    AWS Billing Service:           │
│ ├── S3 Upload (XML)             ├── DynamoDB Stream            │
│ ├── → S3 Event                  ├── → EventBridge Event        │
│ └── → EventBridge               └── → EventBridge              │
│                                                                 │
└────────────┬─────────────────────────────┬──────────────────────┘
             │                             │
             └──────────────┬──────────────┘
                            │
                            ↓
              ┌─────────────────────────────┐
              │ EventBridge Rule            │
              │ - Pattern Matching          │
              │ - Source Routing            │
              └─────────────┬───────────────┘
                            │
                            ↓
              ┌─────────────────────────────┐
              │ SQS Queue (Unified)         │
              │ - Batching                  │
              │ - Retry                     │
              │ - DLQ                       │
              └─────────────┬───────────────┘
                            │
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ Lambda: E-Invoice Generator (Unified)                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 1. Event Parser (detects source type)                   │  │
│  └────────────┬─────────────────────────┬───────────────────┘  │
│               │                         │                       │
│               ↓                         ↓                       │
│  ┌──────────────────────┐  ┌──────────────────────────┐       │
│  │ MCBS Adapter         │  │ AWS Billing Adapter      │       │
│  │ ├── Load from S3     │  │ ├── Load from DynamoDB   │       │
│  │ ├── Parse XML        │  │ ├── Parse JSON           │       │
│  │ └── Map to Common    │  │ └── Map to Common        │       │
│  └────────────┬─────────┘  └────────────┬─────────────┘       │
│               │                         │                       │
│               └──────────┬──────────────┘                       │
│                          ↓                                      │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Common Invoice Model (Source-agnostic)                   │  │
│  └────────────┬─────────────────────────────────────────────┘  │
│               │                                                 │
│               ↓                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ @e-invoice-eu/core                                       │  │
│  │ ├── Generate ZUGFeRD XML                                 │  │
│  │ └── Embed in PDF                                         │  │
│  └────────────┬─────────────────────────────────────────────┘  │
│               │                                                 │
└───────────────┼─────────────────────────────────────────────────┘
                │
                ↓
┌─────────────────────────────────────────────────────────────────┐
│ Storage                                                         │
├─────────────────────────────────────────────────────────────────┤
│ S3: E-Invoices (PDF/A-3)                                       │
│ DynamoDB: Metadata (optional)                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📦 TypeScript Implementation: Adapter Pattern

### 1. Common Invoice Model (Source-Agnostic)

```typescript
// src/models/common-invoice.model.ts

/**
 * Gemeinsames Invoice-Format (unabhängig von Source)
 * Basierend auf EN 16931 / @e-invoice-eu/core
 */
export interface CommonInvoice {
  // Header
  invoiceNumber: string;
  invoiceDate: string;
  invoiceType: InvoiceType;
  currency: string;
  
  // Metadata (Source-Tracking)
  source: {
    system: 'MCBS' | 'AWS_BILLING';
    id: string;
    timestamp: string;
  };
  
  // Parties
  seller: Party;
  buyer: Party;
  
  // Line Items
  lineItems: LineItem[];
  
  // Payment
  paymentMeans: PaymentMeans[];
  paymentTerms?: PaymentTerms;
  
  // Taxes
  taxes: Tax[];
  
  // Totals
  totals: Totals;
  
  // Attachments (PDF)
  pdf?: {
    s3Key?: string;        // Legacy: PDF in S3
    dynamoDbId?: string;   // New: PDF Reference in DynamoDB
    base64?: string;       // New: PDF as Base64 in JSON
  };
}

export enum InvoiceType {
  COMMERCIAL = '380',
  CREDIT_NOTE = '381',
  CORRECTED = '384'
}

export interface Party {
  name: string;
  postalAddress: {
    streetName?: string;
    buildingNumber?: string;
    postalCode: string;
    cityName: string;
    countryCode: string;
  };
  taxRegistration?: Array<{
    id: { value: string; schemeId: string; };
  }>;
  electronicAddress?: {
    value: string;
    schemeId: string;
  };
}

export interface LineItem {
  id: number;
  name: string;
  quantity: number;
  unitCode: string;
  unitPrice: number;
  netAmount: number;
  tax: {
    typeCode: string;
    categoryCode: string;
    rate: number;
  };
}

export interface PaymentMeans {
  typeCode: string;
  information?: string;
  payeeAccount?: {
    iban?: string;
  };
}

export interface PaymentTerms {
  description?: string;
  dueDate?: string;
}

export interface Tax {
  typeCode: string;
  categoryCode: string;
  rate: number;
  basisAmount: number;
  calculatedAmount: number;
}

export interface Totals {
  lineTotal: number;
  taxBasisTotal: number;
  taxTotal: number;
  grandTotal: number;
  duePayable: number;
}
```

---

### 2. Invoice Adapter Interface

```typescript
// src/adapters/invoice-adapter.interface.ts

import { CommonInvoice } from '../models/common-invoice.model';

/**
 * Adapter Interface - jedes Source-System implementiert dies
 */
export interface InvoiceAdapter {
  /**
   * Lädt Invoice-Daten aus dem jeweiligen System
   */
  loadInvoiceData(eventPayload: any): Promise<RawInvoiceData>;
  
  /**
   * Mappt Source-spezifische Daten zu Common Invoice Model
   */
  mapToCommonModel(rawData: RawInvoiceData): Promise<CommonInvoice>;
  
  /**
   * Lädt PDF (falls separat gespeichert)
   */
  loadPDF(invoice: CommonInvoice): Promise<Buffer | null>;
}

export interface RawInvoiceData {
  source: 'MCBS' | 'AWS_BILLING';
  data: any;
  metadata: {
    id: string;
    timestamp: string;
  };
}
```

---

### 3. MCBS Adapter (Legacy)

```typescript
// src/adapters/mcbs-adapter.ts

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { InvoiceAdapter, RawInvoiceData } from './invoice-adapter.interface';
import { CommonInvoice, InvoiceType } from '../models/common-invoice.model';
import { MCBSParserService } from '../services/mcbs-parser.service';

export class MCBSAdapter implements InvoiceAdapter {
  
  private s3 = new S3Client({ region: process.env.AWS_REGION });
  private parser = new MCBSParserService();
  
  async loadInvoiceData(eventPayload: any): Promise<RawInvoiceData> {
    // EventBridge Event von S3
    const s3Event = eventPayload.detail;
    const bucket = s3Event.bucket.name;
    const key = s3Event.object.key;
    
    // Lade MCBS XML von S3
    const xmlContent = await this.loadFromS3(bucket, key);
    
    // Parse XML
    const mcbsDocument = this.parser.parse(xmlContent);
    
    return {
      source: 'MCBS',
      data: mcbsDocument,
      metadata: {
        id: mcbsDocument.DOCUMENT.INVOICE_DATA.BILLNO,
        timestamp: new Date().toISOString()
      }
    };
  }
  
  async mapToCommonModel(rawData: RawInvoiceData): Promise<CommonInvoice> {
    const mcbs = rawData.data;
    const invoice = mcbs.DOCUMENT.INVOICE_DATA;
    const header = mcbs.DOCUMENT.HEADER;
    
    return {
      // Header
      invoiceNumber: invoice.BILLNO,
      invoiceDate: this.formatDate(invoice.INVOICE_DATE),
      invoiceType: this.determineType(invoice),
      currency: 'EUR',
      
      // Source
      source: {
        system: 'MCBS',
        id: invoice.BILLNO,
        timestamp: rawData.metadata.timestamp
      },
      
      // Seller
      seller: {
        name: header.BRAND?.DESC || 'freenet DLS GmbH',
        postalAddress: {
          streetName: 'Hollerstraße',
          buildingNumber: '126',
          postalCode: '24937',
          cityName: 'Flensburg',
          countryCode: 'DE'
        },
        taxRegistration: [{
          id: {
            value: 'DE134084432',
            schemeId: 'VA'
          }
        }]
      },
      
      // Buyer
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
      paymentMeans: [{
        typeCode: this.getPaymentTypeCode(invoice.PAYMENT_MODE.PAYMENT_TYPE),
        information: this.getPaymentInfo(invoice.PAYMENT_MODE),
        payeeAccount: invoice.PAYMENT_MODE.IBAN ? {
          iban: invoice.PAYMENT_MODE.IBAN
        } : undefined
      }],
      
      // Taxes
      taxes: [{
        typeCode: 'VAT',
        categoryCode: 'S',
        rate: 19,
        basisAmount: parseFloat(invoice.AMOUNTS.NET_AMOUNT),
        calculatedAmount: parseFloat(invoice.AMOUNTS.VAT_AMOUNT)
      }],
      
      // Totals
      totals: {
        lineTotal: parseFloat(invoice.AMOUNTS.NET_AMOUNT),
        taxBasisTotal: parseFloat(invoice.AMOUNTS.NET_AMOUNT),
        taxTotal: parseFloat(invoice.AMOUNTS.VAT_AMOUNT),
        grandTotal: parseFloat(invoice.AMOUNTS.GROSS_AMOUNT),
        duePayable: parseFloat(invoice.AMOUNTS.TOTAL_AMOUNT)
      },
      
      // PDF Location
      pdf: {
        s3Key: this.derivePDFKey(invoice.BILLNO)  // S3 Key pattern
      }
    };
  }
  
  async loadPDF(invoice: CommonInvoice): Promise<Buffer | null> {
    if (!invoice.pdf?.s3Key) return null;
    
    const bucket = process.env.PDF_BUCKET_NAME!;
    const { Body } = await this.s3.send(new GetObjectCommand({
      Bucket: bucket,
      Key: invoice.pdf.s3Key
    }));
    
    const bytes = await Body!.transformToByteArray();
    return Buffer.from(bytes);
  }
  
  // Helper Methods
  private formatDate(dateStr: string): string {
    const [day, month, year] = dateStr.split('.');
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  
  private determineType(invoice: any): InvoiceType {
    if (invoice.INVOICE_TYPE === 'CREDIT_NOTE') return InvoiceType.CREDIT_NOTE;
    if (invoice.INVOICE_TYPE === 'CORRECTED') return InvoiceType.CORRECTED;
    return InvoiceType.COMMERCIAL;
  }
  
  private formatBuyerName(address: any): string {
    if (address.COMPANY) return address.COMPANY;
    return [address.FIRST_NAME, address.LAST_NAME].filter(Boolean).join(' ');
  }
  
  private mapLineItems(invoice: any): any[] {
    // Implementierung wie in vorherigen Mappern
    return [];
  }
  
  private getPaymentTypeCode(type: string): string {
    return type === 'SEPADEBIT' ? '59' : '58';
  }
  
  private getPaymentInfo(payment: any): string {
    if (payment.PAYMENT_TYPE === 'SEPADEBIT' && payment.MANDATE_REF) {
      return `SEPA-Lastschrift - Mandatsreferenz: ${payment.MANDATE_REF}`;
    }
    return 'Überweisung';
  }
  
  private derivePDFKey(billNo: string): string {
    // Pattern: pdf/YYYY/MM/DD/BILLNO.pdf
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `pdf/${year}/${month}/${day}/${billNo}.pdf`;
  }
  
  private async loadFromS3(bucket: string, key: string): Promise<string> {
    const { Body } = await this.s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return Body!.transformToString('utf-8');
  }
}
```

---

### 4. AWS Billing Adapter (Neu)

```typescript
// src/adapters/aws-billing-adapter.ts

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { InvoiceAdapter, RawInvoiceData } from './invoice-adapter.interface';
import { CommonInvoice, InvoiceType } from '../models/common-invoice.model';

/**
 * AWS Billing Service Invoice Format (JSON)
 */
export interface AWSBillingInvoice {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;  // ISO 8601
  invoiceType: 'STANDARD' | 'CREDIT' | 'CORRECTED';
  
  customer: {
    customerId: string;
    companyName?: string;
    firstName?: string;
    lastName?: string;
    address: {
      street: string;
      houseNumber: string;
      postalCode: string;
      city: string;
      country: string;
    };
  };
  
  lineItems: Array<{
    lineItemId: string;
    description: string;
    quantity: number;
    unitPrice: number;
    netAmount: number;
    vatRate: number;
  }>;
  
  payment: {
    method: 'SEPA_DEBIT' | 'BANK_TRANSFER';
    iban?: string;
    mandateReference?: string;
    dueDate?: string;
  };
  
  amounts: {
    subtotal: number;
    vatTotal: number;
    total: number;
  };
  
  pdf: {
    s3Bucket?: string;     // Falls PDF in S3
    s3Key?: string;
    base64Content?: string; // Falls PDF inline
  };
  
  metadata: {
    createdAt: string;
    createdBy: string;
  };
}

export class AWSBillingAdapter implements InvoiceAdapter {
  
  private dynamoDb: DynamoDBDocumentClient;
  private s3 = new S3Client({ region: process.env.AWS_REGION });
  
  constructor() {
    const client = new DynamoDBClient({ region: process.env.AWS_REGION });
    this.dynamoDb = DynamoDBDocumentClient.from(client);
  }
  
  async loadInvoiceData(eventPayload: any): Promise<RawInvoiceData> {
    // EventBridge Event von DynamoDB Stream
    const dynamoEvent = eventPayload.detail;
    const invoiceId = dynamoEvent.dynamodb.Keys.invoiceId.S;
    
    // Lade vollständige Invoice aus DynamoDB
    const { Item } = await this.dynamoDb.send(new GetCommand({
      TableName: process.env.BILLING_TABLE_NAME!,
      Key: { invoiceId }
    }));
    
    if (!Item) {
      throw new Error(`Invoice not found: ${invoiceId}`);
    }
    
    return {
      source: 'AWS_BILLING',
      data: Item as AWSBillingInvoice,
      metadata: {
        id: Item.invoiceId,
        timestamp: Item.metadata.createdAt
      }
    };
  }
  
  async mapToCommonModel(rawData: RawInvoiceData): Promise<CommonInvoice> {
    const awsInvoice = rawData.data as AWSBillingInvoice;
    
    return {
      // Header
      invoiceNumber: awsInvoice.invoiceNumber,
      invoiceDate: awsInvoice.invoiceDate,  // Already ISO 8601
      invoiceType: this.mapInvoiceType(awsInvoice.invoiceType),
      currency: 'EUR',
      
      // Source
      source: {
        system: 'AWS_BILLING',
        id: awsInvoice.invoiceId,
        timestamp: rawData.metadata.timestamp
      },
      
      // Seller (gleich wie MCBS)
      seller: {
        name: 'freenet DLS GmbH',
        postalAddress: {
          streetName: 'Hollerstraße',
          buildingNumber: '126',
          postalCode: '24937',
          cityName: 'Flensburg',
          countryCode: 'DE'
        },
        taxRegistration: [{
          id: {
            value: 'DE134084432',
            schemeId: 'VA'
          }
        }]
      },
      
      // Buyer
      buyer: {
        name: this.formatCustomerName(awsInvoice.customer),
        postalAddress: {
          streetName: awsInvoice.customer.address.street,
          buildingNumber: awsInvoice.customer.address.houseNumber,
          postalCode: awsInvoice.customer.address.postalCode,
          cityName: awsInvoice.customer.address.city,
          countryCode: awsInvoice.customer.address.country
        }
      },
      
      // Line Items
      lineItems: awsInvoice.lineItems.map((item, index) => ({
        id: index + 1,
        name: item.description,
        quantity: item.quantity,
        unitCode: 'C62',
        unitPrice: item.unitPrice,
        netAmount: item.netAmount,
        tax: {
          typeCode: 'VAT',
          categoryCode: 'S',
          rate: item.vatRate
        }
      })),
      
      // Payment
      paymentMeans: [{
        typeCode: this.mapPaymentMethod(awsInvoice.payment.method),
        information: this.getPaymentInfo(awsInvoice.payment),
        payeeAccount: awsInvoice.payment.iban ? {
          iban: awsInvoice.payment.iban
        } : undefined
      }],
      
      paymentTerms: awsInvoice.payment.dueDate ? {
        dueDate: awsInvoice.payment.dueDate,
        description: `Zahlung bis ${awsInvoice.payment.dueDate}`
      } : undefined,
      
      // Taxes
      taxes: this.calculateTaxes(awsInvoice),
      
      // Totals
      totals: {
        lineTotal: awsInvoice.amounts.subtotal,
        taxBasisTotal: awsInvoice.amounts.subtotal,
        taxTotal: awsInvoice.amounts.vatTotal,
        grandTotal: awsInvoice.amounts.total,
        duePayable: awsInvoice.amounts.total
      },
      
      // PDF
      pdf: {
        s3Key: awsInvoice.pdf.s3Key,
        dynamoDbId: awsInvoice.invoiceId,
        base64: awsInvoice.pdf.base64Content
      }
    };
  }
  
  async loadPDF(invoice: CommonInvoice): Promise<Buffer | null> {
    // Option 1: PDF in S3
    if (invoice.pdf?.s3Key && invoice.pdf?.s3Key) {
      const bucket = process.env.PDF_BUCKET_NAME!;
      const { Body } = await this.s3.send(new GetObjectCommand({
        Bucket: bucket,
        Key: invoice.pdf.s3Key
      }));
      const bytes = await Body!.transformToByteArray();
      return Buffer.from(bytes);
    }
    
    // Option 2: PDF als Base64 in DynamoDB/JSON
    if (invoice.pdf?.base64) {
      return Buffer.from(invoice.pdf.base64, 'base64');
    }
    
    return null;
  }
  
  // Helper Methods
  private mapInvoiceType(type: string): InvoiceType {
    switch (type) {
      case 'CREDIT': return InvoiceType.CREDIT_NOTE;
      case 'CORRECTED': return InvoiceType.CORRECTED;
      default: return InvoiceType.COMMERCIAL;
    }
  }
  
  private formatCustomerName(customer: any): string {
    if (customer.companyName) return customer.companyName;
    return [customer.firstName, customer.lastName].filter(Boolean).join(' ');
  }
  
  private mapPaymentMethod(method: string): string {
    return method === 'SEPA_DEBIT' ? '59' : '58';
  }
  
  private getPaymentInfo(payment: any): string {
    if (payment.method === 'SEPA_DEBIT' && payment.mandateReference) {
      return `SEPA-Lastschrift - Mandatsreferenz: ${payment.mandateReference}`;
    }
    return 'Überweisung';
  }
  
  private calculateTaxes(invoice: AWSBillingInvoice): any[] {
    // Gruppiere Line Items nach VAT Rate
    const taxMap = new Map<number, { basis: number; amount: number }>();
    
    for (const item of invoice.lineItems) {
      const existing = taxMap.get(item.vatRate) || { basis: 0, amount: 0 };
      existing.basis += item.netAmount;
      existing.amount += item.netAmount * (item.vatRate / 100);
      taxMap.set(item.vatRate, existing);
    }
    
    return Array.from(taxMap.entries()).map(([rate, amounts]) => ({
      typeCode: 'VAT',
      categoryCode: rate > 0 ? 'S' : 'Z',
      rate: rate,
      basisAmount: amounts.basis,
      calculatedAmount: amounts.amount
    }));
  }
}
```

Fortsetzung folgt...

