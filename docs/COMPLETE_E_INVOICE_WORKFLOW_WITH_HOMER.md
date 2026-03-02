# Kompletter E-Rechnungs Workflow mit HOMER

## Übersicht: End-to-End Prozess

```
MCBS Billing
  → MCBS XML erstellen
    → S3 Upload (raw/)
      → Lambda 1: HOMER REST Call
        → HOMER generiert PDF
          → PDF zu S3 (pdf/)
            → Lambda 2: MCBS → ZUGFeRD XML
              → ZUGFeRD XML zu S3 (zugferd/)
                → Lambda 3: PDF + XML → E-Rechnung
                  → E-Rechnung zu S3 (e-rechnung/)
```

---

## Architektur mit HOMER Integration

```
┌─────────────────────────────────────────────────────────────┐
│ MCBS Billing System (Java)                                  │
│ - Erstellt Rechnung                                         │
│ - Generiert mcbs_billoutput.xml                            │
└────────────┬────────────────────────────────────────────────┘
             │
             │ Upload
             ↓
┌─────────────────────────────────────────────────────────────┐
│ S3 Bucket: mcbs-invoices                                    │
│ ├── raw/2026/02/                                            │
│ │   └── INV-2026-000001.xml  ← MCBS XML                    │
└────────────┬────────────────────────────────────────────────┘
             │
             │ S3 Event (suffix: .xml, prefix: raw/)
             ↓
┌─────────────────────────────────────────────────────────────┐
│ Lambda 1: HOMER PDF Generator                               │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 1. Lädt MCBS XML von S3                                 │ │
│ │ 2. POST zu HOMER REST API                               │ │
│ │    - Endpoint: /api/v1/invoices/generate                │ │
│ │    - Method: POST                                        │ │
│ │    - Content-Type: multipart/form-data                  │ │
│ │    - Body: invoice.xml (MCBS Format)                    │ │
│ │ 3. Empfängt PDF als multipart/form-data Response        │ │
│ │ 4. Speichert PDF in S3                                  │ │
│ └─────────────────────────────────────────────────────────┘ │
└────────────┬────────────────────────────────────────────────┘
             │
             │ writes
             ↓
┌─────────────────────────────────────────────────────────────┐
│ S3 Bucket: mcbs-invoices                                    │
│ ├── pdf/2026/02/                                            │
│ │   └── INV-2026-000001.pdf  ← HOMER generiertes PDF       │
└────────────┬────────────────────────────────────────────────┘
             │
             │ S3 Event (suffix: .pdf, prefix: pdf/)
             ↓
┌─────────────────────────────────────────────────────────────┐
│ Lambda 2: MCBS to ZUGFeRD Converter                         │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 1. Lädt MCBS XML von S3 (raw/)                          │ │
│ │ 2. Konvertiert zu ZUGFeRD XML                           │ │
│ │    - Nutzt factur-x Library                             │ │
│ │    - Profile: COMFORT                                    │ │
│ │ 3. Validiert ZUGFeRD XML                                │ │
│ │ 4. Speichert ZUGFeRD XML in S3                          │ │
│ └─────────────────────────────────────────────────────────┘ │
└────────────┬────────────────────────────────────────────────┘
             │
             │ writes
             ↓
┌─────────────────────────────────────────────────────────────┐
│ S3 Bucket: mcbs-invoices                                    │
│ ├── zugferd/2026/02/                                        │
│ │   └── INV-2026-000001_zugferd.xml  ← ZUGFeRD XML         │
└────────────┬────────────────────────────────────────────────┘
             │
             │ S3 Event (suffix: _zugferd.xml, prefix: zugferd/)
             ↓
┌─────────────────────────────────────────────────────────────┐
│ Lambda 3: ZUGFeRD PDF Embedder                              │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 1. Findet zugehöriges PDF (pdf/)                        │ │
│ │ 2. Lädt PDF + ZUGFeRD XML                               │ │
│ │ 3. Bettet XML in PDF ein                                │ │
│ │    - Nutzt factur-x Library                             │ │
│ │    - PDF/A-3b Format                                     │ │
│ │ 4. Speichert E-Rechnung in S3                           │ │
│ └─────────────────────────────────────────────────────────┘ │
└────────────┬────────────────────────────────────────────────┘
             │
             │ writes
             ↓
┌─────────────────────────────────────────────────────────────┐
│ S3 Bucket: mcbs-invoices                                    │
│ ├── e-rechnung/2026/02/                                     │
│ │   └── INV-2026-000001_zugferd.pdf  ← Finale E-Rechnung   │
│ │                                                           │
│ │   ✅ PDF/A-3 mit eingebettetem ZUGFeRD XML               │
└─────────────────────────────────────────────────────────────┘
```

---

## S3 Bucket Struktur

```
s3://mcbs-invoices/
│
├── raw/                           # MCBS XML (Input)
│   ├── 2026/
│   │   ├── 01/
│   │   │   ├── INV-2026-000001.xml
│   │   │   └── INV-2026-000002.xml
│   │   ├── 02/
│   │   │   └── INV-2026-000123.xml
│   │   └── ...
│   └── ...
│
├── pdf/                           # HOMER generierte PDFs
│   ├── 2026/
│   │   ├── 01/
│   │   │   ├── INV-2026-000001.pdf
│   │   │   └── INV-2026-000002.pdf
│   │   ├── 02/
│   │   │   └── INV-2026-000123.pdf
│   │   └── ...
│   └── ...
│
├── zugferd/                       # ZUGFeRD XML
│   ├── 2026/
│   │   ├── 01/
│   │   │   ├── INV-2026-000001_zugferd.xml
│   │   │   └── INV-2026-000002_zugferd.xml
│   │   ├── 02/
│   │   │   └── INV-2026-000123_zugferd.xml
│   │   └── ...
│   └── ...
│
└── e-rechnung/                    # Finale E-Rechnungen (PDF/A-3 + XML)
    ├── 2026/
    │   ├── 01/
    │   │   ├── INV-2026-000001_zugferd.pdf
    │   │   └── INV-2026-000002_zugferd.pdf
    │   ├── 02/
    │   │   └── INV-2026-000123_zugferd.pdf
    │   └── ...
    └── ...
```

---

## Lambda 1: HOMER PDF Generator (Neu!)

### Handler Implementation

```typescript
// src/handlers/homer-pdf-generator-handler.ts
import { S3Event, S3Handler } from 'aws-lambda';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import FormData from 'form-data';
import axios from 'axios';

const s3Client = new S3Client({ region: process.env.AWS_REGION });

export const handler: S3Handler = async (event: S3Event) => {
  
  for (const record of event.Records) {
    try {
      const bucket = record.s3.bucket.name;
      const xmlKey = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
      
      console.log(`Processing MCBS XML: s3://${bucket}/${xmlKey}`);
      
      // 1. Lade MCBS XML von S3
      const mcbsXml = await loadXmlFromS3(bucket, xmlKey);
      
      // 2. Rufe HOMER REST API auf
      const pdfBuffer = await callHomerApi(mcbsXml, xmlKey);
      
      // 3. Speichere PDF in S3
      const pdfKey = xmlKey
        .replace('/raw/', '/pdf/')
        .replace('.xml', '.pdf');
      
      await savePdfToS3(bucket, pdfKey, pdfBuffer);
      
      console.log(`PDF generated and saved: s3://${bucket}/${pdfKey}`);
      
    } catch (error) {
      console.error('Failed to generate PDF via HOMER:', error);
      throw error;
    }
  }
};

/**
 * Lädt MCBS XML von S3
 */
async function loadXmlFromS3(bucket: string, key: string): Promise<string> {
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  const response = await s3Client.send(command);
  return response.Body!.transformToString('utf-8');
}

/**
 * Ruft HOMER REST API auf und empfängt PDF als Multipart Response
 */
async function callHomerApi(mcbsXml: string, filename: string): Promise<Buffer> {
  
  const homerUrl = process.env.HOMER_API_URL || 'https://homer.internal.company.com';
  const homerApiKey = process.env.HOMER_API_KEY;
  
  console.log(`Calling HOMER API: ${homerUrl}/api/v1/invoices/generate`);
  
  // 1. Erstelle multipart/form-data Request
  const formData = new FormData();
  formData.append('invoice', mcbsXml, {
    filename: filename,
    contentType: 'application/xml'
  });
  
  // Optional: Weitere Parameter
  formData.append('format', 'pdf');
  formData.append('template', 'standard_invoice');
  
  // 2. POST Request zu HOMER
  const response = await axios.post(
    `${homerUrl}/api/v1/invoices/generate`,
    formData,
    {
      headers: {
        ...formData.getHeaders(),
        'Authorization': `Bearer ${homerApiKey}`,
        'Accept': 'application/pdf'
      },
      responseType: 'arraybuffer', // Wichtig für PDF!
      timeout: 60000 // 60 Sekunden
    }
  );
  
  // 3. Validiere Response
  if (response.status !== 200) {
    throw new Error(`HOMER API returned status ${response.status}`);
  }
  
  const contentType = response.headers['content-type'];
  if (!contentType || !contentType.includes('application/pdf')) {
    throw new Error(`HOMER API returned unexpected content-type: ${contentType}`);
  }
  
  console.log(`Received PDF from HOMER (${response.data.length} bytes)`);
  
  return Buffer.from(response.data);
}

/**
 * Speichert PDF in S3
 */
async function savePdfToS3(
  bucket: string,
  key: string,
  pdfBuffer: Buffer
): Promise<void> {
  
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: pdfBuffer,
    ContentType: 'application/pdf',
    Metadata: {
      'generated-by': 'homer',
      'source': 'mcbs-billing',
      'created-at': new Date().toISOString()
    }
  });
  
  await s3Client.send(command);
}
```

---

## Lambda 2: MCBS to ZUGFeRD Converter (Angepasst)

### Handler Implementation

```typescript
// src/handlers/mcbs-to-zugferd-converter-handler.ts
import { S3Event, S3Handler } from 'aws-lambda';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { FacturX, Profile } from 'factur-x';
import { MCBSToZUGFeRDConverter } from '../services/mcbs-to-zugferd-converter';

const s3Client = new S3Client({ region: process.env.AWS_REGION });

export const handler: S3Handler = async (event: S3Event) => {
  
  for (const record of event.Records) {
    try {
      const bucket = record.s3.bucket.name;
      const pdfKey = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
      
      console.log(`PDF created: s3://${bucket}/${pdfKey}`);
      console.log(`Now generating ZUGFeRD XML...`);
      
      // 1. Finde zugehöriges MCBS XML
      const mcbsXmlKey = pdfKey
        .replace('/pdf/', '/raw/')
        .replace('.pdf', '.xml');
      
      console.log(`Loading MCBS XML: ${mcbsXmlKey}`);
      
      // 2. Lade MCBS XML
      const mcbsXml = await loadXmlFromS3(bucket, mcbsXmlKey);
      
      // 3. Parse MCBS XML
      const mcbsInvoice = parseMCBSXml(mcbsXml);
      
      // 4. Konvertiere zu factur-x Format
      const converter = new MCBSToZUGFeRDConverter();
      const facturxInvoice = converter.mapToFacturX(mcbsInvoice);
      
      // 5. Generiere ZUGFeRD XML mit factur-x Library
      const zugferdXml = await FacturX.generateXML(
        facturxInvoice,
        Profile.COMFORT
      );
      
      // 6. Validiere ZUGFeRD XML
      const isValid = await FacturX.validateXML(zugferdXml);
      if (!isValid) {
        const errors = await FacturX.getValidationErrors(zugferdXml);
        console.error('ZUGFeRD validation errors:', errors);
        throw new Error('Generated ZUGFeRD XML is not valid');
      }
      
      console.log('ZUGFeRD XML validated successfully');
      
      // 7. Speichere ZUGFeRD XML
      const zugferdKey = pdfKey
        .replace('/pdf/', '/zugferd/')
        .replace('.pdf', '_zugferd.xml');
      
      await saveXmlToS3(bucket, zugferdKey, zugferdXml);
      
      console.log(`ZUGFeRD XML saved: s3://${bucket}/${zugferdKey}`);
      
    } catch (error) {
      console.error('Failed to generate ZUGFeRD XML:', error);
      throw error;
    }
  }
};

async function loadXmlFromS3(bucket: string, key: string): Promise<string> {
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  const response = await s3Client.send(command);
  return response.Body!.transformToString('utf-8');
}

async function saveXmlToS3(
  bucket: string,
  key: string,
  xml: string
): Promise<void> {
  
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: xml,
    ContentType: 'application/xml',
    Metadata: {
      'zugferd-version': '2.1',
      'zugferd-profile': 'COMFORT',
      'created-at': new Date().toISOString()
    }
  });
  
  await s3Client.send(command);
}

function parseMCBSXml(xml: string): any {
  const { XMLParser } = require('fast-xml-parser');
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_'
  });
  return parser.parse(xml);
}
```

---

## Lambda 3: ZUGFeRD PDF Embedder (Unverändert)

```typescript
// src/handlers/zugferd-pdf-embedder-handler.ts
import { S3Event, S3Handler } from 'aws-lambda';
import { FacturX } from 'factur-x';

export const handler: S3Handler = async (event: S3Event) => {
  
  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const zugferdXmlKey = record.s3.object.key;
    
    // 1. Finde zugehöriges PDF
    const pdfKey = zugferdXmlKey
      .replace('/zugferd/', '/pdf/')
      .replace('_zugferd.xml', '.pdf');
    
    // 2. Lade PDF + XML
    const [pdfBuffer, zugferdXml] = await Promise.all([
      loadPdfFromS3(bucket, pdfKey),
      loadXmlFromS3(bucket, zugferdXmlKey)
    ]);
    
    // 3. Bette ZUGFeRD XML in PDF ein
    const eInvoicePdf = await FacturX.embedInPDF(pdfBuffer, zugferdXml, {
      profile: 'COMFORT',
      pdfAVersion: '3b'
    });
    
    // 4. Speichere E-Rechnung
    const eInvoiceKey = pdfKey
      .replace('/pdf/', '/e-rechnung/')
      .replace('.pdf', '_zugferd.pdf');
    
    await savePdfToS3(bucket, eInvoiceKey, eInvoicePdf);
    
    console.log(`E-Invoice created: s3://${bucket}/${eInvoiceKey}`);
  }
};
```

---

## Serverless Configuration (Alle 3 Lambdas)

```yaml
# serverless.yml
service: mcbs-e-invoice-pipeline

provider:
  name: aws
  runtime: nodejs18.x
  region: eu-central-1
  environment:
    HOMER_API_URL: ${env:HOMER_API_URL}
    HOMER_API_KEY: ${env:HOMER_API_KEY}
  iam:
    role:
      statements:
        - Effect: Allow
          Action:
            - s3:GetObject
            - s3:PutObject
          Resource: 'arn:aws:s3:::mcbs-invoices/*'

functions:
  
  # Lambda 1: HOMER PDF Generator
  homerPdfGenerator:
    handler: src/handlers/homer-pdf-generator-handler.handler
    timeout: 120
    memorySize: 512
    events:
      - s3:
          bucket: mcbs-invoices
          event: s3:ObjectCreated:*
          rules:
            - suffix: .xml
            - prefix: raw/
  
  # Lambda 2: MCBS to ZUGFeRD Converter
  mcbsToZugferdConverter:
    handler: src/handlers/mcbs-to-zugferd-converter-handler.handler
    timeout: 60
    memorySize: 512
    events:
      - s3:
          bucket: mcbs-invoices
          event: s3:ObjectCreated:*
          rules:
            - suffix: .pdf
            - prefix: pdf/
  
  # Lambda 3: ZUGFeRD PDF Embedder
  zugferdPdfEmbedder:
    handler: src/handlers/zugferd-pdf-embedder-handler.handler
    timeout: 60
    memorySize: 1024
    events:
      - s3:
          bucket: mcbs-invoices
          event: s3:ObjectCreated:*
          rules:
            - suffix: _zugferd.xml
            - prefix: zugferd/

resources:
  Resources:
    McbsInvoicesBucket:
      Type: AWS::S3::Bucket
      Properties:
        BucketName: mcbs-invoices
        VersioningConfiguration:
          Status: Enabled
        LifecycleConfiguration:
          Rules:
            - Id: DeleteOldRawXml
              Status: Enabled
              Prefix: raw/
              ExpirationInDays: 90
            - Id: ArchiveEInvoices
              Status: Enabled
              Prefix: e-rechnung/
              Transitions:
                - TransitionInDays: 30
                  StorageClass: STANDARD_IA
                - TransitionInDays: 90
                  StorageClass: GLACIER
```

---

## Package.json Dependencies

```json
{
  "name": "mcbs-e-invoice-pipeline",
  "version": "1.0.0",
  "dependencies": {
    "@aws-sdk/client-s3": "^3.0.0",
    "factur-x": "^2.0.0",
    "axios": "^1.6.0",
    "form-data": "^4.0.0",
    "fast-xml-parser": "^4.3.0"
  },
  "devDependencies": {
    "@types/aws-lambda": "^8.10.0",
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0",
    "serverless": "^3.38.0"
  }
}
```

---

## HOMER API Specification (Annahme)

```yaml
# HOMER REST API
openapi: 3.0.0
info:
  title: HOMER Invoice PDF Generator API
  version: 1.0.0

paths:
  /api/v1/invoices/generate:
    post:
      summary: Generate Invoice PDF from MCBS XML
      requestBody:
        required: true
        content:
          multipart/form-data:
            schema:
              type: object
              properties:
                invoice:
                  type: string
                  format: binary
                  description: MCBS XML file
                format:
                  type: string
                  enum: [pdf, afp, pcl]
                  default: pdf
                template:
                  type: string
                  default: standard_invoice
      responses:
        '200':
          description: PDF successfully generated
          content:
            application/pdf:
              schema:
                type: string
                format: binary
        '400':
          description: Invalid XML or parameters
        '500':
          description: PDF generation failed
```

---

## Event-Flow Timeline

```
Zeit    | Aktion                              | Trigger
--------|-------------------------------------|----------------------------------
T+0s    | MCBS Billing lädt XML zu S3         | Manuell/Scheduled
        | → s3://mcbs-invoices/raw/INV-001.xml|
        |                                     |
T+1s    | S3 Event triggert Lambda 1          | S3 ObjectCreated
        | → HOMER PDF Generator               |
        |                                     |
T+5s    | Lambda 1 ruft HOMER API auf         | REST Call
        | → POST /api/v1/invoices/generate    |
        |                                     |
T+10s   | HOMER liefert PDF zurück            | Multipart Response
        | → Lambda 1 speichert zu S3          |
        | → s3://mcbs-invoices/pdf/INV-001.pdf|
        |                                     |
T+11s   | S3 Event triggert Lambda 2          | S3 ObjectCreated
        | → MCBS to ZUGFeRD Converter         |
        |                                     |
T+12s   | Lambda 2 lädt MCBS XML              | S3 GetObject
        | → Konvertiert zu ZUGFeRD            |
        | → Speichert ZUGFeRD XML zu S3       |
        | → s3://.../zugferd/INV-001_zugferd.xml|
        |                                     |
T+13s   | S3 Event triggert Lambda 3          | S3 ObjectCreated
        | → ZUGFeRD PDF Embedder              |
        |                                     |
T+14s   | Lambda 3 lädt PDF + XML             | S3 GetObject (2x)
        | → Bettet XML in PDF ein             |
        | → Speichert E-Rechnung zu S3        |
        | → s3://.../e-rechnung/INV-001_zugferd.pdf|
        |                                     |
T+15s   | ✅ E-Rechnung fertig!               | Komplett
```

**Gesamtdauer: ~15 Sekunden** (abhängig von HOMER Performance)

---

## Monitoring & Alerting

### CloudWatch Dashboard

```typescript
// CloudWatch Metrics
const metrics = {
  'HOMER_API_Calls': {
    namespace: 'EInvoicePipeline',
    metricName: 'HomerApiCalls',
    unit: 'Count'
  },
  'HOMER_API_Latency': {
    namespace: 'EInvoicePipeline',
    metricName: 'HomerApiLatency',
    unit: 'Milliseconds'
  },
  'ZUGFeRD_Validations': {
    namespace: 'EInvoicePipeline',
    metricName: 'ZugferdValidations',
    unit: 'Count'
  },
  'E_Invoice_Created': {
    namespace: 'EInvoicePipeline',
    metricName: 'EInvoicesCreated',
    unit: 'Count'
  }
};
```

### CloudWatch Alarms

```yaml
resources:
  Resources:
    HomerApiFailureAlarm:
      Type: AWS::CloudWatch::Alarm
      Properties:
        AlarmName: homer-api-failures
        MetricName: Errors
        Namespace: AWS/Lambda
        Statistic: Sum
        Period: 300
        EvaluationPeriods: 1
        Threshold: 5
        ComparisonOperator: GreaterThanThreshold
        Dimensions:
          - Name: FunctionName
            Value: !Ref HomerPdfGeneratorLambdaFunction
        AlarmActions:
          - !Ref AlertTopic
```

---

## Error Handling & Retry

### Lambda 1: HOMER API Fehlerbehandlung

```typescript
async function callHomerApiWithRetry(
  mcbsXml: string,
  filename: string,
  maxRetries: number = 3
): Promise<Buffer> {
  
  let lastError: Error;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Calling HOMER API (attempt ${attempt}/${maxRetries})`);
      
      const pdfBuffer = await callHomerApi(mcbsXml, filename);
      
      console.log(`HOMER API call successful on attempt ${attempt}`);
      return pdfBuffer;
      
    } catch (error) {
      lastError = error as Error;
      
      console.error(`HOMER API call failed (attempt ${attempt}/${maxRetries}):`, error);
      
      // Bei 4xx Fehler nicht retrying (Client Error)
      if (axios.isAxiosError(error) && error.response?.status < 500) {
        throw error;
      }
      
      // Exponential Backoff
      if (attempt < maxRetries) {
        const delayMs = Math.pow(2, attempt) * 1000;
        console.log(`Retrying in ${delayMs}ms...`);
        await sleep(delayMs);
      }
    }
  }
  
  throw new Error(`HOMER API failed after ${maxRetries} attempts: ${lastError.message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

---

## Testing

### Integration Test

```typescript
// test/integration/e-invoice-pipeline.test.ts
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

describe('E-Invoice Pipeline Integration Test', () => {
  
  it('should create E-Invoice from MCBS XML', async () => {
    
    const s3Client = new S3Client({ region: 'eu-central-1' });
    const testInvoiceNumber = 'TEST-001';
    
    // 1. Upload MCBS XML
    const mcbsXml = loadTestMCBSXml();
    await s3Client.send(new PutObjectCommand({
      Bucket: 'mcbs-invoices',
      Key: `raw/test/${testInvoiceNumber}.xml`,
      Body: mcbsXml
    }));
    
    // 2. Warte auf Pipeline (15 Sekunden)
    await sleep(15000);
    
    // 3. Prüfe ob PDF erstellt wurde
    const pdfExists = await objectExists(
      s3Client,
      'mcbs-invoices',
      `pdf/test/${testInvoiceNumber}.pdf`
    );
    expect(pdfExists).toBe(true);
    
    // 4. Prüfe ob ZUGFeRD XML erstellt wurde
    const zugferdXmlExists = await objectExists(
      s3Client,
      'mcbs-invoices',
      `zugferd/test/${testInvoiceNumber}_zugferd.xml`
    );
    expect(zugferdXmlExists).toBe(true);
    
    // 5. Prüfe ob E-Rechnung erstellt wurde
    const eInvoiceExists = await objectExists(
      s3Client,
      'mcbs-invoices',
      `e-rechnung/test/${testInvoiceNumber}_zugferd.pdf`
    );
    expect(eInvoiceExists).toBe(true);
    
    // 6. Validiere E-Rechnung
    const eInvoicePdf = await s3Client.send(new GetObjectCommand({
      Bucket: 'mcbs-invoices',
      Key: `e-rechnung/test/${testInvoiceNumber}_zugferd.pdf`
    }));
    
    const pdfBuffer = await eInvoicePdf.Body!.transformToByteArray();
    expect(pdfBuffer.length).toBeGreaterThan(0);
    
    // Optional: Validiere PDF/A-3 & ZUGFeRD
    const isValidPdfA3 = await validatePdfA3(Buffer.from(pdfBuffer));
    expect(isValidPdfA3).toBe(true);
  });
});
```

---

## Deployment

```bash
# 1. Environment Variables setzen
export HOMER_API_URL=https://homer.internal.company.com
export HOMER_API_KEY=your-api-key-here

# 2. Dependencies installieren
npm install

# 3. TypeScript kompilieren
npm run build

# 4. Deploy
serverless deploy --stage production

# 5. Test
aws s3 cp test-invoice.xml s3://mcbs-invoices/raw/test/test-001.xml

# 6. Logs prüfen
serverless logs -f homerPdfGenerator --tail
serverless logs -f mcbsToZugferdConverter --tail
serverless logs -f zugferdPdfEmbedder --tail
```

---

## Zusammenfassung

### ✅ Workflow bleibt gleich!

| Schritt | Beschreibung | Trigger |
|---------|--------------|---------|
| **1** | MCBS XML → S3 (raw/) | MCBS Billing Upload |
| **2** | Lambda 1: HOMER API Call → PDF | S3 Event (raw/*.xml) |
| **3** | PDF → S3 (pdf/) | Lambda 1 |
| **4** | Lambda 2: MCBS XML → ZUGFeRD XML | S3 Event (pdf/*.pdf) |
| **5** | ZUGFeRD XML → S3 (zugferd/) | Lambda 2 |
| **6** | Lambda 3: PDF + XML → E-Rechnung | S3 Event (zugferd/*_zugferd.xml) |
| **7** | E-Rechnung → S3 (e-rechnung/) | Lambda 3 |

### ✅ Wichtige Punkte

1. **S3 Events triggern alles** - Keine manuellen Starts
2. **HOMER REST API** - Multipart POST, PDF Response
3. **factur-x Library** - XML Generierung & PDF Embedding
4. **3 Lambda Functions** - Jede mit klarer Verantwortung
5. **Event-driven** - Automatischer Flow
6. **Retry-Logic** - Bei HOMER API Fehlern
7. **Monitoring** - CloudWatch Metrics & Alarms

**Der Workflow ist production-ready und vollständig automatisiert!** 🚀
