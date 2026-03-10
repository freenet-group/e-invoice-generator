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
      ┌────────────────────────┐        ┌──────────────────────────────┐
      │ S3: e-invoices/        │        │ SNS: einvoice-created-{stage}│
      │ (ZUGFeRD PDF / XML)    │        │ → Consumer (SQS Subscription)│
      └────────────────────────┘        └──────────────────────────────┘
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
- **Input**: XML-Dateien in S3 unter dem Präfix `XML_PREFIX` (Standard: `raw/xml/`)
- **PDF**: Separate PDF-Datei im selben Bucket unter `PDF_PREFIX` (Standard: `raw/pdf/`)
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

Alle Artefakte liegen in einem gemeinsamen Bucket, getrennt durch Präfixe:

```
mcbs-invoices-{stage}/
├── raw/xml/                      ← Eingehende MCBS-XML-Dateien   (XML_PREFIX)
│   └── {invoiceNumber}.xml
├── raw/pdf/                      ← Eingehende Kunden-PDFs         (PDF_PREFIX)
│   └── {invoiceNumber}.pdf
└── e-invoices/                   ← Generierte E-Rechnungen        (OUTPUT_PREFIX)
    ├── {invoiceNumber}.pdf       ← ZUGFeRD PDF/A-3b
    └── {invoiceNumber}.xml       ← Reines XML (XRechnung)
```

**Lifecycle Rules** (in `serverless.yml`):

- `e-invoices/` → Glacier nach 30 Tagen
- `raw/` → Löschen nach 90 Tagen

### Umgebungsvariablen

Die Werte werden beim Deployment aus `serverless.yml` (`custom.prefixes`) als Umgebungsvariablen injiziert:

| Variable              | Beschreibung                            | Standard                |
| --------------------- | --------------------------------------- | ----------------------- |
| `BUCKET_NAME`         | S3 Bucket für alle Artefakte            | `mcbs-invoices-{stage}` |
| `XML_PREFIX`          | Präfix für eingehende MCBS-XML-Dateien  | `raw/xml/`              |
| `PDF_PREFIX`          | Präfix für eingehende Kunden-PDFs       | `raw/pdf/`              |
| `OUTPUT_PREFIX`       | Präfix für generierte E-Rechnungen      | `e-invoices/`           |
| `E_INVOICE_PROFILE`   | Factur-X / XRechnung Profil             | `factur-x-en16931`      |
| `ACTIVE_ADAPTER`      | EventBridge source des aktiven Adapters | `custom.mcbs`           |
| `AWS_ENDPOINT_URL`    | Nur lokal/LocalStack                    | `http://localhost:4566` |
| `E_INVOICE_TOPIC_ARN` | ARN des SNS Topics für Output-Events    | (aus Stack-Output)      |

> **Wichtig:** Die Präfixe werden beim Deployment eingefroren. Werden sie extern (durch das schreibende System oder per IaC) geändert, muss dieser Service **neu deployed** werden, damit EventBridge-Rule, Umgebungsvariablen und S3-Zugriffe konsistent bleiben.

---

## SSM Parameter

Bucket-Name und Präfixe werden in den AWS Systems Manager Parameter Store geschrieben, damit andere Services sie zur Laufzeit nachschlagen können, ohne direkte Abhängigkeiten auf diesen Stack.

| SSM-Pfad                                            | Inhalt                          | Beispielwert            |
| --------------------------------------------------- | ------------------------------- | ----------------------- |
| `/mcbs-invoices/{stage}/bucket`                     | S3 Bucket-Name                  | `mcbs-invoices-staging` |
| `/mcbs-invoices/{stage}/mcbs-invoice-xml-prefix`    | Präfix eingehender MCBS-XML     | `raw/xml/`              |
| `/mcbs-invoices/{stage}/mcbs-invoice-pdf-prefix`    | Präfix eingehender Kunden-PDFs  | `raw/pdf/`              |
| `/mcbs-invoices/{stage}/mcbs-invoice-output-prefix` | Präfix generierter E-Rechnungen | `e-invoices/`           |

### Wer legt die Parameter an?

| Stage                     | Bucket & SSM Parameter                                           | Verantwortung         |
| ------------------------- | ---------------------------------------------------------------- | --------------------- |
| `dev`, persönliche Stages | Werden **von diesem Stack** erstellt (`Condition: CreateBucket`) | Serverless Deploy     |
| `staging`, `production`   | Werden **extern** bereitgestellt, zusammen mit dem S3 Bucket     | IaC (Terraform / CDK) |

In `staging` und `production` setzt dieser Stack voraus, dass alle vier SSM Parameter unter den obigen Pfaden bereits vorhanden sind, bevor das erste Deployment erfolgt. Fehlen sie, schlägt die Lambda-Konfiguration nicht fehl (Werte kommen aus Env-Vars), aber andere Services finden die Parameter nicht.

---

## Output-Event: EInvoice Created (SNS)

Nach jeder erfolgreichen E-Rechnungs-Generierung publiziert der Service ein Event auf dem SNS Topic `e-invoice-generator-einvoice-created-{stage}`.

### Topic-ARN

Der ARN ist ein Stack-Output (`EInvoiceCreatedTopicARN`) und folgt diesem Schema:

```
arn:aws:sns:eu-central-1:{accountId}:e-invoice-generator-einvoice-created-{stage}
```

### Event-Struktur

```json
{
  "storage": {
    "bucketName": "mcbs-invoices-staging",
    "key": "e-invoices/INV-12345.pdf",
    "region": "eu-central-1"
  },
  "invoice": {
    "id": "INV-12345",
    "buyerName": "Mustermann GmbH",
    "sourceId": "C25002242080",
    "profile": "factur-x-en16931",
    "adapter": "custom.mcbs"
  },
  "metadata": {
    "stage": "staging",
    "correlationId": "a1b2c3d4-EventBridge-Event-Id",
    "generatedAt": "2026-03-09T10:00:00.000Z"
  }
}
```

### Felder im Detail

| Feld                     | Beschreibung                                                                                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage.key`            | Exakter S3-Key der generierten Datei – direkt für `s3.getObject()` nutzbar                                                                                 |
| `storage.bucketName`     | S3 Bucket-Name – stage-agnostisch, kein Hardcoding nötig                                                                                                   |
| `invoice.id`             | Rechnungsnummer                                                                                                                                            |
| `invoice.sourceId`       | Eindeutige ID im Quellsystem (z.B. Kundennummer)                                                                                                           |
| `invoice.profile`        | ZUGFeRD-Profil (`factur-x-en16931`, `factur-x-xrechnung`, ...)                                                                                             |
| `invoice.adapter`        | Quellsystem (`custom.mcbs`, `custom.billing`)                                                                                                              |
| `metadata.correlationId` | ID des ursprünglichen EventBridge-Events (S3 Object Created) – ermöglicht Distributed Tracing von S3-Upload bis SNS-Output. Fallback: neu generierte UUID. |

> **Tracing mit `correlationId`:**
> Die `correlationId` entspricht dem `id`-Feld des EventBridge-Events, das beim Hochladen des PDFs in S3 ausgelöst wurde.
> Damit lässt sich der vollständige Verarbeitungsweg einer einzelnen Rechnung nachvollziehen:
>
> ```
> S3 Upload → EventBridge Event (id: "abc-123")
>                  └── SQS Message
>                           └── Lambda Verarbeitung
>                                    └── SNS Event (correlationId: "abc-123")
> ```
>
> In CloudWatch Logs Insights über alle Stufen hinweg filterbar mit:
>
> ```
> fields @timestamp, @message
> | filter @message like "abc-123"
> ```

### MessageAttributes (SNS Filter-Policy)

Das Event enthält zwei `MessageAttributes` für SNS-seitige Filterung:

| Attribut    | Wert                     | Beispiel                         |
| ----------- | ------------------------ | -------------------------------- |
| `eventType` | Immer `EInvoice Created` | Für generellen Filter            |
| `adapter`   | Aktiver Adapter          | `custom.mcbs` / `custom.billing` |

### Consumer: SNS Subscription einrichten

**SQS-Subscription** (empfohlen – für automatisierte Verarbeitung):

```bash
# 1. SQS Queue abonnieren
aws sns subscribe \
  --topic-arn arn:aws:sns:eu-central-1:{accountId}:e-invoice-generator-einvoice-created-{stage} \
  --protocol sqs \
  --notification-endpoint arn:aws:sqs:eu-central-1:{accountId}:{your-queue-name} \
  --region eu-central-1

# 2. Optional: Nur auf einen bestimmten Adapter filtern
aws sns set-subscription-attributes \
  --subscription-arn {subscription-arn} \
  --attribute-name FilterPolicy \
  --attribute-value '{"adapter": ["custom.mcbs"]}'
```

**Datei abholen** (im Consumer-Code):

```typescript
// Die SNS-Nachricht enthält das JSON oben als `Message`-Feld
const snsMessage = JSON.parse(sqsRecord.body) // SQS-Wrapper
const event = JSON.parse(snsMessage.Message) // eigentlicher Payload

const file = await s3.send(
  new GetObjectCommand({
    Bucket: event.storage.bucketName,
    Key: event.storage.key
  })
)
```

> **Hinweis:** Für den SQS-Queue-Zugriff auf den S3-Bucket benötigt der Consumer `s3:GetObject` auf `mcbs-invoices-{stage}/e-invoices/*`.

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
https://console.aws.amazon.com/cloudwatch/home?region=eu-central-1#dashboards:name=e-invoice-generator-{stage}
```

### Fehlerbehandlung: DLQ → SNS → Operations

```
Lambda-Fehler
    └── 3× Retry (SQS VisibilityTimeout)
            └── Dead Letter Queue (DLQ)
                    └── DLQ Processor Lambda
                            └── SNS Alert Topic
                                    └── Operations (Email / PagerDuty / Slack)
```

Nach 3 fehlgeschlagenen Verarbeitungsversuchen landet eine Message in der DLQ. Der DLQ-Prozessor liest sie aus, loggt alle Details und publiziert eine Nachricht auf dem SNS Alert Topic.

### SNS Alert Topic abonnieren

Der Topic-ARN ist ein Stack Output (`AlertTopicARN`) und hat folgendes deterministisches Schema:

```
arn:aws:sns:eu-central-1:{accountId}:e-invoice-generator-alerts-{stage}
```

**Email-Subscription einrichten** (einmalig pro Stage):

```bash
aws sns subscribe \
  --topic-arn arn:aws:sns:eu-central-1:{accountId}:e-invoice-generator-alerts-{stage} \
  --protocol email \
  --notification-endpoint operations@freenet.ag \
  --region eu-central-1
```

AWS schickt eine Bestätigungs-E-Mail — der Link darin muss geklickt werden, bevor Alerts zugestellt werden.

Für weitergehende Automatisierung (PagerDuty, Jira-Tickets, Auto-Remediation) siehe [docs/OPERATIONS_RUNBOOK.md](docs/OPERATIONS_RUNBOOK.md).

**Alarms** bei:

- Messages in Dead Letter Queue (`maxReceiveCount: 3`)
- Lambda Error Rate >10/5min
- Queue Depth >10.000

---

## Dokumentation

| Dokument                                                                          | Beschreibung                                  |
| --------------------------------------------------------------------------------- | --------------------------------------------- |
| [OPERATIONS_RUNBOOK.md](docs/OPERATIONS_RUNBOOK.md)                               | Alerting, SNS-Subscriptions, Incident-Prozess |
| [EVENTBRIDGE_VS_SQS_BATCHING.md](docs/EVENTBRIDGE_VS_SQS_BATCHING.md)             | Batching-Strategie & Kostenvergleich          |
| [FACTURX_LIBRARY_DETAILED_BENEFITS.md](docs/FACTURX_LIBRARY_DETAILED_BENEFITS.md) | Warum `@e-invoice-eu/core`?                   |
| [MULTI_SOURCE_ARCHITECTURE_PART1.md](docs/MULTI_SOURCE_ARCHITECTURE_PART1.md)     | Adapter Pattern & Common Invoice Model        |
| [ZUGFERD_PDF_EMBEDDING.md](docs/ZUGFERD_PDF_EMBEDDING.md)                         | PDF/A-3b Embedding Details                    |
| [DEVELOPMENT.md](DEVELOPMENT.md)                                                  | Entwicklungssetup & Konventionen              |

---

## Technologie-Stack

| Kategorie   | Technologie                                   |
| ----------- | --------------------------------------------- |
| Runtime     | Node.js 22, TypeScript 5                      |
| IaC         | Serverless Framework v4                       |
| AWS         | Lambda, EventBridge, SQS, S3, SNS, CloudWatch |
| E-Invoice   | `@e-invoice-eu/core`                          |
| PDF         | `pdf-lib`                                     |
| XML Parsing | `fast-xml-parser` + Zod                       |
| Logging     | `pino`                                        |
| Testing     | Jest                                          |

---

## Support

- **Slack**: `#e-invoice-generator`
- **Email**: tp.sd.back.mcbs@freenet.ag
