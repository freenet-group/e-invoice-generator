import { XMLParser } from 'fast-xml-parser'
import {
    CommonInvoice,
    InvoiceType,
    PaymentMeansCode,
    TaxCategoryCode,
    UnitCode,
} from '../../models/commonInvoice'
import { RawInvoiceData } from '../invoiceAdapter'
import { parseMcbsDocument, McbsDocument, McbsBillItem } from './zod/mcbsXmlInvoiceSchema'

const xmlParser = new XMLParser({
    ignoreAttributes: false,
    trimValues: true,
})

// ==================== XML Parsing ====================

export function parseMcbsXml(
    xmlString: string,
    source: string,
    metadata: RawInvoiceData['metadata']
): RawInvoiceData {
    const parsed = <Record<string, unknown>>xmlParser.parse(xmlString)
    const document = <Record<string, unknown> | undefined>parsed['DOCUMENT']
    if (document === undefined) {
        throw new Error(`Invalid MCBS XML: missing <DOCUMENT> root element in ${source}`)
    }
    return { source: 'MCBS', data: document, metadata }
}

// ==================== Mapping ====================

export function mapMcbsToCommonInvoice(rawData: RawInvoiceData): CommonInvoice {
    const doc: McbsDocument = parseMcbsDocument(rawData.data)

    const header: McbsDocument['HEADER'] = doc['HEADER']
    const recipient: McbsDocument['RECIPIENT'] = doc['RECIPIENT']
    const invoiceData: McbsDocument['INVOICE_DATA'] = doc['INVOICE_DATA']
    const paymentMode: McbsDocument['INVOICE_DATA']['PAYMENT_MODE'] = invoiceData['PAYMENT_MODE']
    const frames: McbsDocument['INVOICE_DATA']['FRAMES'] = invoiceData['FRAMES']
    const amounts: McbsDocument['INVOICE_DATA']['FRAMES']['AMOUNTS'] = frames['AMOUNTS']
    const diffVats: McbsDocument['INVOICE_DATA']['FRAMES']['DIFF_VATS'] = frames['DIFF_VATS']
    const frame: McbsDocument['INVOICE_DATA']['FRAMES']['FRAME'] = frames['FRAME']
    const address: McbsDocument['RECIPIENT']['ADDRESS'] = recipient['ADDRESS']

    const s3Bucket = toStringOrUndefined(rawData.metadata['s3Bucket'])
    const s3Key = toStringOrUndefined(rawData.metadata['pdfKey'] ?? rawData.metadata['s3Key'])

    // HEADER hat kein BILLING_ENTITY → Seller-Adresse aus paymentMode oder leer
    const brand = <Record<string, unknown> | undefined>header['BRAND']
    const seller: CommonInvoice['seller'] = {
        name: toStringOrUndefined(brand?.['DESC']) ?? toStringOrUndefined(brand?.['CODE_DESC']) ?? '',
        postalAddress: {
            streetName: '',
            cityName: '',
            postalCode: '',
            countryCode: 'DE',
        },
        taxRegistration: [
            {
                id: {
                    value: 'DE123456789',
                    schemeId: 'VAT',
                },
            },
        ],
    }

    // ADDRESS nutzt FIRSTNAME / NAME / POSTCODE (kein FIRST_NAME / LAST_NAME / ZIPCODE)
    const buyer: CommonInvoice['buyer'] = {
        name: [toStringOrUndefined(address['FIRSTNAME']), toStringOrUndefined(address['NAME'])].filter(Boolean).join(' '),
        postalAddress: {
            streetName: toStringOrUndefined(address['STREET']) ?? '',
            cityName: toStringOrUndefined(address['CITY']) ?? '',
            postalCode: toStringOrUndefined(address['POSTCODE']) ?? '',
            countryCode: toStringOrUndefined(address['COUNTRY']) ?? 'DE',
        },
    }

    const paymentMeans: CommonInvoice['paymentMeans'] = [
        {
            typeCode: paymentMode['PAYMENT_TYPE'] === 'SEPADEBIT'
                ? PaymentMeansCode.SEPA_DIRECT_DEBIT
                : PaymentMeansCode.CREDIT_TRANSFER,
            payeeAccount: {
                iban: <string>(paymentMode['BANK_ACCOUNT'] ?? header['CLIENTBANK_ACNT']),
            },
            payeeInstitution: {
                bic: <string>(paymentMode['BANK_CODE'] ?? header['CLIENTBANK_CODE']),
            },
        },
    ]

    const taxes = mapTaxes(diffVats, amounts)

    // UNPAID → negativer totalPrepaidAmount (Schulden des Kunden)
    const unpaid = amounts.UNPAID
    const totalPrepaidAmount = unpaid !== undefined && unpaid !== 0
        ? -unpaid
        : undefined

    // Totals direkt aus transformiertem AMOUNTS Objekt lesen
    const totals: CommonInvoice['totals'] = {
        lineTotal: amounts.NET_AMOUNT + amounts.INSEP_GROSS,
        taxBasisTotal: amounts.NET_AMOUNT + amounts.INSEP_GROSS,  // war: nur NET_AMOUNT
        taxTotal: amounts.VAT_AMOUNT,
        grandTotal: amounts.GROSS_AMOUNT,
        totalPrepaidAmount,
        duePayable: amounts.TO_PAY ?? amounts.GROSS_AMOUNT,
    }

    const lineItems = extractLineItems(<McbsFrameArray><unknown>frame)

    return {
        invoiceNumber: toStringOrUndefined(header['INVOICE_NO']) ?? '',
        invoiceDate: toStringOrUndefined(header['INVOICE_DATE']) ?? '',
        invoiceType: (<Record<string, unknown>>doc)['TYPE'] === 'GS' ? InvoiceType.CREDIT_NOTE : InvoiceType.COMMERCIAL,
        currency: toStringOrUndefined(header['INV_CURRENCY']) ?? 'EUR',
        source: {
            system: 'MCBS',
            id: rawData.metadata.id,
            timestamp: rawData.metadata.timestamp,
        },
        seller,
        buyer,
        paymentMeans,
        paymentTerms: {
            dueDate: toStringOrUndefined(paymentMode['DUE_DATE']),
        },
        totals,
        taxes,
        lineItems,
        pdf: { s3Bucket, s3Key },
    }
}

// ==================== Line Items ====================

// ==================== Hilfstypen für extractLineItems ====================

type McbsFrameArray = McbsDocument['INVOICE_DATA']['FRAMES']['FRAME']
type McbsFrameItem = McbsFrameArray[number]
type McbsUnitItem = NonNullable<McbsFrameItem['AREA']>['UNIT'][number]
type McbsSectionItem = NonNullable<McbsUnitItem['SECTIONS']>['SECTION'][number]
type McbsBillitemGrpItem = NonNullable<NonNullable<McbsSectionItem['BILLITEM_GRPS']>['BILLITEM_GRP']>[number]

// ==================== Hilfstypen für Unit-Kontext ====================

interface UnitContext {
    contractReference?: string
    phoneNumber?: string
    subscriberName?: string
    network?: string
    tariff?: string
}

function extractUnitContext(unit: McbsUnitItem): UnitContext {
    const typedUnit = <Record<string, unknown>>unit
    const contractData = <Record<string, unknown> | undefined>typedUnit['CONTRACT_DATA']
    const contractType = toStringOrUndefined(contractData?.['TYPE'])
    const isTelco = contractType === 'TELCO'

    const contractNo = toStringOrUndefined(contractData?.['CONTRACT_NO'])
    const network = toStringOrUndefined(contractData?.['NETWORK'])

    // TCS_TITLE wird nicht verwendet — AdditionalItemProperty heißt bereits "Teilnehmer"
    const subscriberName = toStringOrUndefined(contractData?.['TCS_VALUE'])

    // CONNECT_NO aus CONNECTS/CONNECT[TYPE=MAIN]
    const connects = <Record<string, unknown> | undefined>contractData?.['CONNECTS']
    const connectArray: Record<string, unknown>[] = getConnectArray(connects?.['CONNECT'])
    const mainConnect = connectArray.find(c => toStringOrUndefined(c['TYPE']) === 'MAIN')
    const phoneNumber = toStringOrUndefined(mainConnect?.['CONNECT_NO'])

    // tariff nur bei TELCO relevant
    const tariff = isTelco ? toStringOrUndefined(contractData?.['TARIFF']) : undefined

    return {
        ...(contractNo === undefined ? {} : { contractReference: contractNo }),
        ...(tariff === undefined ? {} : { tariff }),
        ...(phoneNumber === undefined ? {} : { phoneNumber }),
        ...(subscriberName === undefined ? {} : { subscriberName }),
        ...(network === undefined ? {} : { network }),
    }
}

function extractLineItems(frame: McbsFrameArray): CommonInvoice['lineItems'] {
    const frameArray = Array.isArray(frame) ? frame : []
    return frameArray
        .filter((f: McbsFrameItem) => {
            const typedFrame = <Record<string, unknown>>f
            return toStringOrUndefined(typedFrame['ID']) !== 'VOUCHERS'
        })
        .flatMap((f: McbsFrameItem) => extractFromFrame(f))
}

function extractFromFrame(f: McbsFrameItem): CommonInvoice['lineItems'] {
    const typedFrame = <Record<string, unknown>>f
    const area = <Record<string, unknown> | undefined>typedFrame['AREA']
    const unitArray: McbsUnitItem[] = Array.isArray(area?.['UNIT']) ? <McbsUnitItem[]>area['UNIT'] : []
    return unitArray.flatMap((unit: McbsUnitItem) => extractFromUnit(unit))
}

function extractFromUnit(unit: McbsUnitItem): CommonInvoice['lineItems'] {
    const typedUnit = <Record<string, unknown>>unit

    // Unit-Kontext wird an alle untergeordneten Positionen weitergereicht
    const unitContext = extractUnitContext(unit)

    const sections = <Record<string, unknown> | undefined>typedUnit['SECTIONS']
    const sectionArray: McbsSectionItem[] = Array.isArray(sections?.['SECTION'])
        ? <McbsSectionItem[]>sections['SECTION']
        : []
    return sectionArray.flatMap((section: McbsSectionItem) =>
        extractFromSection(section, unitContext)
    )
}

function extractFromSection(section: McbsSectionItem, unitContext: UnitContext): CommonInvoice['lineItems'] {
    const typedSection = <Record<string, unknown>>section
    const billitemGrps = <Record<string, unknown> | undefined>typedSection['BILLITEM_GRPS']
    const grpArray: McbsBillitemGrpItem[] = Array.isArray(billitemGrps?.['BILLITEM_GRP'])
        ? <McbsBillitemGrpItem[]>billitemGrps['BILLITEM_GRP']
        : []
    return grpArray.flatMap((grp: McbsBillitemGrpItem) =>
        extractFromGroup(grp, unitContext)
    )
}

function extractFromGroup(grp: McbsBillitemGrpItem, unitContext: UnitContext): CommonInvoice['lineItems'] {
    const typedGrp = <Record<string, unknown>>grp
    const billitems = <Record<string, unknown> | undefined>typedGrp['BILLITEMS']
    const billitemArray = Array.isArray(billitems?.['BILLITEM'])
        ? <McbsBillItem[]>billitems['BILLITEM']
        : []
    return billitemArray.map((item: McbsBillItem, index: number) =>
        mapBillItem(item, index + 1, unitContext)
    )
}

function resolveSubscriberInfo(
    typedItem: Record<string, unknown>,
    unitContext: UnitContext
): CommonInvoice['lineItems'][number]['subscriberInfo'] {
    // Position-Felder überschreiben Unit-Kontext (Position hat Vorrang)
    const phoneNumber = toStringOrUndefined(typedItem['PHONE_NUMBER']) ?? unitContext.phoneNumber
    const name = toStringOrUndefined(typedItem['SUBSCRIBER_NAME']) ?? unitContext.subscriberName  // ← subscriberName → name
    const network = unitContext.network
    const tariff = unitContext.tariff

    if (phoneNumber === undefined && name === undefined && network === undefined && tariff === undefined) {
        return undefined
    }

    return {
        ...(phoneNumber === undefined ? {} : { phoneNumber }),
        ...(name === undefined ? {} : { name }),
        ...(network === undefined ? {} : { network }),
        ...(tariff === undefined ? {} : { tariff }),
    }
}

function mapBillItem(
    item: McbsBillItem,
    fallbackId: number,
    unitContext: UnitContext
): CommonInvoice['lineItems'][number] {
    const typedItem = <Record<string, unknown>>item
    const sequenceNo: number = typeof typedItem['SEQUENCE_NO'] === 'number'
        ? typedItem['SEQUENCE_NO']
        : fallbackId
    const period = parsePeriod(toStringOrUndefined(typedItem['PERIOD']))

    const periodStart = period === undefined ? undefined : period['start']
    const periodEnd = period === undefined ? undefined : period['end']

    const contractReference = unitContext.contractReference
    const subscriberInfo = resolveSubscriberInfo(typedItem, unitContext)  // ← typedItem mitgeben

    // Content Provider aus OPT_PARAMS/CONT_PROVIDER extrahieren
    const optParams = <Record<string, unknown> | undefined>typedItem['OPT_PARAMS']
    const contProvider = <Record<string, unknown> | undefined>optParams?.['CONT_PROVIDER']
    const contentProviderContact = toStringOrUndefined(contProvider?.['CONTACT'])
    const contentProviderServices = toStringOrUndefined(contProvider?.['SERVICES'])

    return {
        id: sequenceNo,
        name: toStringOrUndefined(typedItem['PRODUCT_NAME']) ?? '',
        quantity: 1,
        unitCode: UnitCode.PIECE,
        unitPrice: <number>typedItem['CHARGE'],
        netAmount: <number>typedItem['CHARGE'],
        tax: {
            typeCode: 'VAT',
            categoryCode: typedItem['VAT_RATE'] === 'INCLUDED'
                ? TaxCategoryCode.EXEMPT    // war: OUTSIDE_SCOPE → E statt O
                : TaxCategoryCode.STANDARD,
            rate: typedItem['VAT_RATE'] === 'INCLUDED' ? 0 : <number>typedItem['VAT_RATE'],
        },
        contractReference: contractReference,
        ...(subscriberInfo === undefined ? {} : { subscriberInfo }),
        ...(contentProviderContact !== undefined || contentProviderServices !== undefined
            ? {
                contentProvider: {
                    ...(contentProviderContact === undefined ? {} : { contact: contentProviderContact }),
                    ...(contentProviderServices === undefined ? {} : { services: contentProviderServices }),
                }
            }
            : {}),
        ...(periodStart !== undefined || periodEnd !== undefined
            ? {
                period: {
                    ...(periodStart === undefined ? {} : { start: periodStart }),
                    ...(periodEnd === undefined ? {} : { end: periodEnd }),
                }
            }
            : {}),
    }
}

// ==================== Hilfsfunktionen ====================

function getConnectArray(connectValue: unknown): Record<string, unknown>[] {
    if (Array.isArray(connectValue)) {
        return <Record<string, unknown>[]>connectValue
    }
    if (connectValue !== undefined) {
        return [<Record<string, unknown>>connectValue]
    }
    return []
}

function toStringOrUndefined(value: unknown): string | undefined {
    if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'bigint' ||
        typeof value === 'boolean'
    ) {
        return String(value)
    }
    return undefined
}

function mapTaxes(
    diffVats: McbsDocument['INVOICE_DATA']['FRAMES']['DIFF_VATS'],
    amounts: McbsDocument['INVOICE_DATA']['FRAMES']['AMOUNTS']
): CommonInvoice['taxes'] {
    const taxes: CommonInvoice['taxes'] = []

    if (typeof diffVats === 'object') {
        const diffVatArray = diffVats.DIFF_VAT ?? []

        for (const vat of diffVatArray) {
            taxes.push({
                typeCode: 'VAT',
                categoryCode: TaxCategoryCode.STANDARD,
                rate: vat.VAT_RATE,        // ← bereits number durch Schema
                basisAmount: vat.NET,      // ← bereits number durch Schema
                calculatedAmount: vat.VAT, // ← bereits number durch Schema
            })
        }
    }

    // INCLUDED-Positionen aus INSEP_GROSS → Exempt statt Outside Scope
    if (amounts.INSEP_GROSS > 0) {
        taxes.push({
            typeCode: 'VAT',
            categoryCode: TaxCategoryCode.EXEMPT,  // war: OUTSIDE_SCOPE
            rate: 0,
            basisAmount: amounts.INSEP_GROSS,
            calculatedAmount: 0,
        })
    }

    return taxes
}

// getAmountByType und parseGermanNumber können komplett entfernt werden ✅

function parsePeriod(periodString: string | undefined): { start?: string; end?: string } | undefined {
    if (periodString === undefined) {
        return undefined
    }

    // Format: "01.09.2025 - 28.02.2026"
    const parts = periodString.split(' - ')
    if (parts.length !== 2) {
        return undefined
    }

    const parseDate = (datePart: string): string | undefined => {
        // DD.MM.YYYY → YYYY-MM-DD
        const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(datePart.trim())
        if (match === null) {
            return undefined
        }
        return `${match[3]}-${match[2]}-${match[1]}`
    }

    const start = parseDate(parts[0] ?? '')
    const end = parseDate(parts[1] ?? '')

    if (start === undefined && end === undefined) {
        return undefined
    }

    return {
        ...(start === undefined ? {} : { start }),
        ...(end === undefined ? {} : { end }),
    }
}
