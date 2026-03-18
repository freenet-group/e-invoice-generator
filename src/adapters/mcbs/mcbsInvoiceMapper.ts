import {XMLParser} from 'fast-xml-parser'
import {CommonInvoice, InvoiceType, PaymentMeansCode, TaxCategoryCode, UnitCode} from '../../models/commonInvoice'
import {RawInvoiceData} from '../invoiceAdapter'
import {parseMcbsDocument, McbsDocument, McbsBillItem} from './zod/mcbsXmlInvoiceSchema'
import {getSellerByGroupShortcut} from './mcbsSellersMapper'
import {FatalProcessingError} from '../../core/errors/fatalProcessingError'

const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    trimValues: true,
    parseAttributeValue: false,
    numberParseOptions: {
        leadingZeros: false,
        hex: false,
        skipLike: /.*/ // ← alle Werte als string belassen, kein auto-parsing
    }
})

// ==================== XML Parsing ====================

export function parseMcbsXml(xmlString: string, source: string, metadata: RawInvoiceData['metadata']): RawInvoiceData {
    const parsed = <Record<string, unknown>>xmlParser.parse(xmlString)
    const document = <Record<string, unknown> | undefined>parsed['DOCUMENT']
    if (document === undefined) {
        throw new Error(`Invalid MCBS XML: missing <DOCUMENT> root element in ${source}`)
    }
    return {data: document, metadata}
}

// ==================== Mapping ====================

export function mapMcbsToCommonInvoice(rawData: RawInvoiceData): CommonInvoice {
    const source = rawData.metadata.sourceDataKey ?? 'unknown'
    try {
        return mapMcbsToCommonInvoiceInternal(rawData)
    } catch (err) {
        const cause = err instanceof Error ? err : new Error(String(err))
        throw new FatalProcessingError(cause.message, source, cause)
    }
}

function mapMcbsToCommonInvoiceInternal(rawData: RawInvoiceData): CommonInvoice {
    const doc: McbsDocument = parseMcbsDocument(rawData.data)
    const header = doc['HEADER']
    const recipient = doc['RECIPIENT']
    const invoiceData = doc['INVOICE_DATA']
    const paymentMode = invoiceData['PAYMENT_MODE']
    const frames = invoiceData['FRAMES']
    const amounts = frames['AMOUNTS']
    const diffVats = frames['DIFF_VATS']
    const frame = frames['FRAME']
    const address = recipient['ADDRESS']

    const brand = <Record<string, unknown> | undefined>header['BRAND']
    const groupShortcut = toStringOrUndefined(brand?.['GROUP_SHORTCUT'])
    const seller: CommonInvoice['seller'] = getSellerByGroupShortcut(groupShortcut)

    // Firmenkunden haben SHORT_OPENING='Firma' und nur NAME (kein FIRSTNAME)
    const isCompany = address['SHORT_OPENING'] === 'Firma'
    const buyerName = isCompany
        ? (toStringOrUndefined(address['NAME']) ?? '')
        : [toStringOrUndefined(address['FIRSTNAME']), toStringOrUndefined(address['NAME'])]
              .filter((s): s is string => s !== undefined && s !== '')
              .join(' ')
    const department = toStringOrUndefined(address['DEPARTMENT'])
    const additional = toStringOrUndefined(address['ADDITIONAL'])

    // Bei Firmen: DEPARTMENT = Ansprechpartner → contact.name, ADDITIONAL = Adresszusatz → addressLine
    // Bei Privatpersonen: DEPARTMENT = c/o o.ä. → Adresszusatz, zusammen mit ADDITIONAL in addressLine
    const privateAddressLine = [department, additional].filter((s): s is string => s !== undefined && s !== '').join(', ')
    const nonEmptyPrivateAddressLine = privateAddressLine === '' ? undefined : privateAddressLine
    const addressLine = isCompany ? additional : nonEmptyPrivateAddressLine
    const contactName = isCompany ? department : undefined

    const buyer: CommonInvoice['buyer'] = {
        name: buyerName,
        postalAddress: {
            streetName: toStringOrUndefined(address['STREET']) ?? '',
            cityName: toStringOrUndefined(address['CITY']) ?? '',
            postalCode: toStringOrUndefined(address['POSTCODE']) ?? '',
            countryCode: toStringOrUndefined(address['COUNTRY']) ?? 'DE',
            ...(addressLine !== undefined && {addressLine})
        },
        ...(contactName !== undefined && {contact: {name: contactName}})
    }

    const paymentMeans: CommonInvoice['paymentMeans'] = [buildMcbsPaymentMeans(paymentMode, header, seller)]

    const taxes = mapTaxes(diffVats, amounts)

    const unpaid = amounts.UNPAID
    const totalPrepaidAmount = unpaid !== undefined && unpaid !== 0 ? -unpaid : undefined

    const totals: CommonInvoice['totals'] = {
        lineTotal: amounts.NET_AMOUNT + amounts.INSEP_GROSS,
        taxBasisTotal: amounts.NET_AMOUNT + amounts.INSEP_GROSS,
        taxTotal: amounts.VAT_AMOUNT,
        grandTotal: amounts.GROSS_AMOUNT,
        totalPrepaidAmount,
        duePayable: amounts.TO_PAY ?? amounts.GROSS_AMOUNT
    }

    const lineItems = extractLineItems(frame)

    return {
        invoiceNumber: toStringOrUndefined(header['INVOICE_NO']) ?? '',
        invoiceDate: toStringOrUndefined(header['INVOICE_DATE']) ?? '',
        invoiceType: doc['TYPE'] === 'GS' ? InvoiceType.CREDIT_NOTE : InvoiceType.COMMERCIAL,
        currency: toStringOrUndefined(header['INV_CURRENCY']) ?? 'EUR',
        source: {
            system: rawData.metadata.source,
            timestamp: rawData.metadata.timestamp,
            partyId: resolvePartyId(doc),
            billingAccountId: resolveBillingAccountId(header),
            billrunId: toStringOrUndefined(header['BILLRUN_ID']),
            mandant: toStringOrUndefined(header['MANDANT'])
        },
        seller,
        buyer,
        paymentMeans,
        paymentTerms: {
            dueDate: toStringOrUndefined(paymentMode['DUE_DATE'])
        },
        totals,
        taxes,
        lineItems,
        pdf: {
            s3Bucket: rawData.metadata.s3Bucket,
            s3Key: rawData.metadata.sourcePdfKey
        },
        buyerReference: resolveBuyerReference(doc)
    }
}

// ==================== Buyer Reference ====================

function resolveBuyerReference(doc: McbsDocument): string | undefined {
    const header = doc['HEADER']
    const customer = doc['CUSTOMER']
    const recipient = doc['RECIPIENT']

    const deliveryMode = header['DELIVERY_MODE']
    const supply = deliveryMode?.['SUPPLY']
    if (toStringOrUndefined(supply?.['TYPE']) === 'PEPPOL_PA') {
        const entry = toStringOrUndefined(supply?.['ENTRY'])
        if (entry !== undefined) {
            return entry
        }
    }

    const vatId = toStringOrUndefined(customer?.['VAT_ID'])
    if (vatId !== undefined) {
        return vatId
    }

    const customerId = toStringOrUndefined(customer?.['PERSON_NO'])
    return customerId ?? toStringOrUndefined(recipient['PERSON_NO'])
}

function resolvePartyId(doc: McbsDocument): string {
    const customer = doc['CUSTOMER']
    const recipient = doc['RECIPIENT']
    const partyId = toStringOrUndefined(customer?.['PERSON_NO']) ?? toStringOrUndefined(recipient['PERSON_NO'])
    if (partyId === undefined) {
        throw new Error('Missing partyId: neither CUSTOMER.PERSON_NO nor RECIPIENT.PERSON_NO is present') // wird von mapMcbsToCommonInvoice zu FatalProcessingError
    }
    return partyId
}

function resolveBillingAccountId(header: McbsDocument['HEADER']): string {
    const billingAccountId = toStringOrUndefined(header['INVOICE_DEF'])
    if (billingAccountId === undefined) {
        throw new Error('Missing billingAccountId: INVOICE_DEF is not present in MCBS header') // wird von mapMcbsToCommonInvoice zu FatalProcessingError
    }
    return billingAccountId
}

// ==================== Line Items ====================

type McbsFrameArray = McbsDocument['INVOICE_DATA']['FRAMES']['FRAME']
type McbsFrameItem = McbsFrameArray[number]
type McbsAreaItem = NonNullable<McbsFrameItem['AREA']>[number]
type McbsUnitItem = McbsAreaItem['UNIT'][number]
type McbsSectionItem = NonNullable<McbsUnitItem['SECTIONS']>['SECTION'][number]
type McbsBillitemGrpItem = NonNullable<NonNullable<McbsSectionItem['BILLITEM_GRPS']>['BILLITEM_GRP']>[number]

interface UnitContext {
    contractReference?: string
    phoneNumber?: string
    subscriberName?: string
    network?: string
    tariff?: string
}

function extractUnitContext(unit: McbsUnitItem): UnitContext {
    const contractData = unit['CONTRACT_DATA']
    const contractType = contractData?.['TYPE']
    const isTelco = contractType === 'TELCO'

    const contractNo = contractData?.['CONTRACT_NO']
    const network = contractData?.['NETWORK']
    const subscriberName = contractData?.['TCS_VALUE']

    const connects = contractData?.['CONNECTS']
    const connectArray = getConnectArray(connects?.['CONNECT'])
    const mainConnect = connectArray.find((c) => c['TYPE'] === 'MAIN')
    const phoneNumber = toStringOrUndefined(mainConnect?.['CONNECT_NO']) // ← toStringOrUndefined löst unknown → string | undefined

    const tariff = isTelco ? contractData?.['TARIFF'] : undefined

    return {
        ...(contractNo === undefined ? {} : {contractReference: contractNo}),
        ...(tariff === undefined ? {} : {tariff}),
        ...(phoneNumber === undefined ? {} : {phoneNumber}),
        ...(subscriberName === undefined ? {} : {subscriberName}),
        ...(network === undefined ? {} : {network})
    }
}

const EXCLUDED_FRAME_IDS = new Set(['VOUCHERS', 'SUMMARY', 'RGUB'])

function extractLineItems(frame: McbsFrameArray): CommonInvoice['lineItems'] {
    const frameArray = Array.isArray(frame) ? frame : []
    return frameArray
        .filter((f: McbsFrameItem) => !EXCLUDED_FRAME_IDS.has(f['ID'] ?? ''))
        .flatMap((f: McbsFrameItem) => extractFromFrame(f))
}

function extractFromFrame(f: McbsFrameItem): CommonInvoice['lineItems'] {
    const areaArray: McbsAreaItem[] = Array.isArray(f['AREA']) ? f['AREA'] : []
    return areaArray.flatMap((area: McbsAreaItem) => area['UNIT'].flatMap((unit: McbsUnitItem) => extractFromUnit(unit)))
}

function extractFromUnit(unit: McbsUnitItem): CommonInvoice['lineItems'] {
    const unitContext = extractUnitContext(unit)
    const sections = unit['SECTIONS'] // McbsUnitItem bereits typisiert
    const sectionArray: McbsSectionItem[] = Array.isArray(sections?.['SECTION'])
        ? sections['SECTION'] // Typ bereits McbsSectionItem[]
        : []
    return sectionArray.flatMap((section: McbsSectionItem) => extractFromSection(section, unitContext))
}

function extractFromSection(section: McbsSectionItem, unitContext: UnitContext): CommonInvoice['lineItems'] {
    const billitemGrps = section['BILLITEM_GRPS'] // McbsSectionItem bereits typisiert
    const grpArray: McbsBillitemGrpItem[] = Array.isArray(billitemGrps?.['BILLITEM_GRP'])
        ? billitemGrps['BILLITEM_GRP'] // Typ bereits McbsBillitemGrpItem[]
        : []
    return grpArray.flatMap((grp: McbsBillitemGrpItem) => extractFromGroup(grp, unitContext))
}

function extractFromGroup(grp: McbsBillitemGrpItem, unitContext: UnitContext): CommonInvoice['lineItems'] {
    const billitems = grp['BILLITEMS'] // McbsBillitemGrpItem bereits typisiert
    const billitemArray: McbsBillItem[] = Array.isArray(billitems?.['BILLITEM'])
        ? billitems['BILLITEM'] // Typ bereits McbsBillItem[]
        : []
    return billitemArray
        .filter((item: McbsBillItem) => item['INFO_ITEM'] !== 'TRUE')
        .map((item: McbsBillItem, index: number) => mapBillItem(item, index + 1, unitContext))
}

function resolveSubscriberInfo(unitContext: UnitContext): CommonInvoice['lineItems'][number]['subscriberInfo'] {
    const phoneNumber = unitContext.phoneNumber
    const name = unitContext.subscriberName
    const network = unitContext.network
    const tariff = unitContext.tariff

    if (phoneNumber === undefined && name === undefined && network === undefined && tariff === undefined) {
        return undefined
    }

    return {
        ...(phoneNumber === undefined ? {} : {phoneNumber}),
        ...(name === undefined ? {} : {name}),
        ...(network === undefined ? {} : {network}),
        ...(tariff === undefined ? {} : {tariff})
    }
}

function mapBillItem(item: McbsBillItem, fallbackId: number, unitContext: UnitContext): CommonInvoice['lineItems'][number] {
    const sequenceNo: number = item['SEQUENCE_NO'] ?? fallbackId
    const period = parsePeriod(item['PERIOD'])

    const periodStart = period?.['start']
    const periodEnd = period?.['end']

    const subscriberInfo = resolveSubscriberInfo(unitContext)

    const contProvider = item['OPT_PARAMS']?.['CONT_PROVIDER']
    const contentProviderContact = contProvider?.['CONTACT']
    const contentProviderServices = contProvider?.['SERVICES']

    return {
        id: sequenceNo,
        name: item['PRODUCT_NAME'],
        quantity: 1,
        unitCode: UnitCode.PIECE,
        unitPrice: item['CHARGE'],
        netAmount: item['CHARGE'],
        tax: {
            typeCode: 'VAT',
            categoryCode: item['VAT_RATE'] === 'INCLUDED' ? TaxCategoryCode.EXEMPT : TaxCategoryCode.STANDARD,
            rate: item['VAT_RATE'] === 'INCLUDED' ? 0 : item['VAT_RATE']
        },
        contractReference: unitContext.contractReference,
        ...(subscriberInfo === undefined ? {} : {subscriberInfo}),
        ...(contentProviderContact !== undefined || contentProviderServices !== undefined
            ? {
                  contentProvider: {
                      ...(contentProviderContact === undefined ? {} : {contact: contentProviderContact}),
                      ...(contentProviderServices === undefined ? {} : {services: contentProviderServices})
                  }
              }
            : {}),
        ...(periodStart !== undefined || periodEnd !== undefined
            ? {
                  period: {
                      ...(periodStart === undefined ? {} : {start: periodStart}),
                      ...(periodEnd === undefined ? {} : {end: periodEnd})
                  }
              }
            : {})
    }
}

// ==================== Hilfsfunktionen ====================

function getConnectArray(connectValue: unknown): Record<string, unknown>[] {
    if (Array.isArray(connectValue)) {
        return <Record<string, unknown>[]>connectValue
    }
    /* istanbul ignore next: xmlArray() in Zod schema normalises single elements to arrays */
    if (connectValue !== null && connectValue !== undefined) {
        return [<Record<string, unknown>>connectValue]
    }
    return []
}

function toStringOrUndefined(value: unknown): string | undefined {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
        return String(value)
    }
    return undefined
}

// ==================== Payment Means ====================

function resolvePaymentTypeCode(paymentType: McbsDocument['INVOICE_DATA']['PAYMENT_MODE']['PAYMENT_TYPE']): PaymentMeansCode {
    const codeMap: Record<typeof paymentType, PaymentMeansCode> = {
        SEPADEBIT: PaymentMeansCode.SEPA_DIRECT_DEBIT,
        SEPACREDIT: PaymentMeansCode.CREDIT_TRANSFER,
        INVOICE: PaymentMeansCode.CREDIT_TRANSFER,
        SEF: PaymentMeansCode.CREDIT_TRANSFER,
        CREDITCARD: PaymentMeansCode.CARD,
        ZERO: PaymentMeansCode.CREDIT_TRANSFER,
        NO_SEPADEBIT: PaymentMeansCode.CREDIT_TRANSFER,
        INFO: PaymentMeansCode.CREDIT_TRANSFER
    }
    return codeMap[paymentType]
}

function buildMcbsPaymentMeans(
    paymentMode: McbsDocument['INVOICE_DATA']['PAYMENT_MODE'],
    header: McbsDocument['HEADER'],
    seller: CommonInvoice['seller']
): CommonInvoice['paymentMeans'][number] {
    const paymentType = paymentMode.PAYMENT_TYPE
    const useCustomerBank = paymentType === 'SEPADEBIT' || paymentType === 'SEPACREDIT'
    const useCompanyBank = paymentType === 'INVOICE' || paymentType === 'SEF'

    let payeeIban: string | undefined
    if (useCustomerBank) {
        payeeIban = paymentMode.BANK_ACCOUNT ?? undefined
    } else if (useCompanyBank) {
        payeeIban = header.CLIENTBANK_ACNT ?? undefined
    }

    let payeeBic: string | undefined
    if (useCustomerBank) {
        payeeBic = paymentMode.BANK_CODE ?? undefined
    } else if (useCompanyBank) {
        payeeBic = header.CLIENTBANK_CODE ?? undefined
    }

    const mandateReference = paymentMode.SEPA_MANDATE ?? undefined
    // SEPA-Mandat (BT-89/BT-90) nur bei Lastschrift – nicht bei Überweisung (SEPACREDIT)
    const mandate =
        paymentType === 'SEPADEBIT' && (mandateReference !== undefined || seller.creditorId !== undefined)
            ? {reference: mandateReference, creditorReferenceId: seller.creditorId}
            : undefined

    return {
        typeCode: resolvePaymentTypeCode(paymentType),
        ...(payeeIban !== undefined && {payeeAccount: {iban: payeeIban}}),
        ...(payeeBic !== undefined && {payeeInstitution: {bic: payeeBic}}),
        ...(paymentType === 'CREDITCARD' && {
            card: {
                primaryAccountNumber: paymentMode.CARD_NUMBER ?? undefined,
                holderName: paymentMode.CARD_HOLDER ?? undefined
            }
        }),
        ...(mandate !== undefined && {mandate})
    }
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
                rate: vat.VAT_RATE,
                basisAmount: vat.NET,
                calculatedAmount: vat.VAT
            })
        }
    }

    // INCLUDED-Positionen aus INSEP_GROSS → Exempt statt Outside Scope
    if (amounts.INSEP_GROSS > 0) {
        taxes.push({
            typeCode: 'VAT',
            categoryCode: TaxCategoryCode.EXEMPT, // war: OUTSIDE_SCOPE
            rate: 0,
            basisAmount: amounts.INSEP_GROSS,
            calculatedAmount: 0
        })
    }

    return taxes
}

// getAmountByType und parseGermanNumber können komplett entfernt werden ✅

function parsePeriod(periodString: string | undefined): {start?: string; end?: string} | undefined {
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
        ...(start === undefined ? {} : {start}),
        ...(end === undefined ? {} : {end})
    }
}
