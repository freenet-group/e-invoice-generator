import { mkdir, writeFile } from 'node:fs/promises'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { generateEInvoice } from '../src/services/eInvoiceGeneratorService'
import { CommonInvoice, InvoiceType, TaxCategoryCode } from '../src/models/commonInvoice'

function createInvoice(): CommonInvoice {
    return {
        invoiceNumber: 'INV-VISUAL-001',
        invoiceDate: '2026-02-22',
        invoiceType: InvoiceType.COMMERCIAL,
        currency: 'EUR',
        source: {
            system: 'MCBS',
            id: 'visual-demo',
            timestamp: '2026-02-22T12:00:00Z',
        },
        seller: {
            name: 'freenet DLS GmbH',
            postalAddress: {
                postalCode: '24937',
                cityName: 'Flensburg',
                countryCode: 'DE',
            },
            taxRegistration: [
                {
                    id: {
                        value: 'DE123456789',
                        schemeId: 'VA',
                    },
                },
            ],
            legalOrganization: {
                id: {
                    value: 'HRB-12345',
                    schemeId: 'HRB',
                },
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
                name: 'Beispielleistung',
                quantity: 1,
                unitCode: 'C62',
                unitPrice: 100,
                netAmount: 100,
                tax: {
                    typeCode: 'VAT',
                    categoryCode: TaxCategoryCode.STANDARD,   // Zeile 57
                    rate: 19,
                },
            },
        ],
        paymentMeans: [{ typeCode: '58', information: 'Überweisung' }],
        paymentTerms: {
            description: 'Zahlbar innerhalb von 14 Tagen',
        },
        taxes: [{ typeCode: 'VAT', categoryCode: TaxCategoryCode.STANDARD, rate: 19, basisAmount: 100, calculatedAmount: 19 }],  // Zeile 66
        totals: { lineTotal: 100, taxBasisTotal: 100, taxTotal: 19, grandTotal: 119, duePayable: 119 },
    }
}

async function createInputPdf(): Promise<Uint8Array> {
    const doc = await PDFDocument.create()
    const page = doc.addPage([595, 842])
    const font = await doc.embedFont(StandardFonts.Helvetica)
    page.drawText('Demo-PDF mit eingebetteter ZUGFeRD XML', {
        x: 40,
        y: 780,
        size: 14,
        font,
    })
    return doc.save()
}

async function run(): Promise<void> {
    const invoice = createInvoice()
    const inputPdf = await createInputPdf()
    const zugferdXml = await generateEInvoice(invoice)

    const outDir = 'dist/samples'
    await mkdir(outDir, { recursive: true })

    await writeFile(`${outDir}/zugferd-input.pdf`, Buffer.from(inputPdf))
    await writeFile(`${outDir}/zugferd.xml`, zugferdXml, 'utf8')
}

void run().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
})
