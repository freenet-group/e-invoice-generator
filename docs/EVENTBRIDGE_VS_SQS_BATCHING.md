# EventBridge vs. SQS: Detaillierter Vergleich & Batching

## 🎯 Was ist der Unterschied?

### AWS EventBridge

**Was ist es?**

- **Event Bus** - Zentrale Event-Routing-Plattform
- **Event-Driven Architecture** Backbone
- Pattern-basiertes Routing von Events

**Konzept:**

```
Event Producer → EventBridge Bus → (Pattern Matching) → Multiple Targets
```

**Beispiel:**

```json
{
  "source": "aws.s3",
  "detail-type": "Object Created",
  "detail": {
    "bucket": {"name": "mcbs-invoices"},
    "object": {"key": "raw/invoice.xml"}
  }
}
```

EventBridge routet basierend auf **Patterns**:

```json
{
  "source": ["aws.s3"],
  "detail-type": ["Object Created"],
  "detail": {
    "bucket": {
      "name": ["mcbs-invoices"]
    }
  }
}
```

---

### AWS SQS (Simple Queue Service)

**Was ist es?**

- **Message Queue** - FIFO oder Standard Queue
- **Point-to-Point** Messaging
- Messages werden gequeued und von Consumer abgeholt

**Konzept:**

```
Producer → SQS Queue → Consumer (Batch von Messages)
```

**Beispiel:**

```
Queue: invoice-processing
Messages: [
  { "s3Key": "raw/invoice-001.xml" },
  { "s3Key": "raw/invoice-002.xml" },
  { "s3Key": "raw/invoice-003.xml" },
  ...
]

Lambda holt: 10 Messages auf einmal (Batch)
```

---

## 📊 Vergleich: EventBridge vs. SQS

| Feature              | EventBridge         | SQS                                |
| -------------------- | ------------------- | ---------------------------------- |
| **Typ**              | Event Bus (Pub/Sub) | Message Queue (Point-to-Point)     |
| **Routing**          | Pattern Matching ✅ | Keine (direct)                     |
| **Multiple Targets** | JA ✅ (Fan-Out)     | NEIN (1 Consumer)                  |
| **Batching**         | NEIN ❌             | **JA ✅ (native)**                 |
| **Retry**            | 24h, 185x           | Configurable (MaxReceiveCount)     |
| **DLQ**              | JA                  | JA ✅                              |
| **Latenz**           | ~50-200ms           | ~100-500ms                         |
| **Kosten**           | $1/Million Events   | $0.40/Million (nach Free Tier)     |
| **Ordering**         | Nicht garantiert    | FIFO: Garantiert ✅                |
| **Message Size**     | 256 KB              | 256 KB (Standard), 2 GB (Extended) |

---

## 🔄 Batching: SQS Native Support

### Was ist Batching?

**Problem ohne Batching:**

```
1 S3 Event → 1 Lambda Invocation
10.000 Events → 10.000 Lambda Invocations

Kosten:
  Lambda Requests: 10.000 × $0.0000002 = $0.002
  Lambda Duration: 10.000 × 2s × 2 GB × $0.0000166667 = $0.67
```

**Lösung mit Batching:**

```
10 S3 Events → 1 SQS Batch → 1 Lambda Invocation
10.000 Events → 1.000 Lambda Invocations (Batch Size 10)

Kosten:
  Lambda Requests: 1.000 × $0.0000002 = $0.0002 (-90%!)
  Lambda Duration: 1.000 × 2s × 2 GB × $0.0000166667 = $0.067 (-90%!)
```

**Einsparung: ~90% Lambda Kosten!** ✅

---

## 💻 Wie funktioniert SQS Batching?

### 1. S3 Event → SQS

```yaml
# S3 Bucket Notification
S3EventNotification:
  QueueConfigurations:
    - Event: s3:ObjectCreated:*
      Queue: !GetAtt InvoiceProcessingQueue.Arn
      Filter:
        S3Key:
          Rules:
            - Name: suffix
              Value: .xml
```

**Was passiert:**

```
S3 Upload: invoice-001.xml → SQS Message 1
S3 Upload: invoice-002.xml → SQS Message 2
S3 Upload: invoice-003.xml → SQS Message 3
...
S3 Upload: invoice-010.xml → SQS Message 10

SQS Queue enthält: 10 Messages (einzeln!)
```

### 2. Lambda Poll mit Batch Size

```yaml
# Lambda Event Source Mapping
functions:
  createEInvoice:
    handler: src/handlers/handler.ts
    events:
      - sqs:
          arn: !GetAtt InvoiceProcessingQueue.Arn
          batchSize: 10 # ← Batch Size!
          maximumBatchingWindowInSeconds: 5 # ← Wait Time
```

**Was passiert:**

```
Lambda Service:
  1. Pollt SQS Queue
  2. Sammelt bis zu 10 Messages
  3. Wartet max 5 Sekunden
  4. Ruft Lambda auf mit Batch

Lambda erhält: SQSEvent mit 10 Records
```

### 3. Lambda Handler verarbeitet Batch

```typescript
import {SQSEvent, SQSRecord} from 'aws-lambda'

export const handler = async (event: SQSEvent) => {
  console.log(`Processing batch of ${event.Records.length} messages`)

  // event.Records = Array of 10 Messages
  const results = []

  for (const record of event.Records) {
    try {
      // Parse S3 Event from SQS Message
      const s3Event = JSON.parse(record.body)
      const s3Record = s3Event.Records[0]

      const bucket = s3Record.s3.bucket.name
      const key = decodeURIComponent(s3Record.s3.object.key)

      console.log(`Processing: s3://${bucket}/${key}`)

      // Process invoice
      await processInvoice(bucket, key)

      results.push({status: 'success', key})
    } catch (error) {
      console.error(`Failed to process ${record.messageId}:`, error)

      // Partial Batch Failure!
      results.push({
        status: 'failed',
        messageId: record.messageId
      })
    }
  }

  // Report failed items back to SQS
  const failures = results.filter((r) => r.status === 'failed').map((r) => ({itemIdentifier: r.messageId}))

  return {
    batchItemFailures: failures // ← SQS retries only these!
  }
}
```

**Lambda erhält:**

```json
{
  "Records": [
    {
      "messageId": "msg-001",
      "body": "{\"Records\":[{\"s3\":{\"bucket\":{\"name\":\"mcbs-invoices\"},\"object\":{\"key\":\"raw/invoice-001.xml\"}}}]}"
    },
    {
      "messageId": "msg-002",
      "body": "{\"Records\":[{\"s3\":{\"bucket\":{\"name\":\"mcbs-invoices\"},\"object\":{\"key\":\"raw/invoice-002.xml\"}}}]}"
    },
    ...
    {
      "messageId": "msg-010",
      "body": "{\"Records\":[{\"s3\":{\"bucket\":{\"name\":\"mcbs-invoices\"},\"object\":{\"key\":\"raw/invoice-010.xml\"}}}]}"
    }
  ]
}
```

---

## 📈 Batching-Strategie: Konfiguration

### Batch Size

```yaml
batchSize: 10 # Anzahl Messages pro Lambda Invocation
```

**Optionen:**

- **Min:** 1 (kein Batching)
- **Max:** 10.000 (Standard Queue)
- **Max:** 10 (FIFO Queue)

**Empfehlung für E-Invoices:** 10-100

**Trade-offs:**

| Batch Size | Vorteile         | Nachteile                     |
| ---------- | ---------------- | ----------------------------- |
| **1**      | Niedrige Latenz  | Hohe Lambda Costs ❌          |
| **10**     | ✅ **Balance**   | -                             |
| **100**    | Niedrigste Costs | Höhere Latenz, Timeout-Risiko |
| **1000**   | Minimale Costs   | Sehr hohes Timeout-Risiko ❌  |

---

### Maximum Batching Window

```yaml
maximumBatchingWindowInSeconds: 5 # Wait Time
```

**Was passiert:**

```
Zeit 0s:  SQS hat 3 Messages → Warte
Zeit 1s:  SQS hat 5 Messages → Warte
Zeit 3s:  SQS hat 8 Messages → Warte
Zeit 5s:  ⏰ Timeout! → Lambda aufrufen mit 8 Messages
```

**Oder:**

```
Zeit 0s:  SQS hat 3 Messages → Warte
Zeit 0.5s: SQS hat 10 Messages → ✅ Batch voll! → Lambda sofort aufrufen
```

**Empfehlung:**

- **Low Latency:** 0-1 Sekunden
- **Cost Optimized:** 5-10 Sekunden
- **Balance:** 2-5 Sekunden ✅

---

## 🔄 Batching Workflow (Visuell)

### Ohne Batching (EventBridge direkt)

```
S3 Upload #1 → EventBridge → Lambda #1 (2s)
S3 Upload #2 → EventBridge → Lambda #2 (2s)
S3 Upload #3 → EventBridge → Lambda #3 (2s)
...
S3 Upload #10 → EventBridge → Lambda #10 (2s)

Total: 10 Lambda Invocations × 2s = 20 GB-Sekunden
Kosten: 20 × $0.0000166667 = $0.00033
```

---

### Mit Batching (S3 → SQS → Lambda)

```
S3 Upload #1 → SQS Message #1 ┐
S3 Upload #2 → SQS Message #2 │
S3 Upload #3 → SQS Message #3 │
S3 Upload #4 → SQS Message #4 ├─→ SQS Queue sammelt
S3 Upload #5 → SQS Message #5 │
...                            │
S3 Upload #10 → SQS Message #10┘

↓ (nach 5s oder 10 Messages erreicht)

Lambda Poll → Batch von 10 Messages → 1 Lambda Invocation (2s)

Total: 1 Lambda Invocation × 2s = 2 GB-Sekunden
Kosten: 2 × $0.0000166667 = $0.000033

Einsparung: 90%! ✅
```

---

## 💰 Kosten-Vergleich: EventBridge vs. SQS (250k Rechnungen/Tag)

### Variante 1: EventBridge (ohne Batching)

```
Events: 250k/Tag × 30 Tage = 7.5M/Monat

EventBridge:
  Kosten: 7.5M × $0.000001 = $7.50/Monat

Lambda (NO Batching):
  Invocations: 7.5M
  Duration: 7.5M × 2s × 2 GB = 30M GB-Sekunden
  Kosten: 30M × $0.0000166667 = $500/Monat

Total: $507.50/Monat
```

---

### Variante 2: S3 → SQS → Lambda (mit Batching)

```
Events: 250k/Tag × 30 Tage = 7.5M/Monat
Batch Size: 10

SQS:
  Messages: 7.5M
  Kosten: 7.5M / 1M × $0.40 = $3/Monat

Lambda (WITH Batching):
  Invocations: 7.5M / 10 = 750.000
  Duration: 750k × 2s × 2 GB = 3M GB-Sekunden
  Kosten: 3M × $0.0000166667 = $50/Monat

Total: $53/Monat

Einsparung: $454.50/Monat (90%!) 🎉
```

**Batch Size 10 → 90% Lambda Kosten gespart!**

---

### Variante 3: S3 → SQS → Lambda (Batch Size 100)

```
Lambda (WITH Batching 100):
  Invocations: 7.5M / 100 = 75.000
  Duration: 75k × 2s × 2 GB = 300k GB-Sekunden
  Kosten: 300k × $0.0000166667 = $5/Monat

Total: $8/Monat

Einsparung: $499.50/Monat (98%!) 🚀
```

**Aber:** Höheres Timeout-Risiko!

---

## ⚖️ Wann EventBridge? Wann SQS?

### ✅ Nutze EventBridge wenn:

1. **Multi-Target Routing** nötig

   ```
   S3 Event → EventBridge
     ├─→ Lambda (E-Invoice)
     ├─→ Lambda (Analytics)
     └─→ SNS (Notification)
   ```

2. **Pattern Matching** nötig

   ```json
   {
     "source": ["aws.s3", "aws.dynamodb", "custom.billing"],
     "detail-type": ["Object Created", "Stream Record"]
   }
   ```

3. **Event Transformation** nötig
4. **Cross-Account Events** nötig
5. **Latenz wichtiger als Kosten** (50ms vs 100ms)

---

### ✅ Nutze SQS wenn:

1. **Batching wichtig** (Kosten optimieren!) ⭐

   ```
   10-100 Messages pro Lambda = 90-99% Kosten-Ersparnis
   ```

2. **FIFO Ordering** nötig
3. **Message Retention** länger als 24h nötig (SQS: 14 Tage)
4. **Visibility Timeout** für Verarbeitung nötig
5. **Dead Letter Queue** mit Retry-Kontrolle
6. **High Throughput** mit Kosten-Optimierung

---

## 🎯 Empfehlung für E-Invoice System

### Für MCBS (250k/Tag):

**S3 → SQS → Lambda** ⭐ EMPFOHLEN

**Warum?**

```
✅ 90% Lambda Kosten gespart ($500 → $50)
✅ Batching reduziert Invocations
✅ DLQ für fehlerhafte Messages
✅ Retry-Kontrolle
✅ Einfacher als EventBridge für Single-Target
```

**Config:**

```yaml
batchSize: 10
maximumBatchingWindowInSeconds: 5
```

---

### Für Multi-Source (MCBS + AWS Billing):

**EventBridge → Lambda** ⭐ EMPFOHLEN

**Warum?**

```
✅ Pattern-basiertes Routing (MCBS vs AWS Billing)
✅ Einfache Multi-Source Integration
✅ Flexible Event-Driven Architecture
⚠️ Kein natives Batching (aber akzeptabel bei Mixed Sources)
```

**Alternative:**

```
EventBridge → SQS → Lambda  (Best of Both!)
  ├─ EventBridge: Routing
  └─ SQS: Batching
```

---

## 🔧 Hybrid-Ansatz: EventBridge + SQS

### Architektur: Best of Both Worlds

```
┌─────────────────────────────────────────────────────┐
│ Source Systems                                      │
├─────────────────────────────────────────────────────┤
│ MCBS (S3) → EventBridge                            │
│ AWS Billing (DynamoDB) → EventBridge               │
└────────────┬────────────────────────────────────────┘
             │
             ↓
┌─────────────────────────────────────────────────────┐
│ EventBridge                                         │
│ - Pattern Matching                                  │
│ - Multi-Source Routing                              │
└────────────┬────────────────────────────────────────┘
             │
             ↓ EventBridge Rule → Target: SQS
┌─────────────────────────────────────────────────────┐
│ SQS Queue                                           │
│ - Batching (10 Messages)                            │
│ - Retry Logic                                       │
│ - DLQ                                               │
└────────────┬────────────────────────────────────────┘
             │
             ↓ Lambda Poll (Batch Size 10)
┌─────────────────────────────────────────────────────┐
│ Lambda: E-Invoice Generator                         │
│ - Processes 10 Invoices at once                     │
└─────────────────────────────────────────────────────┘
```

**Serverless.yml:**

```yaml
resources:
  Resources:
    # EventBridge Rule → SQS
    EventBridgeToSQSRule:
      Type: AWS::Events::Rule
      Properties:
        EventBusName: default
        EventPattern:
          source:
            - aws.s3
            - aws.dynamodb
          detail-type:
            - Object Created
            - Stream Record
        Targets:
          - Arn: !GetAtt InvoiceProcessingQueue.Arn
            Id: SQSTarget

    # SQS Queue
    InvoiceProcessingQueue:
      Type: AWS::SQS::Queue
      Properties:
        QueueName: invoice-processing
        VisibilityTimeout: 360

functions:
  createEInvoice:
    handler: src/handlers/handler.ts
    events:
      - sqs:
          arn: !GetAtt InvoiceProcessingQueue.Arn
          batchSize: 10
          maximumBatchingWindowInSeconds: 5
```

**Vorteile:**

- ✅ EventBridge: Multi-Source Routing
- ✅ SQS: Batching (90% Kosten gespart)
- ✅ DLQ für Fehler
- ✅ Best of Both!

**Kosten:**

```
EventBridge: $7.50/Monat
SQS: $3/Monat
Lambda (Batched): $50/Monat
──────────────────────────────
Total: $60.50/Monat

vs. EventBridge direkt: $507.50/Monat
Einsparung: $447/Monat (88%!) ✅
```

---

## 📊 Zusammenfassung

### EventBridge

**Was:** Event Bus für Event-Driven Architecture  
**Routing:** Pattern Matching (Multi-Target)  
**Batching:** ❌ NEIN  
**Kosten:** $1/Million Events  
**Best for:** Multi-Source, Complex Routing, Fan-Out

### SQS

**Was:** Message Queue für Point-to-Point  
**Routing:** Direct (1 Consumer)  
**Batching:** ✅ **JA (native!)**  
**Kosten:** $0.40/Million Messages  
**Best for:** **Cost Optimization, Batching, FIFO**

### Batching

**Konzept:** 10-100 Messages → 1 Lambda Invocation  
**Einsparung:** 90-99% Lambda Kosten  
**Config:** `batchSize` + `maximumBatchingWindowInSeconds`

---

## ✅ Finale Empfehlung

### Für Dein E-Invoice System:

**Hybrid: EventBridge → SQS → Lambda** ⭐

**Warum?**

1. ✅ EventBridge: Multi-Source Support (MCBS + AWS Billing)
2. ✅ SQS: Batching (90% Lambda Kosten gespart!)
3. ✅ DLQ: Error Handling
4. ✅ Flexibel & Kosteneffizient

**Config:**

```yaml
batchSize: 10 # 90% savings
maximumBatchingWindowInSeconds: 5 # Max 5s latency
```

**Kosten:**

```
EventBridge + SQS + Lambda (Batched): ~$60/Monat
vs. EventBridge direkt: ~$507/Monat
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Einsparung: $447/Monat (88%!) 🎉
```

**Das ist die optimale Lösung!** ✅
