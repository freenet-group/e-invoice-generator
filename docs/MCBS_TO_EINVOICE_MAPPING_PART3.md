# MCBS → @e-invoice-eu/core Mapping (Teil 3: Integration)

## 💻 Schritt 4: @e-invoice-eu/core Integration

```typescript
// src/services/zugferd-generator.service.ts
import { CIIGenerator, XRechnungGenerator } from '@e-invoice-eu/core';
import { MCBSParserService } from './mcbs-parser.service';
import { MCBSToEInvoiceMapper } from './mcbs-to-einvoice-mapper.service';

export class ZugferdGeneratorService {
  
  private mcbsParser = new MCBSParserService();
  private mapper = new MCBSToEInvoiceMapper();
  private ciiGenerator = new CIIGenerator();
  private xrechnungGenerator = new XRechnungGenerator();
  
  /**
   * MCBS XML → ZUGFeRD 2.1.1 XML
   */
  async generateZugferd21(mcbsXmlString: string): Promise<string> {
    
    // 1. Parse MCBS XML
    const mcbsDocument = this.mcbsParser.parse(mcbsXmlString);
    
    // 2. Mappe zu @e-invoice-eu/core Format
    const invoiceData = this.mapper.map(mcbsDocument);
    
    // 3. Generiere ZUGFeRD XML
    const zugferdXml = this.ciiGenerator.generate(invoiceData, {
      profile: 'COMFORT',
      version: '2.1.1'
    });
    
    return zugferdXml;
  }
  
  /**
   * MCBS XML → XRechnung 3.0 XML
   */
  async generateXRechnung30(mcbsXmlString: string): Promise<string> {
    
    const mcbsDocument = this.mcbsParser.parse(mcbsXmlString);
    const invoiceData = this.mapper.map(mcbsDocument);
    
    const xrechnungXml = this.xrechnungGenerator.generate(invoiceData);
    
    return xrechnungXml;
  }
}
```

---

## 💻 Schritt 5: Lambda Handler

```typescript
// src/handlers/mcbs-to-zugferd.handler.ts
import { S3Event } from 'aws-lambda';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { ZugferdGeneratorService } from '../services/zugferd-generator.service';

const s3 = new S3Client({ region: process.env.AWS_REGION });
const service = new ZugferdGeneratorService();

export const handler = async (event: S3Event) => {
  
  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
    
    console.log(`Processing: s3://${bucket}/${key}`);
    
    // 1. Lade MCBS XML
    const mcbsXml = await loadFromS3(bucket, key);
    
    // 2. Generiere ZUGFeRD XML
    const zugferdXml = await service.generateZugferd21(mcbsXml);
    
    // 3. Speichere ZUGFeRD XML
    const zugferdKey = key.replace('/raw/', '/zugferd/').replace('.xml', '_zugferd.xml');
    await saveToS3(bucket, zugferdKey, zugferdXml);
    
    console.log(`✅ Success: s3://${bucket}/${zugferdKey}`);
  }
};

async function loadFromS3(bucket: string, key: string): Promise<string> {
  const { Body } = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return Body!.transformToString('utf-8');
}

async function saveToS3(bucket: string, key: string, content: string): Promise<void> {
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: content,
    ContentType: 'application/xml'
  }));
}
```

---

## 📋 Mapping-Tabelle

| MCBS Feld | @e-invoice-eu/core Feld | Transformation |
|-----------|------------------------|----------------|
| `BILLNO` | `number` | Direkt |
| `INVOICE_DATE` | `issueDate` | DD.MM.YYYY → YYYY-MM-DD |
| `BRAND.DESC` | `seller.name` | Direkt |
| `ADDRESS.COMPANY` | `buyer.name` | Oder FIRST_NAME + LAST_NAME |
| `ADDRESS.STREET` | `buyer.postalAddress.streetName` | Direkt |
| `ADDRESS.ZIPCODE` | `buyer.postalAddress.postalCode` | Direkt |
| `AMOUNTS.NET_AMOUNT` | `totals.lineTotal` | String → Number |
| `AMOUNTS.VAT_AMOUNT` | `totals.taxTotal` | String → Number |
| `AMOUNTS.GROSS_AMOUNT` | `totals.grandTotal` | String → Number |
| `PAYMENT_MODE.PAYMENT_TYPE` | `paymentMeans[0].typeCode` | SEPADEBIT → '59' |
| `PAYMENT_MODE.IBAN` | `paymentMeans[0].payeeAccount.iban` | Direkt |

---

## 🎯 Workflow Zusammenfassung

```
1. MCBS XML String
   ↓
2. MCBSParserService.parse()
   → MCBS Document Object
   ↓
3. MCBSToEInvoiceMapper.map()
   → @e-invoice-eu/core Invoice Data
   ↓
4. CIIGenerator.generate()
   → ZUGFeRD 2.1.1 XML String
```

---

## 🧪 Test-Beispiel

```typescript
// test/integration/mcbs-to-zugferd.test.ts
import { ZugferdGeneratorService } from '../../src/services/zugferd-generator.service';

describe('MCBS to ZUGFeRD', () => {
  
  it('should convert MCBS XML to ZUGFeRD', async () => {
    const service = new ZugferdGeneratorService();
    
    const mcbsXml = `
      <DOCUMENT>
        <HEADER>
          <BRAND><DESC>freenet</DESC></BRAND>
          <BILLING_ENTITY>
            <NAME>freenet DLS GmbH</NAME>
            <ZIPCODE>24937</ZIPCODE>
            <CITY>Flensburg</CITY>
          </BILLING_ENTITY>
        </HEADER>
        <INVOICE_DATA>
          <BILLNO>INV-2026-000001</BILLNO>
          <INVOICE_DATE>21.02.2026</INVOICE_DATE>
          <ADDRESS>
            <COMPANY>Test GmbH</COMPANY>
            <STREET>Teststr.</STREET>
            <STREET_NO>1</STREET_NO>
            <ZIPCODE>12345</ZIPCODE>
            <CITY>Berlin</CITY>
          </ADDRESS>
          <AMOUNTS>
            <NET_AMOUNT>100.00</NET_AMOUNT>
            <VAT_AMOUNT>19.00</VAT_AMOUNT>
            <GROSS_AMOUNT>119.00</GROSS_AMOUNT>
            <TOTAL_AMOUNT>119.00</TOTAL_AMOUNT>
          </AMOUNTS>
          <PAYMENT_MODE>
            <PAYMENT_TYPE>SEPADEBIT</PAYMENT_TYPE>
            <IBAN>DE02300606010002474689</IBAN>
          </PAYMENT_MODE>
        </INVOICE_DATA>
      </DOCUMENT>
    `;
    
    const zugferdXml = await service.generateZugferd21(mcbsXml);
    
    expect(zugferdXml).toContain('CrossIndustryInvoice');
    expect(zugferdXml).toContain('INV-2026-000001');
    expect(zugferdXml).toContain('Test GmbH');
  });
});
```

---

## ✅ Zusammenfassung

**Das Mapping erfolgt in 3 Schritten:**

1. **Parser**: MCBS XML String → Strukturiertes TypeScript Object
2. **Mapper**: MCBS Format → @e-invoice-eu/core Format
3. **Generator**: @e-invoice-eu/core Format → ZUGFeRD XML

**Der Mapper ist der Schlüssel** - er übersetzt Dein Inhouse-Format zum Standard-Format!

**Alle Business-Logik** (Datumsformatierung, Payment-Type-Codes, etc.) im Mapper konzentriert → **testbar & wartbar**! ✅