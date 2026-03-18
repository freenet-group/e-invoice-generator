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
└──────┬───────────────────────┬───────────────┘
       │ Erfolg                │ FatalProcessingError
       ↓                       ↓ (kein Retry)
┌──────────────┐   ┌──────────────────────────────────┐
│ S3: e-inv/   │   │ Fatal DLQ (SQS)                  │
│ SNS output   │   │ mcbs-invoice-processing-fatal-dlq│
└──────────────┘   └──────────────┬───────────────────┘
                                  ↓
                   ┌──────────────────────────────────┐
                   │ Lambda: fatalDlqProcessor        │
                   │ (Structured Logging + SNS Alert) │
                   └──────────────┬───────────────────┘
                                  ↓
                   ┌──────────────────────────────────┐
                   │ SNS: alerts-{stage}              │
                   │ → Dev-Team (Email / Slack)       │
                   └──────────────────────────────────┘

Transiente Fehler (3× Retry):
  SQS Retry → DLQ → processDLQ Lambda → SNS (Ops-Team)
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
| `FATAL_DLQ_URL`       | SQS-URL der Fatal DLQ                   | (aus Stack-Output)      |
| `ALERT_TOPIC_ARN`     | ARN des SNS Alert-Topics (DLQ + Fatal)  | (aus Stack-Output)      |

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
  "eventDate": "2026-03-11T10:00:00.000Z",
  "correlationId": "a1b2c3d4-EventBridge-Event-Id",
  "billingDocumentType": "COMMERCIAL_INVOICE",
  "billingDocumentId": "M26008957394",
  "partyId": "C25002242080",
  "billingAccountId": "INV-DEF-0815",
  "billrunId": "BR-2026-03",
  "mandant": "01",
  "profile": "factur-x-en16931",
  "fileName": "M26008957394.pdf",
  "mediaType": "application/pdf",
  "s3URI": "s3://mcbs-invoices-staging/e-invoices/M26008957394.pdf"
}
```

### Felder im Detail

| Feld                  | Beschreibung                                                                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `eventDate`           | Zeitstempel der Verarbeitung (ISO 8601)                                                                                                                     |
| `correlationId`       | ID des ursprünglichen EventBridge-Events (S3 Object Created) – ermöglicht Distributed Tracing von S3-Upload bis SNS-Output                                  |
| `billingDocumentType` | `COMMERCIAL_INVOICE` oder `CREDIT_NOTE`                                                                                                                     |
| `billingDocumentId`   | Rechnungsnummer                                                                                                                                             |
| `partyId`             | Kundennummer / Partei-ID im Quellsystem (MCBS: `PERSON_NO`)                                                                                                 |
| `billingAccountId`    | Abrechnungskonto-ID (MCBS: `HEADER.INVOICE_DEF`)                                                                                                            |
| `billrunId`           | Abrechnungslauf-ID, falls vorhanden (MCBS: `HEADER.BILLRUN_ID`) – optional                                                                                  |
| `mandant`             | Mandant des Quellsystems, falls vorhanden (MCBS: `HEADER.MANDANT`) – optional                                                                               |
| `profile`             | ZUGFeRD-Profil (`factur-x-en16931`, `factur-x-xrechnung`, ...)                                                                                              |
| `fileName`            | Dateiname der generierten Datei – entspricht dem Namen des Quell-PDFs                                                                                       |
| `mediaType`           | `application/pdf` (ZUGFeRD mit eingebettetem XML) oder `application/xml` (reines XRechnung-XML)                                                             |
| `s3URI`               | Vollständiger S3-URI der generierten Datei (`s3://{bucket}/{key}`) – direkt für `s3.getObject()` nutzbar; der Dateiname entspricht dem Namen des Quell-PDFs |

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

Das Event enthält folgende `MessageAttributes` für SNS-seitige Filterung:

| Attribut              | Wert                                                                                                   | Beispiel                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| `eventType`           | Abhängig von `source`: `CustomerBill:DocumentCreated` oder `BusinessPartnerSettlement:DocumentCreated` | Für source-spezifischen Filter                |
| `context`             | Verarbeitungskontext, z. B. `e-invoice-added`                                                          | Für kontextbasierte Filter                    |
| `source`              | Quellsystem                                                                                            | `MCBS` / `AWS_BILLING` / `PARTNER_COMMISSION` |
| `billingDocumentType` | Dokumententyp                                                                                          | `COMMERCIAL_INVOICE` / `CREDIT_NOTE`          |
| `profile`             | ZUGFeRD-Profil                                                                                         | `factur-x-en16931` / `factur-x-xrechnung`     |
| `mediaType`           | MIME-Type der generierten Datei                                                                        | `application/pdf` / `application/xml`         |
| `billrunId`           | Abrechnungslauf-ID – nur vorhanden wenn in MCBS XML gesetzt                                            | `BR-2026-03`                                  |
| `mandant`             | Mandant – nur vorhanden wenn in MCBS XML gesetzt                                                       | `01`                                          |

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
  --attribute-value '{"source": ["MCBS"]}'
```

**Datei abholen** (im Consumer-Code):

```typescript
// Die SNS-Nachricht enthält das JSON oben als `Message`-Feld
const snsMessage = JSON.parse(sqsRecord.body) // SQS-Wrapper
const event = JSON.parse(snsMessage.Message) // eigentlicher Payload

// S3-URI parsen: s3://{bucket}/{key}
const s3URI = new URL(event.s3URI)
const bucket = s3URI.hostname
const key = s3URI.pathname.slice(1) // führenden / entfernen

const file = await s3.send(new GetObjectCommand({Bucket: bucket, Key: key}))
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

### CloudWatch Dashboard

Nach dem Deployment automatisch verfügbar unter:

```
https://console.aws.amazon.com/cloudwatch/home?region=eu-central-1#dashboards:name=e-invoice-generator-{stage}
```

Der Stack-Output `DashboardURL` enthält die direkte URL:

```bash
aws cloudformation describe-stacks \
  --stack-name e-invoice-generator-{stage} \
  --query "Stacks[0].Outputs[?OutputKey=='DashboardURL'].OutputValue" \
  --output text
```

#### Widgets

Das Dashboard besteht aus einem Alarm-Status-Banner oben und vier Zeilen à drei Metrik-Widgets (24 Spalten).

**Zeile 0 – Alarm Status (Überblick)**

| Widget           | Inhalt                                                | Zweck                                                                                     |
| ---------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Alarm Status** | `lambda-errors`, `dlq-messages`, `fatal-dlq-messages` | Sofortiger GREEN/RED-Überblick ohne Metrik-Interpretation — Einstiegspunkt für Operations |

> Das Alarm-Widget zeigt den aktuellen Zustand der drei CloudWatch Alarms. Ein roter Eintrag bedeutet aktiver Alarm — per Klick gelangt man direkt zum Alarm in CloudWatch. Die historische Alarm-Historie (ALARM → OK-Übergänge) ist im CW-Alarm-Detail einsehbar, auch wenn der aktuelle Zustand wieder grün ist.

**Zeile 1 – Lambda & SQS Durchsatz**

| Widget                          | Metriken                                 | Zweck                                            |
| ------------------------------- | ---------------------------------------- | ------------------------------------------------ |
| **Lambda Invocations & Errors** | `Invocations`, `Errors` (createEInvoice) | Durchsatz und Fehlerrate auf einen Blick         |
| **Lambda Duration**             | `Duration` p50 / p99 (createEInvoice)    | Latenzen und Ausreißer erkennen                  |
| **SQS Queue – Messages**        | `Sent`, `Deleted`, `Visible`             | Rückstau in der Processing Queue sichtbar machen |

**Zeile 2 – Transiente Fehler (DLQ)**

| Widget                                   | Metriken                             | Zweck                                                                                              |
| ---------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| **DLQ – Messages**                       | `Visible`, `Sent` (DLQ)              | `Visible`: aktuell in Queue; `Sent`: historische Gesamtzahl — Vorfälle auch nach Abholung sichtbar |
| **DLQ Processor – Invocations & Errors** | `Invocations`, `Errors` (processDLQ) | Verarbeitung transient fehlgeschlagener Messages                                                   |
| **Lambda Throttles**                     | `Throttles` (alle drei Funktionen)   | Concurrency-Engpässe bei createEInvoice, processDLQ, processFatalDLQ                               |

**Zeile 3 – Deterministische Fehler (Fatal DLQ)**

| Widget                                            | Metriken                                  | Zweck                                                                                       |
| ------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Fatal DLQ – Messages**                          | `Visible`, `Sent` (Fatal DLQ)             | Sollte dauerhaft 0 sein; roter Alarm-Threshold ab Wert 1; `Sent` zeigt historische Vorfälle |
| **Fatal DLQ Processor – Invocations & Errors**    | `Invocations`, `Errors` (processFatalDLQ) | Verarbeitung deterministisch fehlgeschlagener Messages                                      |
| **Fatal DLQ vs. DLQ – Fehler-Typen im Vergleich** | `Sent` beider DLQ-Queues                  | Zeigt auf einen Blick, ob transiente oder deterministische Fehler dominieren                |

> **Historische Sichtbarkeit**: Auch wenn der Alarm-Status bereits wieder grün ist (DLQ wurde geleert), bleibt der Vorfall in `NumberOfMessagesSent` als Spike sichtbar. Die vollständige Incident-Timeline ist außerdem in der CW-Alarm-Historie und den CloudWatch Logs der DLQ-Processor-Lambdas einsehbar.

**Zeile 4 – SNS Output**

| Widget                              | Metriken                                              | Zweck                                                                          |
| ----------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| **SNS Output – Published Messages** | `NumberOfMessagesSent`, `NumberOfNotificationsFailed` | Absoluter Output-Durchsatz; Failed sollte 0 sein                               |
| **SNS vs. Lambda – Verhältnis**     | Lambda `Invocations` vs. SNS `NumberOfMessagesSent`   | **Doppel-Publishing-Erkennung**: beide Linien sollten deckungsgleich verlaufen |

> Das SNS-Verhältnis-Widget ist besonders nützlich zur Diagnose von Doppel-Events aus EventBridge (zwei Rules → zwei SQS-Messages für ein PDF). Weichen die Linien dauerhaft auseinander, liegt ein strukturelles Problem in der EventBridge-Konfiguration vor.

### Fehlerbehandlung: Zwei Fehler-Pfade

Der Service unterscheidet zwei Kategorien von Fehlern, die unterschiedlich behandelt werden:

#### Pfad 1: Transiente Fehler → DLQ → Operations

```
Lambda-Fehler (z. B. S3 nicht erreichbar, temporärer Netzwerkfehler)
    └── 3× Retry (SQS VisibilityTimeout)
            └── Dead Letter Queue (DLQ)
                    └── processDLQ Lambda
                            └── SNS Alert Topic
                                    └── Operations (Email / PagerDuty / Slack)
```

Nach 3 fehlgeschlagenen Verarbeitungsversuchen landet eine Message in der DLQ. Der DLQ-Prozessor liest sie aus, loggt alle Details und publiziert eine Nachricht auf dem SNS Alert Topic. Diese Fehler werden in der Regel durch temporäre Infrastrukturprobleme verursacht und können oft durch erneutes Einliefern der Message behoben werden.

#### Pfad 2: Deterministische Fehler → Fatal DLQ → Dev-Team

```
FatalProcessingError (deterministische Fehler in den Eingabedaten)
    └── sofort → Fatal DLQ (kein SQS-Retry)
                    └── fatalDlqProcessor Lambda
                            └── SNS Alert Topic
                                    └── Dev-Team (strukturiertes Logging + Alert)
```

**Wann wird ein Fehler als fatal eingestuft?**

Ein `FatalProcessingError` wird ausgelöst, wenn der Fehler deterministisch ist – ein erneuter Versuch mit denselben Eingabedaten würde immer wieder scheitern:

| Fehlerquelle                | Beispiel                                                        |
| --------------------------- | --------------------------------------------------------------- |
| Ungültige MCBS-XML-Struktur | Pflichtfeld fehlt, ungültiger `PAYMENT_TYPE`, Schema-Verletzung |
| Geschäftslogik-Fehler       | Widersprüchliche Rechnungsdaten, die EN-16931-Regeln verletzen  |
| Bibliotheksfehler           | `@e-invoice-eu/core` lehnt das gemappte UBL-Objekt ab           |

**Unterschied zur normalen DLQ:**

- **DLQ**: SQS wartet 3 Versuche ab, bevor die Message weitergeleitet wird → für transiente Fehler
- **Fatal DLQ**: `batchItemFailures` enthält die Message **nicht** → SQS behandelt sie als erfolgreich verarbeitet und sendet **keinen Retry** → für deterministische Fehler

**Was muss das Dev-Team tun?**

Fatal-DLQ-Nachrichten bedeuten immer, dass die **Quelldaten korrigiert** oder der **Service-Code angepasst** werden muss. Die SNS-Alert-Nachricht enthält:

```json
{
  "type": "FatalProcessingError",
  "messageId": "<SQS Message ID der Fatal DLQ>",
  "originalMessageId": "<SQS Message ID der ursprünglichen Queue>",
  "errorSource": "raw/xml/INV-001.xml",
  "errorMessage": "[raw/xml/INV-001.xml] Invalid MCBS XML structure: INVOICE_DATA.PAYMENT_MODE.PAYMENT_TYPE: Invalid option",
  "failedAt": "2026-03-12T10:00:00.000Z",
  "sentAt": "2026-03-12T10:00:01.000Z"
}
```

Mit `errorSource` lässt sich die betroffene Quelldatei direkt in S3 identifizieren:

```bash
# Betroffene XML-Datei aus S3 laden
aws s3 cp s3://mcbs-invoices-{stage}/{errorSource} /tmp/failed-invoice.xml
```

### Alert Management: CloudWatch Alarms → SNS → AWS Chatbot → Slack

Der Service verwendet **CloudWatch Alarms** als primären Alert-Mechanismus. Alarms aggregieren Metriken und senden bei Schwellwert-Überschreitung **eine** Nachricht auf das SNS Alert Topic — kein Alert-Storm bei vielen gleichzeitigen Fehlern.

#### Definierte Alarms (automatisch vom Stack angelegt)

| Alarm                                            | Trigger                                            | Bedeutung                                                                       |
| ------------------------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------- |
| `e-invoice-generator-dlq-messages-{stage}`       | DLQ `ApproximateNumberOfMessagesVisible` > 0       | Nachrichten nach 3× Retry nicht verarbeitbar — transientes Infrastrukturproblem |
| `e-invoice-generator-fatal-dlq-messages-{stage}` | Fatal DLQ `ApproximateNumberOfMessagesVisible` > 0 | Deterministischer Fehler — Dev-Eingriff erforderlich                            |
| `e-invoice-generator-lambda-errors-{stage}`      | Lambda `Errors` > 0 / Minute                       | Unerwarteter Lambda-Fehler (Timeout, OOM, unhandled exception)                  |

Alle Alarms senden auch eine `OK`-Nachricht, wenn der Zustand sich wieder normalisiert hat (z. B. DLQ leer nach manuellem Replay).

#### SNS Alert Topic

Der Topic-ARN ist ein Stack Output (`AlertTopicARN`):

```
arn:aws:sns:eu-central-1:{accountId}:e-invoice-generator-alerts-{stage}
```

#### Operations Setup: AWS Chatbot → Slack (empfohlen)

AWS Chatbot leitet SNS-Nachrichten formatiert in Slack weiter — kein eigener Code, keine Lambda, reine AWS-Konfiguration.

**Einmalig pro AWS-Account (in der AWS Console):**

1. **AWS Chatbot öffnen**: `https://console.aws.amazon.com/chatbot`
2. **Slack Workspace verbinden**: „Configure new client" → Slack → Workspace autorisieren
3. **Neuen Channel konfigurieren**:
   - Channel: `#e-invoice-alerts-prod` (bzw. `-staging`)
   - SNS Topic: `e-invoice-generator-alerts-{stage}` auswählen
   - IAM Role: AWS Chatbot legt automatisch eine an
4. **Fertig** — ab jetzt landen CW-Alarm-Nachrichten im Slack-Channel

**Was Operations in Slack sieht:**

```
🚨 ALARM: e-invoice-generator-fatal-dlq-messages-prod

State:      ALARM (war: OK)
Reason:     Threshold crossed: 1 datapoint [1.0] > 0.0
Queue:      mcbs-invoice-processing-fatal-dlq-prod
Time:       2026-03-18T09:15:00Z

[View Alarm in CloudWatch]  [View Queue in SQS Console]
```

```
✅ OK: e-invoice-generator-dlq-messages-prod

State:      OK (war: ALARM)
Reason:     Threshold crossed: 1 datapoint [0.0] <= 0.0
Time:       2026-03-18T11:30:00Z
```

#### Was Operations bei einem ALARM tun muss

**DLQ Alarm** (`dlq-messages`):

```bash
# 1. Wie viele Messages sind in der DLQ?
aws sqs get-queue-attributes \
  --queue-url https://sqs.eu-central-1.amazonaws.com/{accountId}/mcbs-invoice-processing-dlq-{stage} \
  --attribute-names ApproximateNumberOfMessages

# 2. CloudWatch Logs des DLQ Processors prüfen (enthält body, receiveCount, sentAt)
# Log Group: /aws/lambda/e-invoice-generator-{stage}-processDLQ

# 3. Wenn das Problem behoben ist: Messages zurück in die Processing Queue
aws sqs start-message-move-task \
  --source-arn arn:aws:sqs:eu-central-1:{accountId}:mcbs-invoice-processing-dlq-{stage} \
  --destination-arn arn:aws:sqs:eu-central-1:{accountId}:mcbs-invoice-processing-{stage}
```

**Fatal DLQ Alarm** (`fatal-dlq-messages`) → **Dev-Team benachrichtigen**:

```bash
# CloudWatch Logs des Fatal DLQ Processors prüfen – enthält errorSource und errorMessage
# Log Group: /aws/lambda/e-invoice-generator-{stage}-processFatalDLQ

# Betroffene XML-Datei aus S3 laden (errorSource aus dem Log)
aws s3 cp s3://mcbs-invoices-{stage}/{errorSource} /tmp/failed-invoice.xml
```

Fatal-DLQ-Nachrichten erfordern immer eine Code- oder Datenkorrektur — sie können **nicht** durch Message-Replay behoben werden.

**Lambda Errors Alarm** (`lambda-errors`):

```bash
# Fehler-Details in CloudWatch Logs Insights
# Log Group: /aws/lambda/e-invoice-generator-{stage}-createEInvoice
# Query:
fields @timestamp, @message
| filter @message like "ERROR"
| sort @timestamp desc
| limit 20
```

Typische Ursachen: S3-Throttling, temporäre Netzwerkfehler, Memory-Overflow. In den meisten Fällen löst sich der Alarm von selbst (SQS Retry), wenn der Alarm sich nicht in OK zurückversetzt, ist Dev-Eingriff nötig.

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
