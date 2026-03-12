/**
 * Common Invoice Model
 *
 * Source-agnostisches Invoice Format basierend auf EN 16931 / ZUGFeRD Comfort
 * Dient als Zwischenschicht zwischen verschiedenen Input-Formaten (MCBS XML, AWS Billing JSON)
 * und dem ZUGFeRD Output (@e-invoice-eu/core)
 */

export interface CommonInvoice {
    // ==================== Document Header ====================

    /** Rechnungsnummer (BT-1) */
    invoiceNumber: string

    /** Rechnungsdatum im Format YYYY-MM-DD (BT-2) */
    invoiceDate: string

    /** Rechnungstyp (BT-3) */
    invoiceType: InvoiceType

    /** Währung (BT-5) */
    currency: string

    /**
     * Käuferreferenz (BT-10)
     * - B2B: Freitext-Referenz des Käufers (Kostenstelle, interne Referenz)
     * - B2G: Leitweg-ID (Pflicht für öffentliche Auftraggeber, Format: 99-012345678-06)
     */
    buyerReference?: string // BT-10: Leitweg-ID (B2G) | Kundennr. (B2C) | USt-ID-Ref (B2B)

    /** Bestellreferenz des Käufers (BT-13) */
    orderReference?: string

    /** Vertragsnummer (BT-12) */
    contractReference?: string

    /** Rechnungsperiode (BG-14) */
    invoicePeriod?: {
        start: string // YYYY-MM-DD
        end: string // YYYY-MM-DD
    }

    /** Vorausgegangene Rechnungen - für Korrekturrechnungen (BT-25/BT-26) */
    precedingInvoices?: {
        reference: string // BT-25
        issueDate?: string // BT-26 YYYY-MM-DD
    }[]

    /** Dokumentenanhänge (BG-24) */
    additionalDocuments?: AdditionalDocument[]

    // ==================== Source Metadata ====================

    /** Metadata über die Datenquelle */
    source: {
        /**
         * Quellsystem
         * - MCBS: MCBS-Kundenabrechnungen
         * - AWS_BILLING: AWS-Kundenabrechnungen
         * - PARTNER_COMMISSION: Händlerprovisionsabrechnungen
         */
        system: InvoiceSource

        /** Zeitstempel der Verarbeitung */
        timestamp: string

        /**
         * Partei-ID im Quellsystem
         * - MCBS/AWS Billing: Kundennummer (PERSON_NO)
         * - Provisionsabrechnung: Händlernummer
         */
        partyId: string

        /**
         * Abrechnungskonto-ID
         * - MCBS: HEADER.INVOICE_DEF
         * - AWS Billing: Account-ID
         */
        billingAccountId: string
    }

    // ==================== Parties ====================

    /** Verkäufer / Rechnungssteller (BG-4) */
    seller: Party

    /** Käufer / Rechnungsempfänger (BG-7) */
    buyer: Party

    // ==================== Line Items ====================

    /** Rechnungspositionen (BG-25) */
    lineItems: LineItem[]

    // ==================== Payment Information ====================

    /** Zahlungsmittel (BG-16) */
    paymentMeans: PaymentMeans[]

    /** Zahlungsbedingungen (BG-20) */
    paymentTerms?: PaymentTerms

    // ==================== Tax Information ====================

    /** Steueraufteilung (BG-23) */
    taxes: Tax[]

    // ==================== Monetary Totals ====================

    /** Summen (BG-22) */
    totals: MonetaryTotals

    // ==================== Additional Information ====================

    /** PDF-Informationen */
    pdf?: PDFInfo

    /** Custom Fields (für Erweiterungen wie Ratenzahlung) */
    customFields?: Record<string, string | number | boolean | object>
}

// ==================== Enums ====================

export const INVOICE_SOURCES = <const>['MCBS', 'AWS_BILLING', 'PARTNER_COMMISSION']
export type InvoiceSource = (typeof INVOICE_SOURCES)[number]

export enum InvoiceType {
    COMMERCIAL = 'COMMERCIAL',
    CREDIT_NOTE = 'CREDIT_NOTE',
    CORRECTED = 'CORRECTED',
    SELF_BILLING = 'SELF_BILLING' // ← neu für Provisionsabrechnung (389)
}

export enum TaxCategoryCode {
    // B2B Inland
    STANDARD = 'S', // Normaler Steuersatz (19% / 7%)
    ZERO_RATED = 'Z', // Nullsatz (0%)
    EXEMPT = 'E', // Steuerbefreit (§ 4 UStG)
    OUTSIDE_SCOPE = 'O', // Nicht steuerbar (z.B. MCBS INCLUDED)

    // B2B Reverse Charge
    REVERSE_CHARGE = 'AE', // Steuerschuldumkehr (§ 13b UStG)

    // EU Ausland
    INTRA_EU = 'K', // Innergemeinschaftliche Lieferung (§ 4 Nr. 1b UStG)
    EXPORT = 'G', // Ausfuhrlieferung Drittland (§ 4 Nr. 1a UStG)

    // Sonderfälle (für spätere Erweiterungen)
    CANARY_ISLANDS = 'L', // Kanarische Inseln / Ceuta / Melilla
    MOSS = 'M' // OSS/MOSS Verfahren
}

export enum UnitCode {
    PIECE = 'PIECE',
    HOUR = 'HOUR',
    DAY = 'DAY',
    MONTH = 'MONTH',
    FLAT_RATE = 'FLAT_RATE'
}

export enum PaymentMeansCode {
    CREDIT_TRANSFER = 'CREDIT_TRANSFER',
    SEPA_DIRECT_DEBIT = 'SEPA_DIRECT_DEBIT',
    CASH = 'CASH',
    CARD = 'CARD'
}

// ==================== Supporting Types ====================

export interface Party {
    /** Name (BT-27 / BT-44) */
    name: string

    /** Postanschrift (BG-5 / BG-8) */
    postalAddress: PostalAddress

    /**
     * Umsatzsteuer-Identifikationsnummer (BT-31 Seller / BT-48 Buyer)
     * Pflicht für Comfort wenn vorhanden
     */
    vatNumber?: string

    /** Steuerregistrierung (nur Seller) (BG-11) */
    taxRegistration?: TaxRegistration[]

    /** Elektronische Adresse (BT-34 / BT-49) */
    electronicAddress?: ElectronicAddress

    /** Kontaktinformationen (nur Seller) (BG-6) */
    contact?: Contact

    /** Rechtliche Registrierung (nur Seller) */
    legalOrganization?: LegalOrganization

    /** SEPA-Gläubiger-ID (nur Seller, für SEPA-Lastschrift) */
    creditorId?: string
}

export interface PostalAddress {
    /** Straßenname (BT-35 / BT-50) */
    streetName?: string

    /** Hausnummer (BT-163 / BT-164) */
    buildingNumber?: string

    /** Zusätzliche Adresszeile (BT-36 / BT-51) */
    addressLine?: string

    /** Postleitzahl (BT-38 / BT-53) */
    postalCode: string

    /** Stadt (BT-37 / BT-52) */
    cityName: string

    /** Ländercode (BT-40 / BT-55) */
    countryCode: string
}

export interface TaxRegistration {
    id: {
        /** USt-IdNr oder Steuernummer */
        value: string

        /** Schema: 'VA' für VAT, 'FC' für Tax Number */
        schemeId: string
    }
}

export interface ElectronicAddress {
    /** E-Mail oder andere elektronische Adresse */
    value: string

    /** Schema: 'EM' für Email */
    schemeId: string
}

export interface Contact {
    /** Kontaktperson */
    name?: string

    /** Telefonnummer */
    telephone?: string

    /** E-Mail */
    email?: string
}

export interface LegalOrganization {
    /** Handelsname */
    tradingBusinessName?: string

    /** Handelsregisternummer */
    id?: {
        value: string
        schemeId: string
    }
}

export interface LineItem {
    /** Positionsnummer (BT-126) */
    id: number

    /** Bezeichnung (BT-153) */
    name: string

    /** Beschreibung (BT-154) */
    description?: string

    /** Menge (BT-129) */
    quantity: number

    /** Einheitencode (BT-130) */
    unitCode: UnitCode

    /** Einzelpreis (BT-146) */
    unitPrice: number

    /** Nettobetrag (BT-131) */
    netAmount: number

    /** Steuerinformationen */
    tax: {
        /** Steuerart (BT-151) */
        typeCode: string

        /** Steuerkategorie (BT-151) */
        categoryCode: TaxCategoryCode

        /** Steuersatz in % (BT-152) */
        rate: number
    }

    /**
     * Vertragsnummer pro Position (BT-12 auf Positionsebene)
     * Bei Telko: eine Vertragsnummer pro Anschluss
     */
    contractReference?: string

    /**
     * Teilnehmer-/Anschlussinformationen (als Freitext-Attribut)
     * Relevant für Telko: mehrere Anschlüsse auf einer Rechnung
     */
    subscriberInfo?: {
        phoneNumber?: string
        name?: string
        /** Mobilfunknetz (z.B. VF, DT) — nur bei TELCO */
        network?: string
        /** Tarifbezeichnung — nur bei TELCO */
        tariff?: string
    }

    contentProvider?: {
        contact?: string
        services?: string
    }

    /** Abrechnungszeitraum pro Position (BG-26) */
    period?: {
        start?: string // YYYY-MM-DD
        end?: string // YYYY-MM-DD
    }
}

export interface PaymentMeans {
    /** Zahlungsmittel-Code (BT-81) */
    typeCode: PaymentMeansCode

    /** Zusätzliche Informationen (BT-82) */
    information?: string

    /** Kontoinhaber-Konto (BG-17) */
    payeeAccount?: {
        /** IBAN (BT-84) */
        iban?: string

        /** Kontoname (BT-85) */
        accountName?: string
    }

    /** Finanzinstitut (BG-18) */
    payeeInstitution?: {
        /** BIC (BT-86) */
        bic?: string
    }

    /** Kreditkarte (BG-18 / BT-87) – nur bei typeCode CARD */
    card?: {
        /** Primäre Kontonummer der Zahlungskarte, i.d.R. letzte 4 Stellen (BT-87) */
        primaryAccountNumber?: string
        /** Name des Karteninhabers (BT-88) */
        holderName?: string
    }

    /** SEPA Mandat (optional) */
    mandate?: {
        /** Mandatsreferenz */
        reference?: string
        /** Creditor-ID (BT-90) */
        creditorReferenceId?: string
    }
}

export interface PaymentTerms {
    /** Fälligkeitsdatum (BT-9) */
    dueDate?: string

    /** Zahlungsbedingungen (BT-20) */
    description?: string

    /** Skonto (optional) (BG-20) */
    discount?: {
        /** Skontobetrag */
        amount?: number

        /** Skontofrist in Tagen */
        daysFromIssueDate?: number
    }
}

export interface Tax {
    /** Steuerart (BT-118) */
    typeCode: string

    /** Steuerkategorie (BT-118) */
    categoryCode: TaxCategoryCode

    /** Steuersatz in % (BT-119) */
    rate: number

    /** Steuerbemessungsgrundlage (BT-116) */
    basisAmount: number

    /** Steuerbetrag (BT-117) */
    calculatedAmount: number
}

export interface MonetaryTotals {
    lineTotal: number
    taxBasisTotal: number
    taxTotal: number
    grandTotal: number
    /**
     * Vorauszahlungen / Guthaben / offene Posten
     * Positiv = Guthaben (Kunde hat zuviel gezahlt)
     * Negativ = Rückstand (offene unbezahlte Rechnungen)
     * duePayable = grandTotal - totalPrepaidAmount
     */
    totalPrepaidAmount?: number
    duePayable: number
}

export interface PDFInfo {
    /** S3 Key (für MCBS Legacy) */
    s3Key?: string

    /** S3 Bucket Name */
    s3Bucket?: string
}

// ==================== Neu für Comfort ====================

export interface AdditionalDocument {
    /** Dokumenten-ID (BT-122) */
    id: string

    /** Beschreibung (BT-123) */
    description?: string

    /** Eingebettetes Dokument (BT-125) */
    attachment?: {
        /** Base64-kodierter Inhalt */
        content: string
        /** MIME-Type z.B. 'application/pdf' */
        mimeCode: string
        /** Dateiname */
        filename: string
    }

    /** Externe URL (BT-124) */
    externalUrl?: string
}
