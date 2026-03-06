# ZUGFeRD XML in PDF einbetten - AWS Lösung

## E-Rechnungs-Standard: ZUGFeRD / Factur-X

### Was ist eine E-Rechnung?

Eine **E-Rechnung** nach ZUGFeRD/Factur-X Standard besteht aus:

1. **PDF/A-3** Dokument (visuell lesbar)
2. **XML Anhang** (strukturierte Daten)

---

## 1. Matching-Strategie: PDF ↔ XML

### Option A: Naming Convention (Empfohlen) ✅

```
S3 Struktur:
├── invoices/pdf/2026/02/
│   ├── INV-2026-000001.pdf
│
├── invoices/zugferd/2026/02/
│   ├── INV-2026-000001_zugferd.xml
│
└── invoices/e-rechnung/2026/02/
    ├── INV-2026-000001_zugferd.pdf
```

**Matching Logic:**

```typescript
function findMatchingXml(pdfKey: string): string {
  const basename = path.basename(pdfKey, '.pdf')
  const dirname = path.dirname(pdfKey)

  return dirname.replace('/pdf/', '/zugferd/') + `/${basename}_zugferd.xml`
}
```

---

## 2. PDF/A-3 Compliance

### Anforderungen für ZUGFeRD PDF

1. ✅ **PDF/A-3b** Format
2. ✅ **XML als Anhang** eingebettet
3. ✅ **Dateiname**: `factur-x.xml`
4. ✅ **MIME Type**: `text/xml`
5. ✅ **AFRelationship**: `Alternative`

---

## 3. TypeScript Implementation

Siehe separate Dateien:

- `ZUGFERD_EMBEDDER_SERVICE.md` - Service Implementation
- `ZUGFERD_LAMBDA_HANDLER.md` - Lambda Handler
- `ZUGFERD_SERVERLESS_CONFIG.md` - Serverless.yml

---

## Workflow

```
MCBS XML Upload
  → Lambda 1: MCBS → ZUGFeRD
    → ZUGFeRD XML zu S3
      → Lambda 2: PDF + XML → E-Rechnung
        → E-Rechnung PDF/A-3 zu S3
```

**Deployment-Ready!** 🚀
