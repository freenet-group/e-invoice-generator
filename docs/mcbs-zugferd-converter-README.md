# MCBS ZUGFeRD Converter

AWS Lambda-basierter Service zur Konvertierung von MCBS XML Rechnungen zu ZUGFeRD E-Rechnungen.

## 🏗️ Architektur

```
S3 Bucket (MCBS XML)
  ↓ Event Notification
SQS Queue (Batching + Retry)
  ↓ Lambda Trigger
Lambda Function (10 Messages/Batch)
  ├─ Deduplication (DynamoDB)
  ├─ MCBS XML → ZUGFeRD XML
  └─ Embed in PDF (PDF/A-3)
  ↓
S3 Bucket (E-Invoices)
```

## 📦 Setup

### 1. Installation

```bash
npm install
```

### 2. AWS Credentials konfigurieren

```bash
aws configure
```

### 3. Deployment

```bash
# Development
npm run deploy:dev

# Staging
npm run deploy:staging

# Production
npm run deploy:prod
```

## 🚀 Usage

### Upload MCBS XML

```bash
# Upload MCBS XML zu S3
aws s3 cp invoice.xml s3://mcbs-invoices-dev/raw/2026/02/21/INV-2026-000001.xml

# Upload PDF (von HOMER)
aws s3 cp invoice.pdf s3://mcbs-invoices-dev/pdf/2026/02/21/INV-2026-000001.pdf
```

### Automatische Verarbeitung

1. S3 Event triggert SQS Queue
2. Lambda verarbeitet in Batches (10 Messages)
3. Deduplication Check (DynamoDB)
4. E-Rechnung wird erstellt und in S3 gespeichert

### E-Rechnung abrufen

```bash
aws s3 cp s3://mcbs-invoices-dev/e-invoices/2026/02/21/INV-2026-000001_zugferd.pdf ./
```

## 🔧 Konfiguration

### Environment Variables

- `DEDUP_TABLE_NAME`: DynamoDB Deduplication Table
- `BUCKET_NAME`: S3 Bucket Name
- `DLQ_QUEUE_URL`: Dead Letter Queue URL
- `STAGE`: Deployment Stage (dev/staging/production)

### Serverless.yml anpassen

Wichtige Anpassungen:

1. **Email für Alerts** (Zeile 291):
   ```yaml
   Endpoint: ops-team@example.com  # ← ANPASSEN!
   ```

2. **Reserved Concurrency** (Zeile 54):
   ```yaml
   reservedConcurrency: 100  # Anpassen je nach Bedarf
   ```

3. **Memory & Timeout** (Zeile 21-22):
   ```yaml
   memorySize: 2048  # 2 GB
   timeout: 60       # 60 Sekunden
   ```

## 📊 Monitoring

### CloudWatch Dashboards

Nach Deployment automatisch verfügbar:
- Lambda Metrics (Duration, Errors, Throttles)
- SQS Metrics (Queue Depth, Messages)
- Custom Metrics (Duplicates, Processing Time)

### Alarms

Automatische Alerts bei:
- Messages in Dead Letter Queue
- Lambda Error Rate > 10/5min
- SQS Queue Depth > 10.000
- Lambda Throttling

### Logs

```bash
# Tail Logs
npm run logs

# Oder direkt
serverless logs -f createEInvoice --tail --stage dev
```

## 🧪 Testing

### Unit Tests

```bash
npm test
```

### Integration Tests

```bash
npm run test:integration
```

### Local Testing

```bash
# Test Event erstellen
cat > events/test-event.json << 'EOF'
{
  "Records": [{
    "body": "{\"Records\":[{\"s3\":{\"bucket\":{\"name\":\"mcbs-invoices-dev\"},\"object\":{\"key\":\"raw/2026/02/21/INV-TEST-001.xml\"}}}]}"
  }]
}
EOF

# Lokal ausführen
npm run invoke:local
```

## 🛡️ Deduplication

Event-Duplikate werden automatisch erkannt und übersprungen:

- DynamoDB Table speichert verarbeitete S3 Keys
- TTL: 7 Tage (automatisches Cleanup)
- Kosten: ~$9/Monat bei 7.5M Rechnungen

## 🔄 Retry & DLQ

Bei Fehlern:
1. Lambda Error → Message zurück in Queue
2. Max 3 Versuche (RedrivePolicy)
3. Nach 3 Fehlern → Dead Letter Queue
4. CloudWatch Alarm → SNS → Ops Team

### DLQ verarbeiten

```bash
# Manuelle Verarbeitung der DLQ
serverless invoke -f processDLQ --stage dev
```

## 💰 Kosten (250.000 Rechnungen/Tag)

```
Lambda:      ~$1.245/Monat (87%)
S3:          ~$160/Monat   (11%)
DynamoDB:    ~$9/Monat     (1%)
SQS:         ~$3/Monat     (0.2%)
CloudWatch:  ~$14/Monat    (1%)
──────────────────────────────────
TOTAL:       ~$1.431/Monat

Pro Rechnung: 0,019 Cent
```

## 📁 Projekt-Struktur

```
mcbs-zugferd-converter/
├── src/
│   ├── handlers/
│   │   ├── mcbs-to-e-invoice.handler.ts
│   │   └── dlq-processor.handler.ts
│   ├── services/
│   │   ├── mcbs-parser.service.ts
│   │   ├── mcbs-to-einvoice-mapper.service.ts
│   │   ├── zugferd-generator.service.ts
│   │   └── deduplication.service.ts
│   ├── types/
│   │   └── mcbs-invoice.ts
│   └── utils/
│       ├── logger.ts
│       └── metrics.ts
├── test/
├── events/
├── serverless.yml
├── package.json
└── tsconfig.json
```

## 🚀 Deployment Workflow

### Development

```bash
# 1. Code ändern
# 2. Testen
npm test

# 3. Deploy
npm run deploy:dev

# 4. Logs prüfen
npm run logs
```

### Production

```bash
# 1. Merge to main
# 2. CI/CD Pipeline deployt automatisch
# 3. Smoke Tests
# 4. Monitoring
```

## 📚 Weitere Dokumentation

- [MCBS Mapping Guide](./MCBS_TO_EINVOICE_MAPPING_PART1.md)
- [Kostenanalyse](./COST_ANALYSIS_DETAILED.md)
- [Library Vergleich](./LIBRARY_COMPARISON_DETAILED.md)

## 🆘 Troubleshooting

### Lambda Timeout

```yaml
# serverless.yml
timeout: 90  # Erhöhen auf 90s
memorySize: 3008  # Mehr Memory
```

### DLQ Messages

```bash
# Messages in DLQ anschauen
aws sqs receive-message --queue-url <DLQ_URL> --max-number-of-messages 10
```

### Hohe Kosten

1. Lambda Duration optimieren (Code-Tuning)
2. S3 Lifecycle Policy aktivieren
3. CloudWatch Logs Retention reduzieren

## 📞 Support

Bei Fragen: ops-team@example.com
