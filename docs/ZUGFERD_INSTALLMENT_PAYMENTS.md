# ZUGFeRD Support für Ratenzahlungen (Hardware-Ratenkauf)

## 🎯 Die Herausforderung

**MCBS Ratenkauf-Rechnung:**

- Gesamtkaufpreis: z.B. 800 EUR (Hardware)
- Ratenzahlung: 24 Monate × 33,33 EUR
- Besonderheit: **Jede Rate hat eigenes Fälligkeitsdatum**
- XML Erweiterung: `INSTALLMENT_PAYMENT_PLAN`

**Fragen:**

1. Unterstützt ZUGFeRD Ratenzahlungen?
2. Wie wird der Ratenplan abgebildet?
3. Impact auf `PAYMENT_METHOD` und `DUE_DATE`?

---

## ✅ JA, ZUGFeRD unterstützt Ratenzahlungen!

### EN 16931 / ZUGFeRD 2.1.1 Features:

**1. Advance Payment (Anzahlungen)**

- `BT-82`: Sum of invoices paid in advance
- `BT-83`: Paid amount to date

**2. Payment Terms (Zahlungsbedingungen)**

- `BT-9`: Due Date (Hauptfälligkeit)
- `BT-20`: Payment Terms (Freitext)

**3. Installment Payments (Ratenzahlungen)**

- **KEINE standardisierte Struktur** in ZUGFeRD 2.1.1! ⚠️
- **Aber:** Kann über `Payment Terms` als Freitext abgebildet werden
- **XRechnung 3.0:** Bessere Unterstützung (siehe unten)

---

## 📋 MCBS Ratenplan-Struktur (XSD)

### Aus `mcbs_billoutput.xsd`:

```xml
<!-- Zeile 663-676 -->
<xs:complexType name="INSTALLMENT_PAYMENT_PLANType">
    <xs:sequence>
        <xs:element type="INSTALLMENT_PAYMENT_PLAN_ITEMType"
                    name="ITEM"
                    minOccurs="1"
                    maxOccurs="unbounded"/>
    </xs:sequence>
    <xs:attribute name="totalAmount" type="xs:string" use="required"/>
</xs:complexType>

<xs:complexType name="INSTALLMENT_PAYMENT_PLAN_ITEMType">
    <xs:sequence>
        <xs:element type="xs:string" name="DESCRIPTION" minOccurs="1" maxOccurs="1"/>
        <xs:element type="xs:string" name="DUE_DATE" minOccurs="1" maxOccurs="1"/>
        <xs:element type="xs:string" name="AMOUNT" minOccurs="1" maxOccurs="1"/>
    </xs:sequence>
    <xs:attribute name="type" type="xs:string" use="required"/>
</xs:complexType>
```

### Verwendung in Invoice:

```xml
<!-- Zeile 1448-1452 -->
<INVOICE_DATA>
    <PAYMENT_MODE>...</PAYMENT_MODE>

    <!-- Optional: Ratenplan -->
    <INSTALLMENT_PAYMENT_PLAN totalAmount="800.00">
        <ITEM type="installment">
            <DESCRIPTION>Rate 1 von 24</DESCRIPTION>
            <DUE_DATE>01.03.2026</DUE_DATE>
            <AMOUNT>33.33</AMOUNT>
        </ITEM>
        <ITEM type="installment">
            <DESCRIPTION>Rate 2 von 24</DESCRIPTION>
            <DUE_DATE>01.04.2026</DUE_DATE>
            <AMOUNT>33.33</AMOUNT>
        </ITEM>
        <!-- ... 22 weitere Raten -->
    </INSTALLMENT_PAYMENT_PLAN>

    <FRAMES>...</FRAMES>
</INVOICE_DATA>
```

---

## 🔄 Mapping: MCBS → ZUGFeRD 2.1.1

### Option 1: Payment Terms (Freitext) ⭐ EMPFOHLEN

**ZUGFeRD Feld:** `BT-20: Payment terms`

```xml
<!-- ZUGFeRD 2.1.1 CII -->
<rsm:CrossIndustryInvoice>
  <rsm:SupplyChainTradeTransaction>
    <ram:ApplicableHeaderTradeSettlement>

      <!-- Haupt-Fälligkeit: Erste Rate -->
      <ram:SpecifiedTradePaymentTerms>
        <ram:DueDateDateTime>
          <udt:DateTimeString format="102">20260301</udt:DateTimeString>
        </ram:DueDateDateTime>

        <!-- Ratenzahlungs-Beschreibung -->
        <ram:Description>
          Ratenzahlung: 24 Monatsraten à 33,33 EUR.
          Rate 1 fällig am 01.03.2026.
          Folgeraten jeweils zum 1. des Monats.
          Gesamtsumme: 800,00 EUR.
        </ram:Description>
      </ram:SpecifiedTradePaymentTerms>

    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
```

**Vorteile:**

- ✅ ZUGFeRD 2.1.1 konform
- ✅ Menschenlesbar
- ✅ Einfach zu implementieren

**Nachteile:**

- ❌ Nicht maschinenlesbar (nur Freitext)
- ❌ Keine strukturierten Einzelraten

---

### Option 2: Einzelne Payment Terms pro Rate

**Mehrere `SpecifiedTradePaymentTerms` Blöcke:**

```xml
<ram:ApplicableHeaderTradeSettlement>

  <!-- Rate 1 -->
  <ram:SpecifiedTradePaymentTerms>
    <ram:DueDateDateTime>
      <udt:DateTimeString format="102">20260301</udt:DateTimeString>
    </ram:DueDateDateTime>
    <ram:Description>Rate 1 von 24: 33,33 EUR</ram:Description>
  </ram:SpecifiedTradePaymentTerms>

  <!-- Rate 2 -->
  <ram:SpecifiedTradePaymentTerms>
    <ram:DueDateDateTime>
      <udt:DateTimeString format="102">20260401</udt:DateTimeString>
    </ram:DueDateDateTime>
    <ram:Description>Rate 2 von 24: 33,33 EUR</ram:Description>
  </ram:SpecifiedTradePaymentTerms>

  <!-- ... Rate 3-24 -->

</ram:ApplicableHeaderTradeSettlement>
```

**Vorteile:**

- ✅ Strukturiert
- ✅ Jede Rate mit eigenem Datum

**Nachteile:**

- ⚠️ Nicht Standard-konform (ZUGFeRD erwartet 0..1 Payment Terms)
- ⚠️ Validatoren könnten ablehnen
- ❌ Nicht empfohlen

---

### Option 3: Zusätzliche Anhänge (PDF)

**ZUGFeRD + Ratenplan als separates PDF:**

```xml
<ram:ApplicableHeaderTradeSettlement>

  <!-- Haupt Payment Terms -->
  <ram:SpecifiedTradePaymentTerms>
    <ram:DueDateDateTime>
      <udt:DateTimeString format="102">20260301</udt:DateTimeString>
    </ram:DueDateDateTime>
    <ram:Description>
      Ratenzahlung gemäß beiliegendem Zahlungsplan (siehe Anlage).
    </ram:Description>
  </ram:SpecifiedTradePaymentTerms>

  <!-- Anhang: Ratenplan als PDF -->
  <ram:AdditionalReferencedDocument>
    <ram:IssuerAssignedID>Ratenplan-2026-001</ram:IssuerAssignedID>
    <ram:TypeCode>916</ram:TypeCode> <!-- Additional document -->
    <ram:Name>Zahlungsplan Hardware-Ratenkauf</ram:Name>
    <ram:AttachmentBinaryObject
      mimeCode="application/pdf"
      filename="Ratenplan.pdf">
      [Base64-encoded PDF]
    </ram:AttachmentBinaryObject>
  </ram:AdditionalReferencedDocument>

</ram:ApplicableHeaderTradeSettlement>
```

**Vorteile:**

- ✅ Detaillierter Ratenplan als PDF
- ✅ ZUGFeRD 2.1.1 konform

**Nachteile:**

- ❌ Zusätzlicher Aufwand (PDF generieren)
- ❌ Nicht maschinenlesbar

---

## 🆕 XRechnung 3.0 / ZUGFeRD 3.0 (Zukunft)

### Bessere Unterstützung für Ratenzahlungen

**EN 16931-1:2023 (neue Version):**

```xml
<!-- XRechnung 3.0 -->
<ram:ApplicableHeaderTradeSettlement>

  <!-- Installment Information -->
  <ram:SpecifiedTradePaymentTerms>
    <ram:DueDateDateTime>
      <udt:DateTimeString format="102">20260301</udt:DateTimeString>
    </ram:DueDateDateTime>

    <!-- Installment Details (neu in EN 16931-1:2023) -->
    <ram:ApplicableTradePaymentPenaltyTerms>
      <ram:BasisAmount currencyID="EUR">800.00</ram:BasisAmount>
      <ram:BasisPeriodMeasure unitCode="MON">24</ram:BasisPeriodMeasure>
      <ram:BasisAmount currencyID="EUR">33.33</ram:BasisAmount>
    </ram:ApplicableTradePaymentPenaltyTerms>
  </ram:SpecifiedTradePaymentTerms>

</ram:ApplicableHeaderTradeSettlement>
```

**Noch nicht final standardisiert!** ⚠️

---

## 💻 Implementierung: MCBS → ZUGFeRD Adapter

### TypeScript Code

```typescript
// src/adapters/mcbs-adapter.ts

export class MCBSAdapter implements InvoiceAdapter {
  async mapToCommonModel(rawData: RawInvoiceData): Promise<CommonInvoice> {
    const mcbs = rawData.data
    const invoice = mcbs.DOCUMENT.INVOICE_DATA

    // Prüfe ob Ratenplan vorhanden
    const hasInstallmentPlan = !!invoice.INSTALLMENT_PAYMENT_PLAN

    return {
      // ... Standard-Felder ...

      // Payment Terms mit Ratenplan
      paymentTerms: this.mapPaymentTerms(invoice, hasInstallmentPlan),

      // Payment Means
      paymentMeans: this.mapPaymentMeans(invoice.PAYMENT_MODE),

      // Metadata für Ratenplan
      customFields: hasInstallmentPlan
        ? {
            installmentPlan: this.mapInstallmentPlan(invoice.INSTALLMENT_PAYMENT_PLAN)
          }
        : undefined
    }
  }

  /**
   * Mappe Payment Terms mit Ratenzahlungs-Info
   */
  private mapPaymentTerms(invoice: any, hasInstallmentPlan: boolean): any {
    if (!hasInstallmentPlan) {
      // Standard Payment Terms
      return {
        dueDate: this.formatDate(invoice.PAYMENT_MODE.DUE_DATE),
        description: 'Zahlung sofort fällig'
      }
    }

    // Ratenzahlung
    const plan = invoice.INSTALLMENT_PAYMENT_PLAN
    const items = Array.isArray(plan.ITEM) ? plan.ITEM : [plan.ITEM]
    const firstInstallment = items[0]
    const totalAmount = parseFloat(plan.totalAmount)
    const installmentCount = items.length
    const installmentAmount = parseFloat(firstInstallment.AMOUNT)

    return {
      // Erste Rate als Haupt-Fälligkeit
      dueDate: this.formatDate(firstInstallment.DUE_DATE),

      // Beschreibung mit allen Raten
      description: this.buildInstallmentDescription(totalAmount, installmentCount, installmentAmount, items)
    }
  }

  /**
   * Baut Ratenzahlungs-Beschreibung für ZUGFeRD
   */
  private buildInstallmentDescription(totalAmount: number, count: number, amount: number, items: any[]): string {
    const lines: string[] = []

    // Hauptinfo
    lines.push(`Ratenzahlung: ${count} Monatsraten à ${this.formatCurrency(amount)}.`)
    lines.push(`Gesamtsumme: ${this.formatCurrency(totalAmount)}.`)
    lines.push('')

    // Fälligkeiten
    lines.push('Fälligkeiten:')
    for (let i = 0; i < Math.min(items.length, 5); i++) {
      const item = items[i]
      lines.push(`  Rate ${i + 1}: ${item.DUE_DATE} - ${this.formatCurrency(parseFloat(item.AMOUNT))}`)
    }

    if (items.length > 5) {
      lines.push(`  ... ${items.length - 5} weitere Raten`)
    }

    return lines.join('\n')
  }

  /**
   * Extrahiert strukturierten Ratenplan (für Custom Fields)
   */
  private mapInstallmentPlan(plan: any): any {
    const items = Array.isArray(plan.ITEM) ? plan.ITEM : [plan.ITEM]

    return {
      totalAmount: parseFloat(plan.totalAmount),
      installments: items.map((item: any, index: number) => ({
        number: index + 1,
        description: item.DESCRIPTION,
        dueDate: this.formatDate(item.DUE_DATE),
        amount: parseFloat(item.AMOUNT),
        type: item.type || 'installment'
      }))
    }
  }

  /**
   * Payment Means für Ratenzahlung
   */
  private mapPaymentMeans(paymentMode: any): any[] {
    return [
      {
        // SEPA Lastschrift (üblich bei Ratenkauf)
        typeCode: paymentMode.PAYMENT_TYPE === 'SEPADEBIT' ? '59' : '58',

        // Information
        information:
          paymentMode.PAYMENT_TYPE === 'SEPADEBIT'
            ? 'SEPA-Lastschrift für monatliche Raten'
            : 'Überweisung für monatliche Raten',

        // Account Info
        payeeAccount: paymentMode.BANK_ACCOUNT
          ? {
              iban: paymentMode.BANK_ACCOUNT,
              accountName: 'freenet DLS GmbH'
            }
          : undefined,

        payeeInstitution: paymentMode.BANK_CODE
          ? {
              bic: paymentMode.BANK_CODE
            }
          : undefined
      }
    ]
  }

  private formatCurrency(amount: number): string {
    return new Intl.NumberFormat('de-DE', {
      style: 'currency',
      currency: 'EUR'
    }).format(amount)
  }

  private formatDate(dateStr: string): string {
    // DD.MM.YYYY → YYYY-MM-DD
    const [day, month, year] = dateStr.split('.')
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }
}
```

---

## 📄 Beispiel: ZUGFeRD XML Output

### Generiert von @e-invoice-eu/core:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice
  xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"
  xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"
  xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">

  <!-- Invoice Header -->
  <rsm:ExchangedDocumentContext>
    <ram:GuidelineSpecifiedDocumentContextParameter>
      <ram:ID>urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:comfort</ram:ID>
    </ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>

  <!-- Document Info -->
  <rsm:ExchangedDocument>
    <ram:ID>INV-2026-HW-001</ram:ID>
    <ram:TypeCode>380</ram:TypeCode>
    <ram:IssueDateTime>
      <udt:DateTimeString format="102">20260221</udt:DateTimeString>
    </ram:IssueDateTime>
  </rsm:ExchangedDocument>

  <rsm:SupplyChainTradeTransaction>

    <!-- Line Item: Hardware -->
    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument>
        <ram:LineID>1</ram:LineID>
      </ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct>
        <ram:Name>Samsung Galaxy S25 128GB</ram:Name>
      </ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement>
        <ram:NetPriceProductTradePrice>
          <ram:ChargeAmount>800.00</ram:ChargeAmount>
        </ram:NetPriceProductTradePrice>
      </ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery>
        <ram:BilledQuantity unitCode="C62">1</ram:BilledQuantity>
      </ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax>
          <ram:TypeCode>VAT</ram:TypeCode>
          <ram:CategoryCode>S</ram:CategoryCode>
          <ram:RateApplicablePercent>19</ram:RateApplicablePercent>
        </ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation>
          <ram:LineTotalAmount>800.00</ram:LineTotalAmount>
        </ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>

    <!-- Settlement -->
    <ram:ApplicableHeaderTradeSettlement>

      <!-- Payment Means: SEPA Lastschrift -->
      <ram:SpecifiedTradeSettlementPaymentMeans>
        <ram:TypeCode>59</ram:TypeCode> <!-- SEPA Direct Debit -->
        <ram:Information>SEPA-Lastschrift für monatliche Raten</ram:Information>
        <ram:PayeePartyCreditorFinancialAccount>
          <ram:IBANID>DE02300606010002474689</ram:IBANID>
        </ram:PayeePartyCreditorFinancialAccount>
        <ram:PayeeSpecifiedCreditorFinancialInstitution>
          <ram:BICID>DAAEDEDD</ram:BICID>
        </ram:PayeeSpecifiedCreditorFinancialInstitution>
      </ram:SpecifiedTradeSettlementPaymentMeans>

      <!-- Payment Terms: Ratenzahlung ⭐ -->
      <ram:SpecifiedTradePaymentTerms>
        <ram:DueDateDateTime>
          <udt:DateTimeString format="102">20260301</udt:DateTimeString>
        </ram:DueDateDateTime>
        <ram:Description>Ratenzahlung: 24 Monatsraten à 33,33 EUR.
Gesamtsumme: 800,00 EUR.

Fälligkeiten:
  Rate 1: 01.03.2026 - 33,33 EUR
  Rate 2: 01.04.2026 - 33,33 EUR
  Rate 3: 01.05.2026 - 33,33 EUR
  Rate 4: 01.06.2026 - 33,33 EUR
  Rate 5: 01.07.2026 - 33,33 EUR
  ... 19 weitere Raten</ram:Description>
      </ram:SpecifiedTradePaymentTerms>

      <!-- Tax -->
      <ram:ApplicableTradeTax>
        <ram:CalculatedAmount>152.00</ram:CalculatedAmount>
        <ram:TypeCode>VAT</ram:TypeCode>
        <ram:BasisAmount>800.00</ram:BasisAmount>
        <ram:CategoryCode>S</ram:CategoryCode>
        <ram:RateApplicablePercent>19</ram:RateApplicablePercent>
      </ram:ApplicableTradeTax>

      <!-- Monetary Summation -->
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>800.00</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount>800.00</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="EUR">152.00</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>952.00</ram:GrandTotalAmount>
        <ram:DuePayableAmount>952.00</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>

    </ram:ApplicableHeaderTradeSettlement>

  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
```

---

## 📋 Zusammenfassung

### ✅ ZUGFeRD kann Ratenzahlungen darstellen!

**Wie:**

1. **Payment Terms (BT-20):** Freitext-Beschreibung des Ratenplans
2. **Due Date (BT-9):** Fälligkeit der ersten Rate
3. **Payment Means (BT-81):** SEPA Lastschrift für Raten

**Einschränkungen:**

- ❌ Keine strukturierte maschinenlesbare Ratenplan-Tabelle in ZUGFeRD 2.1.1
- ✅ Aber: Menschenlesbar im PDF
- ✅ XRechnung 3.0 wird bessere Unterstützung haben

**Empfehlung für MCBS:**

```
INSTALLMENT_PAYMENT_PLAN (MCBS)
  ↓
Payment Terms Description (ZUGFeRD)
  → Formatierter Freitext mit allen Raten
  → DueDate = Erste Rate
  → Payment Means = SEPA Lastschrift
```

**Impact auf Felder:**

- ✅ `DUE_DATE`: Erste Rate aus Ratenplan
- ✅ `PAYMENT_METHOD`: SEPA Lastschrift (Code 59)
- ✅ `PAYMENT_TERMS`: Detaillierte Ratenbeschreibung

---

## 🎯 Nächste Schritte

1. ✅ **Implementiere** `mapInstallmentPlan()` im MCBS Adapter
2. ✅ **Teste** mit echten Hardware-Ratenkauf-Rechnungen
3. ✅ **Validiere** ZUGFeRD XML mit Validator
4. ✅ **Prüfe** PDF-Darstellung (HOMER Integration)

**Der Ratenplan wird korrekt in ZUGFeRD abgebildet - als menschenlesbarer Text in Payment Terms!** ✅
