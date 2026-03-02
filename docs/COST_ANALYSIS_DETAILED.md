# 💰 Detaillierte Kostenanalyse: MCBS ZUGFeRD Converter

## 📊 Basis-Annahmen

```
Rechnungen: 250.000 pro Tag
Monat:      30 Tage
Total:      7.500.000 Rechnungen/Monat
```

---

## 💸 AWS Lambda Kosten (Detailliert)

### Pricing-Basis (AWS Frankfurt - eu-central-1)

```
Lambda Free Tier (permanent):
├── 1.000.000 Requests/Monat: GRATIS
└── 400.000 GB-Sekunden/Monat: GRATIS

Lambda Preise (nach Free Tier):
├── Requests: $0.0000002 pro Request
└── Compute:  $0.0000166667 pro GB-Sekunde
```

### Berechnung für EINE Lambda (All-in-One)

```
Annahmen:
├── Memory:     2 GB (2048 MB)
├── Duration:   5 Sekunden pro Rechnung (Durchschnitt)
├── Requests:   7.500.000 pro Monat
└── Region:     eu-central-1 (Frankfurt)

Schritt 1: Requests Kosten
────────────────────────────────────────────────────────
Requests:        7.500.000
Free Tier:      -1.000.000
Billable:        6.500.000

Kosten: 6.500.000 × $0.0000002 = $1.30/Monat

Schritt 2: Compute Kosten (GB-Sekunden)
────────────────────────────────────────────────────────
Pro Rechnung:    2 GB × 5 Sekunden = 10 GB-Sekunden
Total:          7.500.000 × 10 = 75.000.000 GB-Sekunden
Free Tier:      -400.000
Billable:       74.600.000 GB-Sekunden

Kosten: 74.600.000 × $0.0000166667 = $1.243.33/Monat

TOTAL Lambda: $1.30 + $1.243.33 = $1.244.63/Monat
```

**⚠️ KORREKTUR meiner vorherigen Schätzung:**
- Ich hatte ~$250/Monat gesagt
- **Tatsächlich: ~$1.245/Monat** (mit 5s Durchschnitt)

---

## 💾 AWS S3 Kosten (Detailliert)

### Pricing-Basis (S3 Standard - Frankfurt)

```
Storage (erste 50 TB/Monat):  $0.023 pro GB
PUT Requests:                 $0.005 pro 1.000 Requests
GET Requests:                 $0.0004 pro 1.000 Requests
```

### Speicher-Berechnung

```
Annahmen:
├── MCBS XML:      ~50 KB pro Datei
├── PDF (HOMER):   ~100 KB pro Datei
└── E-Invoice:     ~100 KB pro Datei (PDF/A-3 + XML)

Pro Monat (7.500.000 Rechnungen):
────────────────────────────────────────────────────────
MCBS XML:       7.500.000 × 50 KB = 375.000.000 KB
                = 357 GB × $0.023 = $8.21/Monat

PDFs:           7.500.000 × 100 KB = 750.000.000 KB
                = 714 GB × $0.023 = $16.42/Monat

E-Invoices:     7.500.000 × 100 KB = 750.000.000 KB
                = 714 GB × $0.023 = $16.42/Monat

Storage TOTAL:  1.785 GB × $0.023 = $41.05/Monat
```

### Request-Berechnung

```
PUT Requests (Write):
────────────────────────────────────────────────────────
MCBS XML:       7.500.000 PUTs (vom Billing System)
PDFs:           7.500.000 PUTs (von HOMER)
E-Invoices:     7.500.000 PUTs (von Lambda)
────────────────────────────────────────────────────────
Total PUTs:     22.500.000

Kosten: 22.500.000 / 1.000 × $0.005 = $112.50/Monat

GET Requests (Read):
────────────────────────────────────────────────────────
Lambda liest:
  - MCBS XML:   7.500.000 GETs
  - PDF:        7.500.000 GETs
────────────────────────────────────────────────────────
Total GETs:     15.000.000

Kosten: 15.000.000 / 1.000 × $0.0004 = $6.00/Monat

S3 TOTAL: $41.05 + $112.50 + $6.00 = $159.55/Monat
```

---

## 📈 AWS CloudWatch Kosten

### Pricing-Basis

```
Metrics:        $0.30 pro Custom Metric/Monat
Logs Storage:   $0.50 pro GB
Dashboards:     $3.00 pro Dashboard/Monat
Alarms:         $0.10 pro Alarm/Monat
```

### Berechnung

```
Custom Metrics:
────────────────────────────────────────────────────────
- Lambda Duration (per Invoice Type): 5 Metrics
- Lambda Errors (per Error Type):     3 Metrics
- S3 Operations:                       2 Metrics
- Processing Time:                     2 Metrics
────────────────────────────────────────────────────────
Total: 12 Metrics × $0.30 = $3.60/Monat

Logs:
────────────────────────────────────────────────────────
Pro Rechnung: ~1 KB Logs
Total:        7.500.000 × 1 KB = 7.5 GB/Monat
Retention:    7 Tage (nicht 30)
Effektiv:     ~2 GB/Monat

Kosten: 2 GB × $0.50 = $1.00/Monat

Dashboards:
────────────────────────────────────────────────────────
- Overview Dashboard:     1 × $3.00
- Performance Dashboard:  1 × $3.00
- Errors Dashboard:       1 × $3.00
────────────────────────────────────────────────────────
Total: 3 × $3.00 = $9.00/Monat

Alarms:
────────────────────────────────────────────────────────
- Error Rate Alarm:       1 × $0.10
- High Latency Alarm:     1 × $0.10
- Queue Depth Alarm:      1 × $0.10
────────────────────────────────────────────────────────
Total: 3 × $0.10 = $0.30/Monat

CloudWatch TOTAL: $3.60 + $1.00 + $9.00 + $0.30 = $13.90/Monat
```

---

## 🔄 AWS SQS Kosten (Optional für Batching)

### Pricing-Basis

```
Standard Queue: $0.40 pro 1.000.000 Requests (nach Free Tier)
Free Tier:      1.000.000 Requests/Monat
```

### Berechnung (falls verwendet)

```
Requests:
────────────────────────────────────────────────────────
Annahme: Batching mit 10 Messages pro Lambda Invocation
Messages:     7.500.000
Batches:      750.000
Free Tier:   -1.000.000 (deckt alles ab!)
────────────────────────────────────────────────────────
SQS TOTAL: $0.00/Monat (innerhalb Free Tier!)
```

---

## 💰 GESAMT-KOSTEN (Korrigiert)

```
AWS Lambda:      $1.244.63
AWS S3:          $159.55
AWS CloudWatch:  $13.90
AWS SQS:         $0.00 (Free Tier)
────────────────────────────────────────────────────────
TOTAL:           $1.418.08/Monat

Pro Rechnung:    $1.418,08 / 7.500.000 = $0.000189
                 = 0,019 Cent pro Rechnung
```

---

## 🔥 PREISTREIBER-ANALYSE

### Ranking nach Kosten:

```
1. Lambda Compute:     $1.243.33  (87,7%) ← 🔥 HAUPTTREIBER
2. S3 PUT Requests:    $112.50    (7,9%)  ← 🔥 ZWEITGRÖSSTER
3. S3 Storage:         $41.05     (2,9%)
4. CloudWatch:         $13.90     (1,0%)
5. S3 GET Requests:    $6.00      (0,4%)
6. Lambda Requests:    $1.30      (0,1%)
```

### 🎯 Der HAUPTTREIBER ist: **Lambda Compute Zeit**

---

## 📊 Lambda Kosten-Breakdown

### Was kostet WAS in Lambda?

```
Lambda Compute = Memory × Duration × Invocations

Variablen:
├── Memory:       2 GB (fest)
├── Duration:     5 Sekunden (variabel!) ← 🔥 HIER OPTIMIEREN!
└── Invocations:  7.500.000 (fest, durch Rechnungsvolumen)

Sensitivitätsanalyse:
────────────────────────────────────────────────────────
Duration    GB-Sek      Kosten      Delta
────────────────────────────────────────────────────────
2s          150M        $2.500      Baseline
3s          225M        $3.750      +50%
5s (aktuell) 750M       $12.500     +400%  ← 🔥
10s         1.500M      $25.000     +900%

Wenn wir von 5s auf 3s optimieren:
Ersparnis: $12.500 - $3.750 = $8.750/Monat (70%!)
```

---

## 🎯 Optimierungs-Potenziale

### 1. Lambda Duration reduzieren (HÖCHSTE Priorität)

```
Aktuell:    5 Sekunden
Optimiert:  3 Sekunden (realistisch)
Einsparung: ~$525/Monat (42%)

Wie?
├── PDF/XML parallel laden (statt sequentiell)
├── @e-invoice-eu/core Performance-Tuning
├── Weniger Logging
└── Code-Optimierung
```

### 2. S3 Lifecycle Policies

```
Aktuell:    Alle Daten dauerhaft in S3 Standard
Optimiert:  Nach 30 Tagen zu S3 Glacier

S3 Standard:      $0.023/GB
S3 Glacier:       $0.004/GB
────────────────────────────────────────────────────────
Nach 1 Jahr:
Standard Kosten:  1.785 GB × 12 × $0.023 = $493/Jahr
Mit Lifecycle:    1.785 GB × 1 × $0.023 + 
                  1.785 GB × 11 × $0.004 = $120/Jahr
────────────────────────────────────────────────────────
Einsparung: $373/Jahr ($31/Monat)
```

### 3. Reserved Concurrency Optimierung

```
Aktuell:    1.000 Reserved Concurrency (overprovisioniert)
Tatsächlich: ~28 concurrent (bei 5s Duration, 3 req/s)

Optimiert:  100 Reserved Concurrency
Effekt:     Keine Kosten-Änderung (nur bei Provisioned)
            Aber: Mehr Ressourcen für andere Workloads
```

### 4. S3 PUT Request Batching

```
Aktuell:    1 PUT pro E-Rechnung
Optimiert:  Batch mehrere E-Rechnungen in ZIP

Beispiel:   1.000 Rechnungen pro ZIP
PUTs:       7.500.000 / 1.000 = 7.500
Kosten:     7.500 / 1.000 × $0.005 = $0.04/Monat
────────────────────────────────────────────────────────
Einsparung: $112.50 - $0.04 = $112.46/Monat

⚠️ ABER: Komplexere Logik, langsamerer Zugriff
```

---

## 💡 Optimierte Kosten-Prognose

### Szenario: "Reasonable Optimizations"

```
Optimierungen:
├── Lambda Duration: 5s → 3s
├── S3 Lifecycle: Nach 30d zu Glacier
└── CloudWatch Logs: 7d statt 30d Retention

Neue Kosten:
────────────────────────────────────────────────────────
Lambda:       3s × 2 GB × 7.500.000 = 45M GB-Sek
              45M × $0.0000166667 = $750/Monat
S3 Storage:   $41.05 (gleich, erst nach 30d Ersparnis)
S3 Requests:  $118.50 (gleich)
CloudWatch:   $10.00 (weniger Logs)
────────────────────────────────────────────────────────
TOTAL:        ~$920/Monat (-35%)

Pro Rechnung: $0.000123 (0,012 Cent)
```

### Szenario: "Aggressive Optimizations"

```
Optimierungen:
├── Lambda Duration: 5s → 2s (aggressives Tuning)
├── Lambda Memory: 2 GB → 1 GB (weniger Speicher)
├── S3 Lifecycle: Sofort nach Verarbeitung zu Glacier
└── Batch-Processing: 10 Rechnungen pro Invocation

Neue Kosten:
────────────────────────────────────────────────────────
Lambda:       750.000 Invokes × 2s × 1 GB = 1.5M GB-Sek
              1.5M × $0.0000166667 = $25/Monat
S3 Storage:   $7.14 (Glacier)
S3 Requests:  $20 (weniger PUTs durch Batching)
CloudWatch:   $8.00
────────────────────────────────────────────────────────
TOTAL:        ~$60/Monat (-96%!)

Pro Rechnung: $0.000008 (0,0008 Cent)

⚠️ ABER: Höheres Risiko, komplexere Logik
```

---

## 📈 Skalierungs-Analyse

### Was wenn 500.000 Rechnungen/Tag?

```
Rechnungen: 15.000.000/Monat (2x)

Lambda:     15M × 5s × 2 GB = 150M GB-Sek
            150M × $0.0000166667 = $2.500/Monat

S3:         ~$320/Monat

CloudWatch: ~$15/Monat
────────────────────────────────────────────────────────
TOTAL:      ~$2.835/Monat

Skalierung: Fast linear (2x Volumen = ~2x Kosten)
```

### Breakeven-Punkt: Lambda vs. ECS

```
ECS Fargate (2 vCPU, 4 GB):
────────────────────────────────────────────────────────
24/7 Running: $60/Monat (Fix-Kosten)

Lambda Kosten für verschiedene Volumina:
────────────────────────────────────────────────────────
100k/Tag:   ~$190/Monat
250k/Tag:   ~$1.418/Monat  ← Aktuell
500k/Tag:   ~$2.835/Monat

Breakeven: Nie! Lambda wird teurer bei hohem Volumen

ABER: Lambda hat Vorteile:
├── Auto-Scaling
├── Pay-per-use (bei niedrigem Volumen günstiger)
├── Zero Maintenance
└── Serverless
```

---

## 🎯 Empfehlungen

### Kurz-/Mittelfristig:

1. **Lambda Duration optimieren** (5s → 3s)
   - Einsparung: ~$525/Monat (42%)
   - Aufwand: 1-2 Wochen
   - Priorität: HOCH

2. **S3 Lifecycle Policy**
   - Einsparung: ~$31/Monat
   - Aufwand: 1 Tag
   - Priorität: MITTEL

3. **CloudWatch Logs Retention reduzieren**
   - Einsparung: ~$4/Monat
   - Aufwand: 1 Stunde
   - Priorität: NIEDRIG

### Langfristig (bei Wachstum):

4. **Evaluiere Hybrid-Ansatz**
   - Lambda für Peak-Times
   - ECS Fargate für Baseline
   - Potenzial: -30% bei gleichbleibendem Volumen

---

## 📊 Kosten im Vergleich

### Alternative Ansätze:

```
On-Premise Server:
├── Hardware: $5.000 einmalig
├── Betrieb: $500/Monat
├── Wartung: $200/Monat
────────────────────────────────────────────────────────
Jahr 1: $13.400
Jahr 2+: $8.400/Jahr

AWS Lambda (optimiert):
────────────────────────────────────────────────────────
Jahr 1-X: $920/Monat = $11.040/Jahr

AWS ECS Fargate:
────────────────────────────────────────────────────────
Jahr 1-X: $60-150/Monat = $720-1.800/Jahr

Externe SaaS (z.B. DocRaptor):
────────────────────────────────────────────────────────
250k/Tag = 7.5M/Monat
Preis: ~$0.001 pro Rechnung
Jahr: $7.500/Monat = $90.000/Jahr
```

---

## ✅ Zusammenfassung

### Kostenstruktur (Ist-Zustand):

```
Total:           $1.418/Monat
Pro Rechnung:    0,019 Cent

Breakdown:
├── Lambda (87,7%):  $1.244  ← 🔥 HAUPTTREIBER
├── S3 (11,8%):      $160
└── Monitoring (1%): $14
```

### Haupttreiber:

1. **Lambda Compute Zeit** (87,7%)
   - Abhängig von Duration × Memory
   - Optimierungspotenzial: -40% durch Code-Tuning

2. **S3 PUT Requests** (7,9%)
   - Abhängig von Anzahl Schreibvorgänge
   - Optimierungspotenzial: -90% durch Batching

### Optimiertes Ziel:

```
Realistisch:  $920/Monat (-35%)
Aggressiv:    $60/Monat (-96%)
```

**Der Preistreiber ist Lambda Duration - jede Sekunde weniger spart ~$250/Monat!** 🎯
