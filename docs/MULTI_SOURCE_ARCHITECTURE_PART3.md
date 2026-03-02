# Multi-Source E-Invoice Architecture (Teil 3): Zusammenfassung & Empfehlungen

## 🎯 Finale Architektur-Empfehlung

### ✅ **Option 1: EventBridge-basiert** (EMPFOHLEN)

```
┌──────────────────────────────────────────────────────────────┐
│ Source Systems                                               │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  MCBS Legacy:              AWS Billing Service:             │
│  S3 Upload (XML)           DynamoDB Write (JSON)            │
│       ↓                           ↓                          │
│  EventBridge              EventBridge Pipe                   │
│  (S3 Events)              (DynamoDB Stream)                  │
│       ↓                           ↓                          │
└───────┼───────────────────────────┼──────────────────────────┘
        └───────────┬───────────────┘
                    ↓
      ┌─────────────────────────────┐
      │ EventBridge (Unified Bus)   │
      │ - Pattern Matching          │
      │ - Source Routing            │
      └─────────────┬───────────────┘
                    ↓
      ┌─────────────────────────────┐
      │ Lambda: E-Invoice Generator │
      │ ┌─────────────────────────┐ │
      │ │ Adapter Factory         │ │
      │ │   ├─ MCBSAdapter        │ │
      │ │   └─ AWSBillingAdapter  │ │
      │ └──────────┬──────────────┘ │
      │            ↓                │
      │ ┌─────────────────────────┐ │
      │ │ Common Invoice Model    │ │
      │ └──────────┬──────────────┘ │
      │            ↓                │
      │ ┌─────────────────────────┐ │
      │ │ @e-invoice-eu/core      │ │
      │ │ → ZUGFeRD XML           │ │
      │ │ → PDF Embedding         │ │
      │ └─────────────────────────┘ │
      └─────────────┬───────────────┘
                    ↓
      ┌─────────────────────────────┐
      │ S3: E-Invoices              │
      └─────────────────────────────┘
```

**Vorteile:**
- ✅ Event-Driven (lose Kopplung)
- ✅ Ein Lambda für beide Sources
- ✅ Einfache Migration (gradual)
- ✅ AWS-native (kein SQS nötig)
- ✅ Echtzeit-Verarbeitung

**Nachteile:**
- ⚠️ EventBridge Kosten (~$1/Million Events)
- ⚠️ Komplexere Debugging

---

### Alternative: API Gateway (für REST API)

```
AWS Billing Service
  ↓ REST API Call
API Gateway → Lambda
  ↓
E-Invoice (synchron zurück)
```

**Wann nutzen?**
- Wenn AWS Billing Service **synchrone** E-Rechnung braucht
- Für manuelle Requests
- Für Batch-Jobs

---

## 📊 Vergleich: S3 Events vs. EventBridge

| Aspekt | S3 Events → SQS | EventBridge |
|--------|-----------------|-------------|
| **Latenz** | +100-500ms | +50-200ms ✅ |
| **Kosten** | SQS: $2-3/Monat | EventBridge: $1/Million Events |
| **Routing** | Einfach | **Flexibel** (Pattern Matching) ✅ |
| **Multi-Source** | Schwierig | **Einfach** ✅ |
| **Retry** | SQS DLQ | EventBridge DLQ ✅ |
| **Batching** | SQS native | Nicht native ⚠️ |

**Empfehlung:** EventBridge für Multi-Source, SQS wenn Batching wichtig

---

## 💾 Datenspeicherung: Wo liegt was?

### Legacy MCBS

```
S3 Bucket: mcbs-invoices-{stage}
├── raw/                    # MCBS XML
│   └── YYYY/MM/DD/
│       └── INV-*.xml
├── pdf/                    # HOMER PDFs
│   └── YYYY/MM/DD/
│       └── INV-*.pdf
└── e-invoices/             # E-Rechnungen
    └── YYYY/MM/DD/
        └── INV-*_zugferd.pdf
```

### AWS Billing Service

```
DynamoDB: aws-billing-invoices-{stage}
├── invoiceId (Hash Key)
├── Invoice Data (JSON)
└── pdf.base64 (optional)

oder

S3 Bucket: aws-billing-pdfs-{stage}
├── YYYY/MM/DD/
│   └── INV-*.pdf

+ 

S3 Bucket: e-invoices-{stage}  # ← Gleicher Output!
└── YYYY/MM/DD/
    └── INV-*_zugferd.pdf
```

**Empfehlung:** Gemeinsamer E-Invoice Output-Bucket!

---

## 🔄 Adapter Pattern: Austauschbarkeit

### Plugin-Architektur

```typescript
// src/adapters/adapter-registry.ts

export class AdapterRegistry {
  private adapters = new Map<string, () => InvoiceAdapter>();
  
  register(source: string, factory: () => InvoiceAdapter) {
    this.adapters.set(source, factory);
  }
  
  getAdapter(source: string): InvoiceAdapter {
    const factory = this.adapters.get(source);
    if (!factory) {
      throw new Error(`No adapter for source: ${source}`);
    }
    return factory();
  }
}

// In Lambda Initialization
const registry = new AdapterRegistry();
registry.register('aws.s3', () => new MCBSAdapter());
registry.register('aws.dynamodb', () => new AWSBillingAdapter());
registry.register('custom.billing', () => new AWSBillingAdapter());

// Usage
const adapter = registry.getAdapter(event.source);
```

**Vorteile:**
- ✅ Neue Sources einfach hinzufügen
- ✅ Testbar (Mock Adapters)
- ✅ Config-driven

---

## 🧪 Testing-Strategie

### Unit Tests pro Adapter

```typescript
// test/adapters/mcbs-adapter.test.ts

describe('MCBSAdapter', () => {
  
  it('should map MCBS XML to Common Model', async () => {
    const adapter = new MCBSAdapter();
    const mcbsXml = loadFixture('mcbs-invoice.xml');
    
    const rawData = await adapter.loadInvoiceData({
      detail: { bucket: { name: 'test' }, object: { key: 'test.xml' } }
    });
    
    const common = await adapter.mapToCommonModel(rawData);
    
    expect(common.source.system).toBe('MCBS');
    expect(common.invoiceNumber).toBe('INV-2026-000001');
  });
});

// test/adapters/aws-billing-adapter.test.ts

describe('AWSBillingAdapter', () => {
  
  it('should map AWS Billing JSON to Common Model', async () => {
    const adapter = new AWSBillingAdapter();
    const billingJson = loadFixture('aws-billing-invoice.json');
    
    const rawData = await adapter.loadInvoiceData({
      detail: { dynamodb: { Keys: { invoiceId: { S: 'test-123' } } } }
    });
    
    const common = await adapter.mapToCommonModel(rawData);
    
    expect(common.source.system).toBe('AWS_BILLING');
    expect(common.invoiceNumber).toBe('INV-2026-000001');
  });
});
```

### Integration Tests

```typescript
// test/integration/e-invoice-generation.test.ts

describe('E-Invoice Generation (Multi-Source)', () => {
  
  it('should generate E-Invoice from MCBS', async () => {
    const event = createS3Event('mcbs-invoices-dev', 'raw/test.xml');
    const result = await handler(event);
    
    expect(result.statusCode).toBe(200);
    expect(result.body.sourceSystem).toBe('MCBS');
  });
  
  it('should generate E-Invoice from AWS Billing', async () => {
    const event = createDynamoDBEvent('test-invoice-123');
    const result = await handler(event);
    
    expect(result.statusCode).toBe(200);
    expect(result.body.sourceSystem).toBe('AWS_BILLING');
  });
  
  it('should produce identical ZUGFeRD XML for same invoice data', async () => {
    // Same invoice data, different sources
    const mcbsEvent = createS3Event(...);
    const awsEvent = createDynamoDBEvent(...);
    
    const result1 = await handler(mcbsEvent);
    const result2 = await handler(awsEvent);
    
    // Extract ZUGFeRD XML from both PDFs
    const xml1 = extractXMLFromPDF(result1.outputKey);
    const xml2 = extractXMLFromPDF(result2.outputKey);
    
    // Should be semantically equal
    expect(normalizeXML(xml1)).toEqual(normalizeXML(xml2));
  });
});
```

---

## 📈 Performance & Skalierung

### Beide Systeme parallel (Worst Case)

```
Annahme: 50% MCBS, 50% AWS Billing

MCBS:         125k/Tag
AWS Billing:  125k/Tag
─────────────────────────
Total:        250k/Tag

Lambda Kosten:
├── MCBS:     125k × 5s × 2 GB = $622/Monat
├── AWS:      125k × 3s × 2 GB = $373/Monat (schneller, da JSON)
─────────────────────────────────────────────
Total:        ~$995/Monat

EventBridge:
├── MCBS Events:     125k × 30 = 3.75M/Monat
├── AWS Events:      125k × 30 = 3.75M/Monat
├── Total:           7.5M Events/Monat
├── Kosten:          7.5M × $0.000001 = $7.50/Monat
─────────────────────────────────────────────
Total EventBridge: $7.50/Monat

S3, DynamoDB, CloudWatch: ~$180/Monat (wie zuvor)
─────────────────────────────────────────────
GESAMT: ~$1.182/Monat
```

**Optimierung wenn 100% AWS Billing:**

```
Lambda:         250k × 3s × 2 GB = $746/Monat (-25%)
EventBridge:    $7.50/Monat
S3/DynamoDB:    $100/Monat (weniger S3 PUTs)
─────────────────────────────────────────────
GESAMT:         ~$854/Monat (-28%)
```

---

## 🔄 Migration Timeline

### Jetzt (2026 Q1): Legacy MCBS
```
✅ Implementiere EventBridge-basierte Architektur
✅ MCBS Adapter funktioniert
✅ Production-ready
```

### Q2-Q3 2026: Parallel Betrieb
```
✅ AWS Billing Service entwickelt
✅ AWS Billing Adapter implementiert
✅ Beide Systeme laufen parallel
✅ A/B Testing (z.B. 10% AWS Billing)
```

### Q4 2026: Migration
```
✅ Schrittweise Migration MCBS → AWS Billing
✅ 25% → 50% → 75% → 100%
✅ Monitoring & Validation
```

### 2027: Full AWS Billing
```
✅ 100% AWS Billing Service
✅ MCBS Adapter deaktiviert (aber noch im Code!)
✅ Legacy System abgeschaltet
```

---

## ✅ Finale Empfehlungen

### 1. Architektur: EventBridge-basiert ⭐

**Warum?**
- Event-Driven (Microservices Best Practice)
- Multi-Source native
- Gradual Migration möglich
- AWS-native (keine zusätzlichen Services)

### 2. Adapter Pattern ⭐

**Warum?**
- Austauschbare Mapper
- Testbar
- Erweiterbar (neue Sources einfach)
- Common Invoice Model (Source-agnostic)

### 3. Gemeinsamer Output-Bucket ⭐

**Warum?**
- Egal von welchem System → gleicher Output
- Einfachere Downstream-Integration
- Konsistente Struktur

### 4. Nicht S3 vs. DynamoDB - beides! ⭐

**Warum?**
- MCBS nutzt S3 (Legacy)
- AWS Billing nutzt DynamoDB (Modern)
- E-Invoice Lambda unterstützt beides via Adapter
- Migration ohne Breaking Changes

---

## 🎯 Zusammenfassung

### Du brauchst NICHT zwei separate Lösungen!

**Eine Lambda mit Adapter Pattern kann:**
- ✅ MCBS XML von S3 lesen
- ✅ AWS Billing JSON von DynamoDB lesen
- ✅ Beide zu Common Invoice Model mappen
- ✅ Eine E-Rechnung generieren
- ✅ Gradual Migration ermöglichen

### Architektur bleibt EventBridge-basiert

```
Beide Sources → EventBridge → Eine Lambda (mit Adapters) → S3
```

**NICHT:**
```
S3 → Lambda 1 → S3
DynamoDB → Lambda 2 → S3
```

### Mapper ist austauschbar

```typescript
interface InvoiceAdapter {
  loadInvoiceData(event): Promise<RawData>;
  mapToCommonModel(raw): Promise<CommonInvoice>;
  loadPDF(invoice): Promise<Buffer>;
}

// Neue Source? Einfach neuen Adapter implementieren!
class NewSystemAdapter implements InvoiceAdapter { ... }
```

---

## 📚 Code-Struktur

```
src/
├── models/
│   └── common-invoice.model.ts      # ← Source-agnostic!
├── adapters/
│   ├── invoice-adapter.interface.ts
│   ├── mcbs-adapter.ts               # ← Legacy
│   ├── aws-billing-adapter.ts        # ← Neu
│   └── adapter-registry.ts
├── handlers/
│   ├── unified-e-invoice.handler.ts  # ← Haupt-Lambda
│   └── api-e-invoice.handler.ts      # ← Optional REST
└── services/
    ├── mcbs-parser.service.ts
    ├── deduplication.service.ts
    └── zugferd-generator.service.ts
```

**Ein Repository, eine Lambda, zwei Adapters!** ✅

---

## 🚀 Nächste Schritte

1. ✅ **Implementiere EventBridge-Setup** (statt SQS)
2. ✅ **Erstelle Common Invoice Model**
3. ✅ **Implementiere MCBS Adapter** (von Teilen 1-3)
4. ✅ **Implementiere AWS Billing Adapter** (wenn fertig)
5. ✅ **Unified Lambda Handler**
6. ✅ **Tests für beide Adapter**
7. ✅ **Deploy & Migration**

**Timeline: 6-8 Wochen für komplette Lösung** 🎉

Soll ich Dir die aktualisierte serverless.yml mit EventBridge erstellen? 🚀