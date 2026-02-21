# MCBS ZUGFeRD Converter

AWS Lambda-basierter Service zur Konvertierung von MCBS XML Rechnungen zu ZUGFeRD 2.1.1 E-Rechnungen.

## 🏗️ Architektur

**Hybrid EventBridge + SQS für Multi-Source Support:**

```
MCBS (S3 XML) ──────┐
                     ├─→ EventBridge → SQS → Lambda (Batch 10) → ZUGFeRD E-Invoice
AWS Billing (DynamoDB) ─┘   (Routing)    (Batching)
```

**Features:**
- ✅ Multi-Source (MCBS Legacy + AWS Billing Service)
- ✅ 90% Kosten-Ersparnis durch Batching
- ✅ Adapter Pattern für Erweiterbarkeit
- ✅ ZUGFeRD 2.1.1 / XRechnung 3.0 Support
- ✅ PDF/A-3 Embedding

## 📦 Setup

### 1. Installation

```bash
npm install
```

### 2. Build

```bash
npm run build
```

### 3. Tests

```bash
# Unit Tests (lokal, ohne AWS)
npm test

# Watch Mode
npm run test:watch

# Coverage
npm run test:coverage
```

## 🧪 Lokale Entwicklung

### Unit Tests ohne AWS

Tests laufen **lokal** mit Test-Fixtures (keine S3 Buckets nötig):

```bash
npm test
```

**Test-Dateien:**
- `test/fixtures/mcbs-*.xml` - MCBS Test-XMLs
- `test/unit/*.test.ts` - Unit Tests

### Integration Tests mit AWS (später)

```bash
npm run test:integration
```

## 📁 Projekt-Struktur

```
mcbs-zugferd-converter/
├── src/
│   ├── types/
│   │   └── common-invoice.model.ts      # Source-agnostisches Invoice Model
│   ├── adapters/
│   │   ├── invoice-adapter.interface.ts # Adapter Interface
│   │   ├── mcbs-adapter.ts              # MCBS XML → Common Model
│   │   └── aws-billing-adapter.ts       # AWS Billing JSON → Common Model
│   ├── handlers/
│   │   └── unified-e-invoice.handler.ts # Lambda Handler (SQS)
│   ├── services/
│   │   ├── mcbs-parser.service.ts       # XML Parser
│   │   ├── zugferd-generator.service.ts # ZUGFeRD Generator
│   │   └── deduplication.service.ts     # Deduplication (DynamoDB)
│   └── utils/
│       ├── logger.ts
│       └── metrics.ts
├── test/
│   ├── unit/                            # Unit Tests (lokal)
│   ├── integration/                     # Integration Tests (AWS)
│   └── fixtures/                        # Test-Daten (MCBS XMLs)
├── events/                              # Event-Beispiele (SQS/S3)
├── serverless.yml                       # AWS Infrastruktur
├── package.json
├── tsconfig.json
└── jest.config.js
```

## 🚀 Deployment

### Development

```bash
npm run deploy:dev
```

### Production

```bash
npm run deploy:prod
```

## 📚 Dokumentation

- [Multi-Source Architecture](../MULTI_SOURCE_ARCHITECTURE_PART1.md)
- [EventBridge vs SQS](../EVENTBRIDGE_VS_SQS_BATCHING.md)
- [Ratenzahlungen](../ZUGFERD_INSTALLMENT_PAYMENTS.md)
- [Kosten-Analyse](../COST_ANALYSIS_DETAILED.md)

## 💰 Kosten (250k Rechnungen/Tag)

```
EventBridge: $7.50/Monat
SQS:         $3/Monat
Lambda:      $50/Monat (mit Batching!)
DynamoDB:    $9/Monat
S3:          $160/Monat
────────────────────────────────
TOTAL:       ~$230/Monat

Pro Rechnung: 0,003 Cent
```

## 📝 License

Proprietary - freenet DLS GmbH
