/**
 * E-Invoice Mapper
 *
 * Pure Mapping-Funktionen: CommonInvoice → @e-invoice-eu/core Invoice (UBL-Format)
 * Keine I/O, keine Seiteneffekte – vollständig unit-testbar.
 */

import {type Invoice} from '@e-invoice-eu/core'
import {CommonInvoice, InvoiceType, UnitCode, PaymentMeansCode, TaxCategoryCode} from '../models/commonInvoice'

/**
 * Mappt CommonInvoice → @e-invoice-eu/core Invoice (UBL-Format)
 */
export function mapToEInvoice(ci: CommonInvoice): Invoice {
    const invoiceObject = {
        'ubl:Invoice': {
            'cbc:ID': ci.invoiceNumber,
            'cbc:IssueDate': ci.invoiceDate,
            'cbc:InvoiceTypeCode': INVOICE_TYPE_CODE[ci.invoiceType],
            'cbc:DocumentCurrencyCode': ci.currency,
            'cbc:BuyerReference': ci.buyerReference,
            'cac:AccountingSupplierParty': buildSeller(ci),
            'cac:AccountingCustomerParty': buildBuyer(ci),
            'cac:Delivery': {'cbc:ActualDeliveryDate': ci.invoiceDate},
            'cac:PaymentMeans': ci.paymentMeans.map((pm) => buildPaymentMeans(pm)),
            ...buildPaymentTerms(ci),
            'cac:TaxTotal': buildTaxTotal(ci),
            'cac:LegalMonetaryTotal': buildLegalMonetaryTotal(ci),
            'cac:InvoiceLine': buildInvoiceLines(ci)
        }
    }
    return <Invoice>(<unknown>invoiceObject)
}

function buildPaymentTerms(ci: CommonInvoice): Record<string, unknown> {
    const paymentTerms = ci.paymentTerms
    const hasDescription = paymentTerms?.description !== undefined && paymentTerms.description !== ''
    const hasDueDate = paymentTerms?.dueDate !== undefined

    if (paymentTerms === undefined || (!hasDescription && !hasDueDate)) {
        return {}
    }

    const noteParts: string[] = []
    if (hasDescription) {
        /* istanbul ignore next: description is always defined when hasDescription is true */
        noteParts.push(paymentTerms.description ?? '')
    }
    if (hasDueDate) {
        noteParts.push(`Fällig am: ${paymentTerms.dueDate}`)
    }

    return {
        'cac:PaymentTerms': {
            'cbc:Note': noteParts.join(' – ')
        }
    }
}

function buildTaxTotal(ci: CommonInvoice): Record<string, unknown>[] {
    return [
        {
            'cbc:TaxAmount': formatAmount(ci.totals.taxTotal),
            'cbc:TaxAmount@currencyID': ci.currency,
            'cac:TaxSubtotal': ci.taxes.map((tax) => {
                const isSubjectToVat = tax.categoryCode !== TaxCategoryCode.OUTSIDE_SCOPE
                const isExempt = tax.categoryCode === TaxCategoryCode.EXEMPT
                return {
                    'cbc:TaxableAmount': formatAmount(tax.basisAmount),
                    'cbc:TaxableAmount@currencyID': ci.currency,
                    'cbc:TaxAmount': formatAmount(tax.calculatedAmount),
                    'cbc:TaxAmount@currencyID': ci.currency,
                    'cac:TaxCategory': {
                        'cbc:ID': tax.categoryCode,
                        ...(isSubjectToVat ? {'cbc:Percent': String(tax.rate)} : {}),
                        ...(isSubjectToVat ? {} : {'cbc:TaxExemptionReasonCode': 'VATEX-EU-O'}),
                        // BR-E-10: Exempt braucht ExemptionReason
                        ...(isExempt ? {'cbc:TaxExemptionReason': 'Umsatzsteuerbefreit gemäß § 3a Abs. 5 UStG'} : {}),
                        'cac:TaxScheme': {'cbc:ID': tax.typeCode}
                    }
                }
            })
        }
    ]
}

function buildLegalMonetaryTotal(ci: CommonInvoice): Record<string, unknown> {
    return {
        'cbc:LineExtensionAmount': formatAmount(ci.totals.lineTotal),
        'cbc:LineExtensionAmount@currencyID': ci.currency,
        'cbc:TaxExclusiveAmount': formatAmount(ci.totals.taxBasisTotal),
        'cbc:TaxExclusiveAmount@currencyID': ci.currency,
        'cbc:TaxInclusiveAmount': formatAmount(ci.totals.grandTotal),
        'cbc:TaxInclusiveAmount@currencyID': ci.currency,
        ...(ci.totals.totalPrepaidAmount === undefined
            ? {}
            : {
                  'cbc:PrepaidAmount': formatAmount(ci.totals.totalPrepaidAmount),
                  'cbc:PrepaidAmount@currencyID': ci.currency
              }),
        'cbc:PayableAmount': formatAmount(ci.totals.duePayable),
        'cbc:PayableAmount@currencyID': ci.currency
    }
}

function buildItemProperties(item: CommonInvoice['lineItems'][number]): Record<string, unknown>[] {
    const properties: Record<string, unknown>[] = []

    // ✅ Vertragsnummer als AdditionalItemProperty — semantisch korrekt
    if (item.contractReference !== undefined) {
        properties.push({
            'cbc:Name': 'Vertragsnummer',
            'cbc:Value': item.contractReference
        })
    }

    if (item.subscriberInfo?.phoneNumber !== undefined) {
        properties.push({
            'cbc:Name': 'Rufnummer',
            'cbc:Value': item.subscriberInfo.phoneNumber
        })
    }

    if (item.subscriberInfo?.name !== undefined) {
        properties.push({
            'cbc:Name': 'Teilnehmer',
            'cbc:Value': item.subscriberInfo.name
        })
    }

    if (item.subscriberInfo?.network !== undefined) {
        properties.push({
            'cbc:Name': 'Netz',
            'cbc:Value': item.subscriberInfo.network
        })
    }

    if (item.subscriberInfo?.tariff !== undefined) {
        properties.push({
            'cbc:Name': 'Tarif',
            'cbc:Value': item.subscriberInfo.tariff
        })
    }

    if (item.contentProvider?.contact !== undefined) {
        properties.push({
            'cbc:Name': 'Content Provider Kontaktadresse',
            'cbc:Value': item.contentProvider.contact
        })
    }

    if (item.contentProvider?.services !== undefined) {
        properties.push({
            'cbc:Name': 'Content Provider Dienste Nutzung',
            'cbc:Value': item.contentProvider.services
        })
    }

    return properties
}

function buildInvoiceLines(ci: CommonInvoice): Record<string, unknown>[] {
    return ci.lineItems.map((item) => {
        const itemProperties = buildItemProperties(item)
        const isSubjectToVat = item.tax.categoryCode !== TaxCategoryCode.OUTSIDE_SCOPE

        return {
            'cbc:ID': String(item.id),
            'cbc:InvoicedQuantity': String(item.quantity),
            'cbc:InvoicedQuantity@unitCode': UNIT_CODE[item.unitCode],
            'cbc:LineExtensionAmount': formatAmount(item.netAmount),
            'cbc:LineExtensionAmount@currencyID': ci.currency,
            ...(item.period === undefined
                ? {}
                : {
                      'cac:InvoicePeriod': {
                          ...(item.period.start === undefined ? {} : {'cbc:StartDate': item.period.start}),
                          ...(item.period.end === undefined ? {} : {'cbc:EndDate': item.period.end})
                      }
                  }),
            ...(item.description === undefined ? {} : {'cbc:Note': item.description}),
            'cac:Item': {
                'cbc:Name': item.name,
                ...(item.description === undefined ? {} : {'cbc:Description': item.description}),
                ...(itemProperties.length === 0
                    ? {}
                    : {
                          'cac:AdditionalItemProperty': itemProperties
                      }),
                'cac:ClassifiedTaxCategory': {
                    'cbc:ID': item.tax.categoryCode,
                    // BR-O-05: CategoryCode O darf keine Rate haben
                    ...(isSubjectToVat ? {'cbc:Percent': String(item.tax.rate)} : {}),
                    'cac:TaxScheme': {'cbc:ID': item.tax.typeCode}
                }
            },
            'cac:Price': {
                // BR-27: Negativer Preis nicht erlaubt → absoluter Wert, netAmount trägt das Vorzeichen
                'cbc:PriceAmount': formatAmount(Math.abs(item.unitPrice)),
                'cbc:PriceAmount@currencyID': ci.currency
            }
        }
    })
}

export function buildSeller(ci: CommonInvoice): Record<string, unknown> {
    const seller = ci.seller
    const party: Record<string, unknown> = {
        'cac:PartyName': {
            'cbc:Name': seller.name
        },
        'cac:PostalAddress': {
            'cbc:StreetName': seller.postalAddress.streetName ?? '',
            'cbc:CityName': seller.postalAddress.cityName,
            'cbc:PostalZone': seller.postalAddress.postalCode,
            'cac:Country': {
                'cbc:IdentificationCode': seller.postalAddress.countryCode
            }
        },
        'cac:PartyLegalEntity': {
            'cbc:RegistrationName': seller.name,
            ...(seller.legalOrganization?.id === undefined
                ? {}
                : {
                      'cbc:CompanyID': seller.legalOrganization.id.value
                  })
        }
    }

    // Elektronische Adresse
    if (seller.electronicAddress !== undefined) {
        party['cbc:EndpointID'] = seller.electronicAddress.value
        party['cbc:EndpointID@schemeID'] = seller.electronicAddress.schemeId
    }

    // Steuerregistrierung
    if (seller.taxRegistration !== undefined && seller.taxRegistration.length > 0) {
        party['cac:PartyTaxScheme'] = seller.taxRegistration.map((tr) => ({
            'cbc:CompanyID': tr.id.value,
            'cac:TaxScheme': {
                'cbc:ID': tr.id.schemeId
            }
        }))
    }

    // Kontakt
    if (seller.contact !== undefined) {
        party['cac:Contact'] = {
            ...(seller.contact.name === undefined ? {} : {'cbc:Name': seller.contact.name}),
            ...(seller.contact.telephone === undefined ? {} : {'cbc:Telephone': seller.contact.telephone}),
            ...(seller.contact.email === undefined ? {} : {'cbc:ElectronicMail': seller.contact.email})
        }
    }

    return {'cac:Party': party}
}

export function buildBuyer(ci: CommonInvoice): Record<string, unknown> {
    const buyer = ci.buyer
    const party: Record<string, unknown> = {
        'cac:PartyName': {
            'cbc:Name': buyer.name
        },
        'cac:PostalAddress': {
            'cbc:StreetName': buyer.postalAddress.streetName ?? '',
            ...(buyer.postalAddress.addressLine !== undefined && {'cbc:AdditionalStreetName': buyer.postalAddress.addressLine}),
            'cbc:CityName': buyer.postalAddress.cityName,
            'cbc:PostalZone': buyer.postalAddress.postalCode,
            'cac:Country': {
                'cbc:IdentificationCode': buyer.postalAddress.countryCode
            }
        },
        'cac:PartyLegalEntity': {
            'cbc:RegistrationName': buyer.name
        }
    }

    if (buyer.electronicAddress !== undefined) {
        party['cbc:EndpointID'] = buyer.electronicAddress.value
        party['cbc:EndpointID@schemeID'] = buyer.electronicAddress.schemeId
    }

    if (buyer.contact !== undefined) {
        party['cac:Contact'] = {
            ...(buyer.contact.name !== undefined && {'cbc:Name': buyer.contact.name}),
            ...(buyer.contact.telephone !== undefined && {'cbc:Telephone': buyer.contact.telephone}),
            ...(buyer.contact.email !== undefined && {'cbc:ElectronicMail': buyer.contact.email})
        }
    }

    return {'cac:Party': party}
}

export function buildPaymentMeans(pm: CommonInvoice['paymentMeans'][number]): Record<string, unknown> {
    const result: Record<string, unknown> = {
        'cbc:PaymentMeansCode': PAYMENT_MEANS_CODE[pm.typeCode]
    }

    if (pm.information !== undefined) {
        result['cbc:PaymentMeansCode@name'] = pm.information
    }

    if (pm.payeeAccount !== undefined) {
        result['cac:PayeeFinancialAccount'] = {
            ...(pm.payeeAccount.iban === undefined ? {} : {'cbc:ID': pm.payeeAccount.iban}),
            ...(pm.payeeAccount.accountName === undefined ? {} : {'cbc:Name': pm.payeeAccount.accountName}),
            ...(pm.payeeInstitution?.bic === undefined
                ? {}
                : {
                      'cac:FinancialInstitutionBranch': {
                          'cbc:ID': pm.payeeInstitution.bic
                      }
                  })
        }
    }

    if (pm.card?.primaryAccountNumber !== undefined || pm.card?.holderName !== undefined) {
        result['cac:CardAccount'] = {
            ...(pm.card.primaryAccountNumber !== undefined && {'cbc:PrimaryAccountNumberID': pm.card.primaryAccountNumber}),
            ...(pm.card.holderName !== undefined && {'cbc:HolderName': pm.card.holderName})
        }
    }

    if (pm.mandate?.reference !== undefined) {
        result['cac:PaymentMandate'] = {
            'cbc:ID': pm.mandate.reference
        }
    }

    return result
}

export function formatAmount(value: number): string {
    return value.toFixed(2)
}

const INVOICE_TYPE_CODE: Record<InvoiceType, string> = {
    [InvoiceType.COMMERCIAL]: '380',
    [InvoiceType.CREDIT_NOTE]: '381',
    [InvoiceType.CORRECTED]: '384',
    [InvoiceType.SELF_BILLING]: '389' // ← neu
}

const UNIT_CODE: Record<UnitCode, string> = {
    [UnitCode.PIECE]: 'C62',
    [UnitCode.HOUR]: 'HUR',
    [UnitCode.DAY]: 'DAY',
    [UnitCode.MONTH]: 'MON',
    [UnitCode.FLAT_RATE]: 'LS'
}

const PAYMENT_MEANS_CODE: Record<PaymentMeansCode, string> = {
    [PaymentMeansCode.CREDIT_TRANSFER]: '58',
    [PaymentMeansCode.SEPA_DIRECT_DEBIT]: '59',
    [PaymentMeansCode.CASH]: '10',
    [PaymentMeansCode.CARD]: '48'
}
