# E-Invoice Generator

AWS Lambda-basierter Service zur Generierung von ZUGFeRD/Factur-X-konformen E-Rechnungen mit PDF-Embedding.

## Überblick

Der E-Invoice Generator konvertiert Rechnungsdaten aus verschiedenen Quellsystemen in standardisierte elektronische Rechnungen (ZUGFeRD 2.1.1 / Factur-X) gemäß **EN 16931**.

### Kernfunktionen

- **Multi-Source Support**: MCBS Legacy (XML) via Adapter Pattern – erweiterbar für weitere Quellsysteme
- **Event-Driven Architecture**: EventBridge → SQS Batching → Lambda
- **ZUGFeRD 2.1.1 / Factur-X**: Generierung via `@e-invoice-eu/core`
- **PDF/A-3b Embedding**: Automatisches Einbetten der XML-Rechnung in bestehende PDFs
- **Cost-Optimized**: 90% Lambda-Kosteneinsparung durch SQS Batching
- **Production-Ready**: DLQ, Auto-Retry, CloudWatch Monitoring

---

## Architektur

```
┌──────────────────────────────────────────────┐
│ Source Systems                               │
│   MCBS Legacy (S3 XML)   [weitere, geplant] │
└──────────────────┬───────────────────────────┘
                   ↓ S3 Event
      ┌────────────────────────┐
      │ EventBridge            │
      │ (Pattern Matching)     │
      └────────────┬───────────┘
                   ↓
      ┌────────────────────────┐
      │ SQS Queue              │
      │ BatchSize 10, DLQ      │
      └────────────┬───────────┘
                   ↓
┌──────────────────────────────────────────────┐
│ Lambda: unified-e-invoice.handler            │
│                                              │
│  AdapterRegistry                             │
│       ↓                                      │
│  MCBSAdapter                                 │
│       ↓                                      │
│  CommonInvoice (EN 16931)                    │
│       ↓                                      │
│  EInvoiceGeneratorService                    │
│  (@e-invoice-eu/core → ZUGFeRD XML / PDF)    │
└──────────────────┬───────────────────────────┘
                   ↓
      ┌────────────────────────┐
      │ S3: e-invoices/        │
      └────────────────────────┘
```

---

## Projektstruktur

```
src/
├── adapters/
│   ├── adapterRegistry.ts          # Adapter-Registrierung per EventBridge source
│   ├── invoiceAdapter..ts          # InvoiceAdapter Interface + RawInvoiceData
│   └── mcbs/
│       ├── mcbsInvoiceAdapter.ts   # MCBS Adapter (S3 XML → CommonInvoice)
│       ├── mcbsInvoiceMapper.ts    # XML-Parsing + Mapping
│       └── zod/                   # Zod-Schemas für MCBS XML
├── config/
│   └── eInvoiceProfileConfiguration.ts  # InvoiceFormat Typ + Validierung aus ENV
├── core/
│   ├── logger.ts
│   └── s3/
│       ├── s3Client.ts             # Zentraler S3Client (stage-aware via ENV)
│       ├── s3PdfLoader.ts          # PDF aus S3 laden
│       ├── s3Uploader.ts           # Generisches S3 Upload
│       └── s3XmlLoader.ts          # XML aus S3 oder lokalem Dateisystem laden
├── handlers/
│   └── unified-e-invoice.handler.ts  # Lambda-Einstiegspunkt (SQS Batch)
├── mappers/
│   └── eInvoiceMapper.ts           # CommonInvoice → @e-invoice-eu/core UBL
├── models/
│   └── commonInvoice.ts            # CommonInvoice (EN 16931 basiert)
├── services/
│   ├── eInvoiceGeneratorService.ts # generateEInvoice() – Library-Aufruf
│   └── eInvoiceProcessingService.ts # Batch-Orchestrierung
└── utils/
    └── logger.ts

scripts/
├── convert-mcbs-invoice.ts         # Lokale Konvertierung + KOSIT-Validierung
├── generate-zugferd-sample-pdf.ts  # Beispiel-PDF generieren
└── validate-zugferd-xml.ts         # XML lokal validieren

test/
├── unit/
└── integration/
```

---

## Adapter Pattern

Jedes Quellsystem implementiert das `InvoiceAdapter` Interface:

```typescript
interface InvoiceAdapter {
  loadInvoiceData(eventPayload: Record<string, unknown>): Promise<RawInvoiceData>
  mapToCommonModel(rawData: RawInvoiceData): CommonInvoice
  loadPDF(invoice: CommonInvoice): Promise<Buffer | null>
}
```

### MCBS Adapter (implementiert)

- **Trigger**: S3 Object Created → EventBridge (`source: custom.mcbs`)
- **Input**: XML-Dateien in S3 (`raw/*.xml`)
- **PDF**: Separate PDF-Datei im selben Bucket (`raw/*.pdf`)
- **Mapping**: MCBS XML → `CommonInvoice` via Zod-Schema-Validierung

### Weiterer Adapter (geplant)

Neue Quellsysteme können durch Implementierung von `InvoiceAdapter` und Registrierung in der `AdapterRegistry` hinzugefügt werden, ohne bestehenden Code zu ändern.

---

## E-Invoice Formate

Konfigurierbar über `E_INVOICE_PROFILE` (Umgebungsvariable):

| Profil               | Format                 | Verwendung         |
| -------------------- | ---------------------- | ------------------ |
| `factur-x-minimum`   | XML eingebettet in PDF | Minimalprofil      |
| `factur-x-basic-wl`  | XML eingebettet in PDF | Basis ohne Zeilen  |
| `factur-x-basic`     | XML eingebettet in PDF | Basis              |
| `factur-x-en16931`   | XML eingebettet in PDF | **Standard (B2B)** |
| `factur-x-xrechnung` | Reines XML             | B2G (Behörden)     |

> Bei `factur-x-xrechnung` wird **kein PDF eingebettet** – XRechnung ist bewusst rein maschinenlesbar.

---

## `@e-invoice-eu/core` Integration

Die Library übernimmt das komplexe UBL/CII XML-Templating inklusive Namespace-Verwaltung, PDF/A-3b Metadata und Validierung gemäß EN 16931 Business Rules.

**Mapping-Schicht** (`src/mappers/eInvoiceMapper.ts`):

```typescript
// CommonInvoice → @e-invoice-eu/core UBL-Objekt
export function mapToEInvoice(ci: CommonInvoice): Invoice { ... }
```

**Generator-Service** (`src/services/eInvoiceGeneratorService.ts`):

```typescript
export async function generateEInvoice(
  commonInvoice: CommonInvoice,
  options?: EInvoiceGeneratorOptions
): Promise<string | Uint8Array>
// → string: reines XML (XRechnung)
// → Uint8Array: PDF/A-3b mit eingebettetem XML
```

---

## S3 Bucket Struktur

In der Standardkonfiguration liegt alles in einem Bucket, getrennt durch Präfixe:

```
mcbs-invoices-{stage}/
├── raw/                          ← Eingehende MCBS-Dateien
│   ├── invoice.xml               ← Trigger für EventBridge
│   └── invoice.pdf               ← Original-PDF
└── e-invoices/                   ← Generierte E-Rechnungen
    ├── {invoiceNumber}.pdf       ← ZUGFeRD PDF/A-3b
    └── {invoiceNumber}.xml       ← Reines XML (XRechnung)
```

**Lifecycle Rules** (in `serverless.yml`):

- `e-invoices/` → Glacier nach 30 Tagen
- `raw/` → Löschen nach 90 Tagen

### Umgebungsvariablen

| Variable             | Beschreibung                            | Beispiel                |
| -------------------- | --------------------------------------- | ----------------------- |
| `PDF_BUCKET_NAME`    | Bucket mit eingehenden PDFs             | `mcbs-invoices-dev`     |
| `OUTPUT_BUCKET_NAME` | Bucket für generierte E-Rechnungen      | `mcbs-invoices-dev`     |
| `E_INVOICE_PROFILE`  | Factur-X / XRechnung Profil             | `factur-x-en16931`      |
| `ACTIVE_ADAPTER`     | EventBridge source des aktiven Adapters | `custom.mcbs`           |
| `AWS_ENDPOINT_URL`   | Nur lokal/LocalStack                    | `http://localhost:4566` |

---

## Kosten-Optimierung (SQS Batching)

```
Ohne Batching: 10.000 Events → 10.000 Lambda Invocations
Mit Batching:  10.000 Events → 1.000 Lambda Invocations (BatchSize 10)
Einsparung: 90%
```

```yaml
# serverless.yml
- sqs:
    arn: !GetAtt InvoiceProcessingQueue.Arn
    batchSize: 10
    maximumBatchingWindowInSeconds: 5
    functionResponseType: ReportBatchItemFailures
```

---

## Quick Start

### Voraussetzungen

```bash
node --version  # v22
java --version  # 11+ (für KOSIT Validator)
```

### Setup

```bash
npm install
npm run setup:validator   # KOSIT Validator herunterladen (einmalig)
```

Der Validator wird unter `tools/validator/` abgelegt. Beim erneuten Aufruf wird geprüft ob die Version bereits aktuell ist — ist sie es, überspringt das Script den Download.

Die Versionen sind zentral in `package.json` unter `validatorConfig` steuerbar:

```json
"validatorConfig": {
  "validatorVersion": "1.6.0",
  "scenarioVersion": "2026-01-31"
}
```

### Lokale Konvertierung (ohne AWS)

```bash
npx ts-node scripts/convert-mcbs-invoice.ts \
  --xml test/resources/mcbs/mcbs-real-invoice.xml \
  --pdf test/resources/mcbs/mcbs-real-invoice.pdf \
  --output /tmp/result.pdf | npx pino-pretty
```

### Deployment

```bash
npm run deploy:dev        # Development
npm run deploy:staging    # Staging
npm run deploy:prod       # Production
```

### Tests

```bash
npm test                  # Unit Tests
npm run test:coverage     # Coverage Report
npm run test:integration  # Integration Tests
npm run test:e2e          # E2E (gegen deployed Stack)
```

**Aktuelle Coverage**: >80% (Ziel)

---

## Monitoring

**CloudWatch Dashboard** nach Deployment:

```
https://console.aws.amazon.com/cloudwatch/home#dashboards:name=e-invoice-processing-{stage}
```

**Alarms** bei:

- Messages in Dead Letter Queue (`maxReceiveCount: 3`)
- Lambda Error Rate >10/5min
- Queue Depth >10.000

---

## Dokumentation

| Dokument                                                                          | Beschreibung                           |
| --------------------------------------------------------------------------------- | -------------------------------------- |
| [EVENTBRIDGE_VS_SQS_BATCHING.md](docs/EVENTBRIDGE_VS_SQS_BATCHING.md)             | Batching-Strategie & Kostenvergleich   |
| [FACTURX_LIBRARY_DETAILED_BENEFITS.md](docs/FACTURX_LIBRARY_DETAILED_BENEFITS.md) | Warum `@e-invoice-eu/core`?            |
| [MULTI_SOURCE_ARCHITECTURE_PART1.md](docs/MULTI_SOURCE_ARCHITECTURE_PART1.md)     | Adapter Pattern & Common Invoice Model |
| [ZUGFERD_PDF_EMBEDDING.md](docs/ZUGFERD_PDF_EMBEDDING.md)                         | PDF/A-3b Embedding Details             |
| [DEVELOPMENT.md](DEVELOPMENT.md)                                                  | Entwicklungssetup & Konventionen       |

---

## Technologie-Stack

| Kategorie   | Technologie                              |
| ----------- | ---------------------------------------- |
| Runtime     | Node.js 22, TypeScript 5                 |
| IaC         | Serverless Framework v4                  |
| AWS         | Lambda, EventBridge, SQS, S3, CloudWatch |
| E-Invoice   | `@e-invoice-eu/core`                     |
| PDF         | `pdf-lib`                                |
| XML Parsing | `fast-xml-parser` + Zod                  |
| Logging     | `pino`                                   |
| Testing     | Jest                                     |

---

## Support

- **Slack**: `#e-invoice-generator`
- **Email**: tp.sd.back.mcbs@freenet.ag
