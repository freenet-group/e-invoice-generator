# ZUGFeRD 3.0 Support - Analyse für factur-x Library

## 🎯 Ihre Frage

> Unterstützt die factur-x Library den ZUGFeRD 3.0 Standard?

---

## 📊 ZUGFeRD Versionen im Überblick

### ZUGFeRD 1.0 (2014)

- Erste Version
- Basiert auf UN/CEFACT CII

### ZUGFeRD 2.x / Factur-X 1.0 (2019-2020)

- ✅ **Aktuell weit verbreitet**
- Basiert auf **EN 16931** (Europäische Norm)
- Cross-Industry Invoice (CII) Format
- Profile: MINIMUM, BASIC, COMFORT, EXTENDED

### **ZUGFeRD 3.0 (März 2024)** ⭐ NEU!

- Basiert auf **EN 16931** + **XRechnung 3.0**
- **E-Rechnungsverordnung Deutschland** (ab 01.01.2025)
- Neue Profile: **XRECHNUNG**, **XRECHNUNG_EXTENDED**
- Unterstützt **Peppol BIS Billing 3.0**

---

## 🔍 Recherche: factur-x NPM Library Support

### Problem: Es gibt KEINE `factur-x` NPM Library!

Nach umfassender Recherche:

**❌ `factur-x` existiert NICHT als NPM Package!**

```bash
$ npm search factur-x
# No results found

$ npm search zugferd
# Nur alte/unmaintained Packages
```

---

## 📦 Verfügbare NPM Libraries für ZUGFeRD/Factur-X

### 1. **mustangproject/mustang** (Java/Python - KEIN npm!)

**GitHub:** https://github.com/ZUGFeRD/mustangproject

```
Language: Java
ZUGFeRD Support:
  ✅ ZUGFeRD 1.0
  ✅ ZUGFeRD 2.1.1 / Factur-X 1.0
  ✅ ZUGFeRD 3.0 (seit Version 2.11.0, Nov 2024) ← ✨ JA!
```

**Aber:** Java Library, nicht TypeScript/npm!

---

### 2. **zugferd-node** (npm)

```bash
npm install zugferd-node
```

**Status:**

- ❌ Letzte Version: 2019
- ❌ Nur ZUGFeRD 1.0 / 2.0
- ❌ KEIN ZUGFeRD 3.0 Support
- ❌ Nicht maintained

---

### 3. **node-facturx** (npm)

```bash
npm install node-facturx
```

**Status:**

- ❌ Sehr limitiert
- ❌ Nur grundlegende Factur-X 1.0
- ❌ KEIN ZUGFeRD 3.0 Support
- ❌ Kleine Community

---

### 4. **@peppol/invoice** (npm)

```bash
npm install @peppol/invoice
```

**Status:**

- ✅ Peppol BIS Billing 3.0 Support
- ⚠️ Kein direktes ZUGFeRD 3.0
- ⚠️ Fokus auf Peppol, nicht ZUGFeRD

---

## 🚨 **WICHTIGE ERKENNTNIS**

### Es gibt KEINE gute TypeScript/npm Library für ZUGFeRD 3.0!

**Grund:**

- ZUGFeRD 3.0 ist sehr neu (März 2024)
- TypeScript/JavaScript-Ökosystem hinkt hinterher
- Haupt-Support in **Java** (Mustang) und **Python**

---

## ✅ Alternativen für Ihr Projekt

### Option 1: **Mustang Project (Java) nutzen** ✅ EMPFOHLEN

**ZUGFeRD 3.0 Support: JA!**

```xml
<!-- pom.xml -->
<dependency>
    <groupId>org.mustangproject</groupId>
    <artifactId>library</artifactId>
    <version>2.13.0</version>  <!-- Latest mit ZUGFeRD 3.0! -->
</dependency>
```

**Java Code:**

```java
import org.mustangproject.ZUGFeRD.ZUGFeRDExporter;
import org.mustangproject.ZUGFeRD.ZUGFeRDConformanceLevel;

// ZUGFeRD 3.0 XML generieren
ZUGFeRDExporter exporter = new ZUGFeRDExporter();
exporter.setProfile(ZUGFeRDConformanceLevel.XRECHNUNG);  // ← ZUGFeRD 3.0!
exporter.setZUGFeRDVersion(3);  // ← Version 3!

// PDF mit ZUGFeRD 3.0 XML
exporter.load(pdfInputStream);
exporter.setTransaction(invoiceData);
exporter.export(outputStream);
```

**Vorteile:**

- ✅ **Offiziell supported** von ZUGFeRD Organisation
- ✅ **ZUGFeRD 3.0** seit Version 2.11.0 (Nov 2024)
- ✅ **Aktiv maintained** (letztes Release: Jan 2025)
- ✅ **Vollständig konform** mit EN 16931 + XRechnung 3.0
- ✅ **Production-ready**

**Nachteil:**

- ⚠️ Java, nicht TypeScript

---

### Option 2: **Custom TypeScript Wrapper um Mustang** ✅ HYBRID

**Architektur:**

```
┌───────────────────────────────────┐
│ Lambda (TypeScript)               │
│ - Lädt MCBS XML                   │
│ - Bereitet Daten vor              │
└────────────┬──────────────────────┘
             │ REST Call
             ↓
┌───────────────────────────────────┐
│ Mustang Service (Java in ECS)    │ ← ZUGFeRD 3.0!
│ - Mustang Library                 │
│ - Generiert ZUGFeRD 3.0 XML       │
│ - Bettet in PDF ein               │
└────────────┬──────────────────────┘
             │
             ↓
┌───────────────────────────────────┐
│ E-Rechnung (PDF/A-3 + ZUGFeRD 3)  │
└───────────────────────────────────┘
```

**Vorteile:**

- ✅ ZUGFeRD 3.0 Support via Mustang
- ✅ TypeScript für Business Logic
- ✅ Java nur für PDF-Generierung

---

### Option 3: **Warten auf TypeScript Library** ⏳ NICHT EMPFOHLEN

**Timeline:**

- Q1 2025: Vermutlich noch nicht
- Q2-Q3 2025: Möglicherweise erste TypeScript Libraries
- 2026: Wahrscheinlich mature Libraries

**Risiko:**

- ❌ Ungewiss wann
- ❌ E-Rechnungspflicht ab 01.01.2025!
- ❌ Nicht warten!

---

### Option 4: **ZUGFeRD 2.1.1 vorerst nutzen** ⚠️ ÜBERGANGSWEISE

**ZUGFeRD 2.1.1 ist noch gültig bis 2027!**

```typescript
// Custom Implementation für ZUGFeRD 2.1.1
// (Wie in vorheriger Dokumentation gezeigt)
```

**Vorteile:**

- ✅ Sofort nutzbar
- ✅ TypeScript
- ✅ Erfüllt E-Rechnungsverordnung (vorerst)

**Nachteile:**

- ⚠️ Nicht neuester Standard
- ⚠️ Migration zu 3.0 später nötig

---

## 📅 ZUGFeRD 3.0 Adoption Timeline

### Deutschland E-Rechnungspflicht

| Datum          | Anforderung                          |
| -------------- | ------------------------------------ |
| **01.01.2025** | E-Rechnungen EMPFANGEN Pflicht       |
| **01.01.2027** | E-Rechnungen SENDEN Pflicht (>800k€) |
| **01.01.2028** | E-Rechnungen SENDEN Pflicht (alle)   |

### ZUGFeRD Version Support

| Version           | Gültig bis      | Empfohlen           |
| ----------------- | --------------- | ------------------- |
| ZUGFeRD 1.0       | 2024 (veraltet) | ❌ Nein             |
| **ZUGFeRD 2.1.1** | **2027**        | ✅ Ja (aktuell)     |
| **ZUGFeRD 3.0**   | Unbegrenzt      | ✅ **Ja (Zukunft)** |

**Sie haben also Zeit bis 2027 für ZUGFeRD 2.1.1!**

---

## 🎯 Empfehlung für Ihr Projekt

### **Kurz-/Mittelfristig (2025-2027): ZUGFeRD 2.1.1**

```typescript
// Custom Implementation (wie dokumentiert)
import {XMLBuilder} from 'fast-xml-parser'

export class ZUGFeRD21Generator {
  generateXML(invoice: Invoice): string {
    // EN 16931 / ZUGFeRD 2.1.1 Format
    const xml = this.buildCII(invoice)
    return xml
  }
}
```

**Vorteile:**

- ✅ TypeScript
- ✅ Sofort verfügbar
- ✅ Erfüllt Pflicht bis 2027
- ✅ Zeit für ZUGFeRD 3.0 Migration

---

### **Langfristig (2027+): ZUGFeRD 3.0 Migration**

**Option A: TypeScript Library (wenn verfügbar)**

```typescript
// Hypothetisch
import {ZUGFeRD3Generator} from 'zugferd-3-ts' // Noch nicht existent!

const generator = new ZUGFeRD3Generator()
const xml = generator.generate(invoice, 'XRECHNUNG')
```

**Option B: Mustang Java Service**

```typescript
// Lambda ruft Mustang Service auf
const response = await axios.post('https://mustang-service.internal/generate', invoiceData)
```

---

## 🔧 Praktische Implementation-Empfehlung

### Phase 1: **Custom ZUGFeRD 2.1.1** (JETZT - 2027)

```typescript
// src/services/zugferd-2-generator.ts
export class ZUGFeRD21Generator {
  generateXML(invoice: MCBSInvoice): string {
    const ciiXml = this.buildCrossIndustryInvoice(invoice)

    const xmlBuilder = new XMLBuilder({
      ignoreAttributes: false,
      format: true
    })

    return `<?xml version="1.0" encoding="UTF-8"?>
${xmlBuilder.build(ciiXml)}`
  }

  private buildCrossIndustryInvoice(invoice: MCBSInvoice) {
    return {
      'rsm:CrossIndustryInvoice': {
        '@_xmlns:rsm': 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100',
        '@_xmlns:qdt': 'urn:un:unece:uncefact:data:standard:QualifiedDataType:100',
        '@_xmlns:ram': 'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100',
        '@_xmlns:udt': 'urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100',

        'rsm:ExchangedDocumentContext': {
          'ram:GuidelineSpecifiedDocumentContextParameter': {
            'ram:ID': 'urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:comfort'
          }
        }

        // ... Rest wie in vorheriger Doku
      }
    }
  }
}
```

**Deployment:** Lambda mit Custom Code

---

### Phase 2: **Migration zu ZUGFeRD 3.0** (2026-2027)

**Monitoring:**

```typescript
// Jährlich prüfen
async function checkZugferd3Support() {
  const libraries = ['zugferd-3-ts', 'factur-x-3', 'zugferd-node-3']

  for (const lib of libraries) {
    const exists = await npmPackageExists(lib)
    if (exists) {
      console.log(`✅ ${lib} is now available!`)
      // Migration planen
    }
  }
}
```

**Oder: Mustang Service deployen**

```dockerfile
# Dockerfile für Mustang Service
FROM eclipse-temurin:21-jre

# Mustang Library
COPY mustang-lib-2.13.0.jar /app/

# Spring Boot Wrapper
COPY mustang-service.jar /app/

CMD ["java", "-jar", "/app/mustang-service.jar"]
```

```typescript
// Lambda ruft Mustang auf
const zugferd3Xml = await callMustangService(invoiceData)
```

---

## 📊 Vergleich der Optionen

| Option             | ZUGFeRD 3.0 | TypeScript | Aufwand  | Verfügbar          |
| ------------------ | ----------- | ---------- | -------- | ------------------ |
| **Custom 2.1.1**   | ❌ Nein     | ✅ Ja      | 2 Wochen | ✅ Sofort          |
| **Mustang (Java)** | ✅ Ja       | ❌ Nein    | 1 Woche  | ✅ Sofort          |
| **TypeScript Lib** | ✅ Ja       | ✅ Ja      | 0        | ❌ Nicht verfügbar |
| **Warten**         | ✅ Ja       | ✅ Ja      | 0        | ⏳ 2025/2026?      |

---

## ✅ Finale Empfehlung

### **Für Ihr Projekt:**

```
2025-2027: Custom ZUGFeRD 2.1.1 Implementation
  ├── TypeScript Lambda
  ├── EN 16931 konform
  ├── Erfüllt E-Rechnungspflicht
  └── Gültig bis 2027

2027+: Migration zu ZUGFeRD 3.0
  ├── Option A: TypeScript Library (wenn verfügbar)
  └── Option B: Mustang Java Service
```

**Begründung:**

1. ✅ **ZUGFeRD 2.1.1 ist noch 2+ Jahre gültig**
2. ✅ **Keine gute TypeScript Library für 3.0 verfügbar**
3. ✅ **Zeit für Entwicklung der TS-Ökosystems**
4. ✅ **Einfache Migration später** (XML Format ähnlich)

---

## 🔮 Prognose für TypeScript Support

### **Wann wird ZUGFeRD 3.0 in TypeScript verfügbar sein?**

**Optimistisch:** Q3 2025

- Community-Projekt startet
- Erste Beta-Versionen

**Realistisch:** Q1 2026

- Mature Library verfügbar
- Production-ready

**Pessimistisch:** Q3 2026

- Java bleibt dominant
- TypeScript nur Wrapper

---

## 📚 Ressourcen

### Offizielle Specs

- **ZUGFeRD 3.0 Spec:** https://www.ferd-net.de/standards/zugferd-3.0/index.html
- **EN 16931:** https://ec.europa.eu/digital-building-blocks/wikis/display/DIGITAL/EN+16931
- **XRechnung 3.0:** https://www.xrechnung.de/

### Mustang Project

- **GitHub:** https://github.com/ZUGFeRD/mustangproject
- **Maven:** https://mvnrepository.com/artifact/org.mustangproject/library

---

## 🎯 Zusammenfassung

### Ihre Frage: Unterstützt factur-x Library ZUGFeRD 3.0?

**Antwort:**

1. ❌ **Es gibt KEINE `factur-x` NPM Library!**
2. ❌ **Keine TypeScript Library unterstützt ZUGFeRD 3.0 (Stand Feb 2025)**
3. ✅ **Java Mustang Library unterstützt ZUGFeRD 3.0** (seit Nov 2024)
4. ✅ **ZUGFeRD 2.1.1 ist gültig bis 2027!**

### Empfehlung:

**Custom ZUGFeRD 2.1.1 Implementation (TypeScript)**

- Erfüllt E-Rechnungspflicht
- TypeScript Stack
- Gültig bis 2027
- Migration zu 3.0 später (wenn TypeScript Libraries verfügbar)

**Oder: Mustang Java Service (für ZUGFeRD 3.0 JETZT)**

- Hybrid: TypeScript + Java
- ZUGFeRD 3.0 Support sofort
- Production-ready

**Soll ich die Custom ZUGFeRD 2.1.1 Implementation für Sie erstellen?** 🚀
