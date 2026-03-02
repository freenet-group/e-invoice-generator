# B2GXmlInvoiceTransformer — Algorithmus-Dokumentation

## Überblick

Der `B2GXmlInvoiceTransformer` transformiert MCBS XML-Rechnungen mit 4-stelligen Netto-Beträgen
in das B2G-konforme Format mit 2-stelligen Beträgen. Rundungsdifferenzen werden dabei mathematisch
korrekt ausgeglichen, sodass das Gesamt-Brutto der transformierten Rechnung exakt mit dem Original
übereinstimmt.

---

## Datenstrukturen

| Feld | Typ | Beschreibung |
|------|-----|--------------|
| `originalPrices` | `Map<Percentage, Price>` | 4-stellige Netto-Preise je USt-Satz |
| `roundupPrices` | `Map<Percentage, Price>` | Auf 2 Stellen gerundete Netto-Preise je USt-Satz |
| `documentLevelChargeVatMap` | `Map<Percentage, Price>` | Berechnete Korrekturbeträge je USt-Satz |
| `originalTotalNet` | `Price` | Summe aller originalen Netto-Beträge |
| `originalTotalVat` | `Price` | Summe aller originalen USt-Beträge |
| `roundedTotalNet` | `Price` | Summe aller gerundeten Netto-Beträge |
| `roundedTotalVat` | `Price` | Summe aller gerundeten USt-Beträge |
| `additionalDiffVatsAmount` | `Price` | Verbleibende Netto-Differenz nach USt-Korrektur |

---

## Verarbeitungsschritte

### Schritt 1 — BillItems runden (`processBillItemGroup`)

Für jedes `BILLITEM` in der XML-Struktur `FRAMES → AREA → UNIT → SECTION → BILLITEM_GRP → BILLITEM`:

```
chargeNodePriceRounded = chargeNodePrice.setPrecision(2, HALF_UP)
```

- `VAT_RATE = INCLUDED` → Betrag wird zu `originalTotalInsepGross` / `unitInsepGross` addiert
- `VAT_RATE = <Prozentsatz>` → Betrag wird in beide Maps eingetragen:
  - `originalPrices[vatRate] += originalCharge`
  - `roundupPrices[vatRate] += roundedCharge`

Subtotals werden laufend akkumuliert:
- `billItemGroupSubtotalRounded`
- `unitSubtotalRounded`
- `chargeSubtotalRounded`
- `sectionSubtotalRounded`

---

### Schritt 2 — Gesamtsummen berechnen (`createTotalAmounts`)

```
originalTotalNet = Σ originalPrices[vatRate]
originalTotalVat = Σ (originalPrices[vatRate] × vatRate).setPrecision(2)

roundedTotalNet  = Σ roundupPrices[vatRate]
roundedTotalVat  = Σ (roundupPrices[vatRate] × vatRate).setPrecision(2)
```

---

### Schritt 3 — Prüfung der Gesamtsummen (`checkTotalSum`)

Die berechneten `originalTotalNet`, `originalTotalVat` und `originalTotalInsepGross` werden mit
den im XML hinterlegten `AMOUNTS`-Elementen verglichen. Bei Abweichung wird eine
`TransformException` geworfen.

---

### Schritt 4 — Korrekturbeträge berechnen (`computeCorrectionRates`)

Dies ist der mathematische Kern des Algorithmus.

**Eingangsdifferenzen:**
```
originalTotal        = originalTotalNet + originalTotalVat
roundedTotal         = roundedTotalNet  + roundedTotalVat

diffNetOrigToRounded = originalTotalNet - roundedTotalNet   // Netto-Differenz
diffVatOrigToRounded = originalTotal    - roundedTotal      // Brutto-Differenz
```

**Für jeden USt-Satz:**

```
differenceAmount = originalPrice[vatRate] - roundedPrice[vatRate]

diffAsPercent    = (differenceAmount / diffNetOrigToRounded) × 100

correctionByVatRate = diffVatOrigToRounded
                      × diffAsPercent / 100
                      ÷ (1 + vatRate)          // Brutto → Netto
                      × sign                   // Vorzeichen beibehalten
```

**Feinkorrektur (while-Schleife):**

Der korrigierte USt-Betrag muss exakt dem originalen USt-Betrag entsprechen.
Cent-Differenzen werden iterativ korrigiert:

```
while (roundedPrice + correctionByVatRate) × vatRate ≠ origVatRateAmount:
    correctedNetPriceDiff    = correctedVatPriceDiff ÷ (1 + vatRate)
    correctionByVatRate     -= correctedNetPriceDiff
```

**Restdifferenz:**
```
additionalDiffVatsAmount += differenceAmount - correctionByVatRate
```

Falls nach allen USt-Sätzen noch eine Restdifferenz verbleibt, wird diese
dem `documentLevelChargeVatMap` unter `vatRate = 0%` zugeordnet.

---

### Schritt 5 — `DOCUMENT_LEVEL_CHARGES` schreiben (`processDocumentLevelAmounts`)

Für jeden Eintrag in `documentLevelChargeVatMap`:

- `correctionByVatRate > 0` → `DOCUMENT_LEVEL_CHARGE`
- `correctionByVatRate < 0` → `DOCUMENT_LEVEL_ALLOWENCE`

Jedes Element enthält:
```xml
<DOCUMENT_LEVEL_CHARGE>
    <CHARGE>0,12</CHARGE>
    <VAT_RATE>19</VAT_RATE>
    <REASON>Ausgleich der Rundungsdifferenz auf Grund zweistelliger Nettobeträge</REASON>
</DOCUMENT_LEVEL_CHARGE>
```

Die Gesamtsummen werden in `AMOUNTS` eingetragen:
- `TOTAL_DOCUMENT_LEVEL_CHARGES`
- `TOTAL_DOCUMENT_LEVEL_ALLOWENCES`

---

### Schritt 6 — `DIFF_VATS` anpassen (`adjustDiffVats`)

Für jeden `DIFF_VAT`-Eintrag:

```
adjustedNet = roundupPrices[vatRate] + documentLevelChargeVatMap[vatRate]
adjustedVat = gross(adjustedNet, vatRate) - adjustedNet
```

Falls `vatRate = 0%` und `additionalDiffVatsAmount ≠ 0`:
```
adjustedNet += additionalDiffVatsAmount
```

Falls kein `DIFF_VAT` mit `vatRate = 0%` existiert aber `additionalDiffVatsAmount ≠ 0`:
→ Neues `DIFF_VAT`-Element wird erzeugt und eingefügt.

**Abschlusskontrolle:**
```
Σ NET aus DIFF_VATs = originalTotalNet  ← sonst TransformException
Σ VAT aus DIFF_VATs = originalTotalVat  ← sonst TransformException
```

---

## Gesamtablauf

```
┌─────────────────────────────────────────────────────────────┐
│ processFramesElement()                                      │
│   └─ BillItems iterieren                                    │
│       ├─ Charge auf 2 Stellen runden (HALF_UP)             │
│       ├─ originalPrices[vatRate] += original               │
│       └─ roundupPrices[vatRate]  += gerundet               │
└──────────────────────┬──────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────┐
│ createTotalAmounts()                                        │
│   └─ originalTotalNet/Vat, roundedTotalNet/Vat berechnen   │
└──────────────────────┬──────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────┐
│ checkTotalSum()                                             │
│   └─ Summen gegen XML-AMOUNTS validieren                    │
└──────────────────────┬──────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────┐
│ computeCorrectionRates()                                    │
│   └─ Je vatRate: anteiligen Korrekturbetrag berechnen      │
│       └─ while: USt-Cent-Genauigkeit sicherstellen         │
│   └─ Restdifferenz → additionalDiffVatsAmount              │
└──────────────────────┬──────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────┐
│ adjustFramesAmounts()                                       │
│   └─ TOTAL_NET, SEF_SUM, INSEP_GROSS auf 2 Stellen runden  │
└──────────────────────┬──────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────┐
│ adjustDiffVats()                                            │
│   └─ NET/VAT je DIFF_VAT aktualisieren                     │
│   └─ Restdifferenz auf vatRate=0% buchen                   │
│   └─ Finale Validierung: Σ NET = originalTotalNet          │
└──────────────────────┬──────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────┐
│ processDocumentLevelAmounts()                               │
│   └─ DOCUMENT_LEVEL_CHARGES / ALLOWENCES schreiben         │
│   └─ TOTAL_DOCUMENT_LEVEL_CHARGES in AMOUNTS eintragen     │
└─────────────────────────────────────────────────────────────┘
```

---

## Konstanten

| Konstante | Wert | Bedeutung |
|-----------|------|-----------|
| `B2G_INVOICE_PRECISION` | `2` | Ziel-Nachkommastellen für Ausgabe |
| `BILL_TOTALNET_VAT_CALCULATE_PRECISION` | `6` | Interne Rechengenauigkeit |

---

## Fehlerbehandlung

| Situation | Verhalten |
|-----------|-----------|
| XML-Dokument leer | Leerer String wird zurückgegeben |
| `originalTotalNet = 0` | Korrekturberechnung wird übersprungen |
| Berechnetes `TOTAL_NET` ≠ XML-Wert | `TransformException` |
| Berechnetes `TOTAL_VAT` ≠ XML-Wert | `TransformException` |
| `Σ DIFF_VAT NET` ≠ `originalTotalNet` | `TransformException` |
| `Σ DIFF_VAT VAT` ≠ `originalTotalVat` | `TransformException` |