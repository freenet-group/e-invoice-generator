import { mkdir, writeFile } from 'node:fs/promises'
import { generateEInvoice } from '../src/services/eInvoiceGeneratorService'
import { CommonInvoice, InvoiceType, TaxCategoryCode } from '../src/models/commonInvoice'

function createInvoice(): CommonInvoice {
    return {
        invoiceNumber: 'INV-VALIDATE-001',
        invoiceDate: '2026-02-22',
        invoiceType: InvoiceType.COMMERCIAL,
        currency: 'EUR',
        source: {
            system: 'MCBS',
            id: 'validate-demo',
            timestamp: '2026-02-22T12:00:00Z',
        },
        seller: {
            name: 'freenet DLS GmbH',
            postalAddress: {
                postalCode: '24937',
                cityName: 'Flensburg',
                countryCode: 'DE',
            },
        },
        buyer: {
            name: 'Erika Mustermann',
            postalAddress: {
                postalCode: '12345',
                cityName: 'Berlin',
                countryCode: 'DE',
            },
        },
        lineItems: [
            {
                id: 1,
                name: 'Validierungsposition',
                quantity: 1,
                unitCode: 'C62',
                unitPrice: 100,
                netAmount: 100,
                tax: {
                    typeCode: 'VAT',
                    categoryCode: TaxCategoryCode.STANDARD,   // Zeile 42
                    rate: 19,
                },
            },
        ],
        paymentMeans: [{ typeCode: '58', information: 'Überweisung' }],
        taxes: [{ typeCode: 'VAT', categoryCode: TaxCategoryCode.STANDARD, rate: 19, basisAmount: 100, calculatedAmount: 19 }],  // Zeile 48
        totals: {
            lineTotal: 100,
            taxBasisTotal: 100,
            taxTotal: 19,
            grandTotal: 119,
            duePayable: 119,
        },
    }
}

async function run(): Promise<void> {
    const result = await generateEInvoice(createInvoice(), {
        profile: 'factur-x-xrechnung',
    })

    if (typeof result !== 'string') {
        throw new TypeError('Expected XML string result for profile factur-x-xrechnung')
    }

    await mkdir('artifacts', { recursive: true })
    const xmlPath = 'artifacts/zugferd-validation.xml'
    await writeFile(xmlPath, result, 'utf-8')
}

run().catch((error: unknown) => {
    console.error(error)
    process.exit(1)
})
