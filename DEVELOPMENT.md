# Development Guide: MCBS ZUGFeRD Converter

## 🎯 Entwicklungs-Strategie

### Phase 1: Lokale Entwicklung (JETZT) ✅

**Vorteile:**

- ✅ Schnelles Feedback (keine AWS nötig)
- ✅ Einfaches Debugging
- ✅ Kein AWS-Kosten während Entwicklung
- ✅ Offline-fähig

**Setup:**

- Test-XMLs in `test/resources/`
- Unit Tests mit Jest
- Lokales File-Loading
- Mock S3/DynamoDB

### Phase 2: Integration Tests (SPÄTER)

**Wenn:**

- Lokale Tests grün
- Basis-Implementierung fertig

**Setup:**

- Serverless Offline
- LocalStack (S3/DynamoDB Mock)
- Integration Tests

### Phase 3: AWS Deployment (ZULETZT)

**Wenn:**

- Integration Tests grün
- Code-Review done

**Setup:**

- Deploy to Dev Stage
- Echte S3 Buckets
- End-to-End Tests

---

## 🛠️ Lokale Entwicklung

### 1. Test-Driven Development

```bash
# Watch Mode für schnelle Iteration
npm run test:watch
```

**Workflow:**

1. Test schreiben (red)
2. Implementierung (green)
3. Refactoring
4. Repeat

### 2. Projekt-Struktur

```
mcbs-zugferd-converter/
├── src/
│   ├── types/
│   │   └── common-invoice.model.ts     # ✅ Done
│   ├── adapters/
│   │   ├── invoice-adapter.interface.ts # ✅ Done
│   │   └── mcbs-adapter.ts              # 🟡 Skeleton
│   ├── handlers/
│   │   └── unified-e-invoice.handler.ts # 🟡 Skeleton
│   └── services/
│       ├── mcbs-parser.service.ts       # ❌ TODO
│       └── zugferd-generator.service.ts # ❌ TODO
├── test/
│   ├── unit/
│   │   ├── zugferd-basic.test.ts        # ✅ Done
│   │   └── mcbs-adapter.test.ts         # ✅ Done
│   ├── resources/mcbs
│   │   └── mcbs-simple-invoice.xml      # ✅ Done
│   ├── setup.ts                         # ✅ Done
│   └── test-utils.ts                    # ✅ Done
```

### 3. Nächste Schritte

#### A. MCBS XML Parser implementieren

```typescript
// src/services/mcbs-parser.service.ts

import {XMLParser} from 'fast-xml-parser'

export class MCBSParserService {
  private parser: XMLParser

  constructor() {
    this.parser = new XMLParser({
      ignoreAttributes: false,
      parseAttributeValue: true
    })
  }

  parse(xmlContent: string): any {
    return this.parser.parse(xmlContent)
  }
}
```

**Test:**

```bash
npm test -- mcbs-parser.test.ts
```

#### B. @e-invoice-eu/core Integration

```typescript
// src/services/zugferd-generator.service.ts

import {CommonInvoice} from '../models/commonInvoice'

export class ZugferdGeneratorService {
  async generateZugferd21(invoice: CommonInvoice): Promise<string> {
    // TODO: @e-invoice-eu/core verwenden
    // const ciiGenerator = new CIIGenerator();
    // return ciiGenerator.generate(invoice, { profile: 'BASIC' });
  }
}
```

**Test:**

```bash
npm test -- zugferd-basic.test.ts
```

#### C. MCBS Adapter vervollständigen

```typescript
// src/adapters/mcbs-adapter.ts

export class MCBSAdapter implements InvoiceAdapter {
  async loadInvoiceData(eventPayload: any): Promise<RawInvoiceData> {
    // Lokales Loading für Tests
    if (eventPayload.xmlContent) {
      const parsed = this.parser.parse(eventPayload.xmlContent)
      return {
        source: 'MCBS',
        data: parsed,
        metadata: {
          id: parsed.DOCUMENT.ID,
          timestamp: new Date().toISOString()
        }
      }
    }

    // S3 Loading für Production (später)
    throw new Error('S3 loading not yet implemented')
  }

  async mapToCommonModel(rawData: RawInvoiceData): Promise<CommonInvoice> {
    const mcbs = rawData.data

    return {
      invoiceNumber: mcbs.DOCUMENT.ID,
      invoiceDate: this.formatDate(mcbs.DOCUMENT.INVOICE_DATA.PAYMENT_MODE.DUE_DATE)
      // ... weitere Felder
    }
  }
}
```

---

## 🧪 Testing-Strategie

### Unit Tests (Lokal)

**Was testen:**

- ✅ MCBS Parser (XML → Object)
- ✅ MCBS Adapter (Object → CommonInvoice)
- ✅ ZUGFeRD Generator (CommonInvoice → XML)
- ✅ Helper-Funktionen

**Wie:**

```bash
# Alle Unit Tests
npm test

# Spezifischer Test
npm test -- mcbs-adapter.test.ts

# Watch Mode
npm run test:watch

# Coverage
npm run test:coverage
```

**Test-Dateien:**

- `test/resources/mcbs/mcbs-*.xml` - Verschiedene Test-Szenarien
- `test/resources/mcbs/expected-*.xml` - Erwartete ZUGFeRD Outputs

### Integration Tests (Später)

**Was testen:**

- Lambda Handler End-to-End
- S3 Mock Integration
- SQS Mock Integration

**Setup:**

```bash
npm install --save-dev @aws-sdk/client-s3-node
npm install --save-dev serverless-offline
```

---

## 📝 Development Checklist

### Phase 1: BASIC Profile (Diese Woche)

- [x] Projekt-Struktur
- [x] Common Invoice Model
- [x] Adapter Interface
- [x] MCBS Adapter Skeleton
- [x] Lambda Handler Skeleton
- [x] Test-Infrastruktur
- [x] Test-Resources
- [ ] MCBS Parser Service
- [ ] ZUGFeRD Generator Service (@e-invoice-eu/core)
- [ ] MCBS Adapter Implementation (BASIC Fields)
- [ ] Unit Tests grün

### Phase 2: COMFORT Profile (Nächste Woche)

- [ ] Erweiterte MCBS Felder (Line Items, VAT Details)
- [ ] Payment Terms
- [ ] Ratenzahlungen Support
- [ ] PDF Loading (lokal)
- [ ] PDF Embedding (@e-invoice-eu/core)

### Phase 3: Integration (Übernächste Woche)

- [ ] Serverless Offline Setup
- [ ] S3 Mock (LocalStack)
- [ ] DynamoDB Mock
- [ ] Deduplication Service
- [ ] Integration Tests

### Phase 4: AWS Deployment (Danach)

- [ ] Deploy to Dev
- [ ] Echte S3 Buckets
- [ ] End-to-End Tests
- [ ] Production Rollout

---

## 💡 Quick Commands

```bash
# Development
npm run test:watch           # Tests in Watch Mode
npm run build                # TypeScript kompilieren
npm run lint                 # Code-Qualität prüfen

# Testing
npm test                     # Alle Tests
npm run test:coverage        # Mit Coverage Report
npm test -- --verbose        # Verbose Output

# Später: AWS Integration
npm run deploy:dev           # Deploy to AWS Dev
npm run logs                 # CloudWatch Logs
```

---

## 🎯 Aktueller Stand

### ✅ Fertig

- Projekt-Struktur
- Git Repository
- Common Invoice Model (EN 16931 kompatibel)
- Adapter Pattern Interface
- MCBS Adapter Skeleton
- Lambda Handler Skeleton
- Test-Infrastruktur (Jest)
- Test-Resources (MCBS XML)
- Test-Utilities
- Dokumentation

### 🟡 In Arbeit

- MCBS Parser Service
- @e-invoice-eu/core Integration

### ❌ TODO

- MCBS → CommonInvoice Mapping
- ZUGFeRD XML Generation
- PDF Embedding
- AWS Integration

---

## 🚀 Nächste Schritte (JETZT)

1. **Warte auf npm install**

   ```bash
   # Prüfe wenn fertig
   npm test
   ```

2. **Implementiere MCBS Parser**

   ```bash
   # Erstelle Service
   touch src/services/mcbs-parser.service.ts

   # Erstelle Test
   touch test/unit/mcbs-parser.test.ts
   ```

3. **Teste @e-invoice-eu/core API**

   ```bash
   # Schaue in node_modules/@e-invoice-eu/core
   # Finde Beispiele in README
   # Implementiere ersten Generator-Test
   ```

4. **Iteriere schnell**
   ```bash
   npm run test:watch
   # Edit → Save → Auto-Test → Repeat
   ```

---

## 📚 Nützliche Links

- [@e-invoice-eu/core Docs](https://www.npmjs.com/package/@e-invoice-eu/core)
- [fast-xml-parser Docs](https://www.npmjs.com/package/fast-xml-parser)
- [ZUGFeRD Spezifikation](https://www.ferd-net.de/standards/zugferd-2.1.1/index.html)
- [EN 16931 Standard](https://ec.europa.eu/digital-building-blocks/wikis/display/DIGITAL/Compliance+with+the+European+standard+on+eInvoicing)

---

## 🚀 Deployment

### Dev-Stage (lokal, direkt)

Persönliche Dev-Stages werden direkt vom lokalen Rechner aus deployed — kein CI/CD nötig:

```bash
npx serverless deploy --stage {dein-name} --aws-profile sso-session
```

Für diese Stages legt der Stack Bucket, SSM-Parameter und alle Ressourcen selbst an (`createBucket: true`).

### Staging & Production (via GitHub Actions + OIDC)

Staging- und Production-Deployments laufen ausschließlich über den GitHub Actions Workflow `.github/workflows/deploy.yml` (manueller Trigger via `workflow_dispatch`).

#### Wie die AWS-Authentifizierung funktioniert

Das Projekt verwendet **GitHub OIDC** — es werden keine langlebigen AWS Access Keys gespeichert. Stattdessen:

1. GitHub Actions fordert beim OIDC-Provider ein **kurzlebiges JWT-Token** an, das die Repository-Identität (`repo:freenet-group/e-invoice-generator`) enthält
2. Der Workflow übergibt dieses Token an `aws-actions/configure-aws-credentials`
3. AWS STS prüft das Token gegen die **Trust Policy** der Deployment-Rolle in `billing-aws-account-iac`
4. Bei Übereinstimmung stellt AWS temporäre Credentials aus (`AssumeRoleWithWebIdentity`) — gültig für die Dauer des Workflows

```yaml
# .github/workflows/deploy.yml (vereinfacht)
- name: Connect to AWS
  uses: aws-actions/configure-aws-credentials@v4
  with:
    role-to-assume: ${{ vars.E_INVOICE_NONPROD_DEPLOY_ROLE_ARN }} # staging
    #              ${{ vars.E_INVOICE_PROD_DEPLOY_ROLE_ARN }}       # production
    aws-region: eu-central-1
```

#### Voraussetzungen in `billing-aws-account-iac`

Die IAM-Rollen müssen dort mit folgender Trust Policy angelegt sein:

```json
{
  "Effect": "Allow",
  "Principal": {
    "Federated": "arn:aws:iam::{accountId}:oidc-provider/token.actions.githubusercontent.com"
  },
  "Action": "sts:AssumeRoleWithWebIdentity",
  "Condition": {
    "StringEquals": {
      "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
    },
    "StringLike": {
      "token.actions.githubusercontent.com:sub": "repo:freenet-group/e-invoice-generator:*"
    }
  }
}
```

#### GitHub Repository Variables

Die Rollen-ARNs werden als **Repository Variables** (nicht Secrets) hinterlegt:

| Variable                            | Beschreibung                             |
| ----------------------------------- | ---------------------------------------- |
| `E_INVOICE_NONPROD_DEPLOY_ROLE_ARN` | Deployment-Rolle für `dev` und `staging` |
| `E_INVOICE_PROD_DEPLOY_ROLE_ARN`    | Deployment-Rolle für `production`        |

Setzen unter: `github.com/freenet-group/e-invoice-generator → Settings → Secrets and variables → Actions → Variables`

#### Deployment anstoßen

```
github.com/freenet-group/e-invoice-generator
  → Actions → "e-invoice-generator - deploy"
  → Run workflow → Stage auswählen → Run
```

#### Was staging/production von dev unterscheidet

|                                 | dev / persönliche Stage | staging / production                             |
| ------------------------------- | ----------------------- | ------------------------------------------------ |
| Bucket wird erstellt            | ✅ durch diesen Stack   | ❌ extern via IaC                                |
| SSM Parameter werden erstellt   | ✅ durch diesen Stack   | ❌ extern via IaC                                |
| Deployment-Weg                  | lokal (`sso-session`)   | GitHub Actions (OIDC)                            |
| Voraussetzung vor erstem Deploy | keine                   | Bucket + SSM Parameter müssen bereits existieren |

---

**Du entwickelst jetzt LOKAL ohne AWS - schnelles Iterieren!** ✅
