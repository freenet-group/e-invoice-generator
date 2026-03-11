import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {PDFDocument, StandardFonts} from 'pdf-lib'
import {parseMcbsXml, mapMcbsToCommonInvoice} from '../../src/adapters/mcbs/mcbsInvoiceMapper'
import {generateEInvoice} from '../../src/services/eInvoiceGeneratorService'
import type {CommonInvoice} from '../../src/models/commonInvoice'

const FIXTURE_PATH = path.resolve(__dirname, '../resources/mcbs/mcbs-real-invoice.xml')
const OUTPUT_DIR = path.resolve(__dirname, '../output')
const OUTPUT_PDF = path.join(OUTPUT_DIR, 'mcbs-real-invoice-e-rechnung.pdf')

async function createPdfWithInvoiceData(invoiceNo: string, recipientName: string): Promise<Uint8Array> {
    const doc = await PDFDocument.create()
    const page = doc.addPage([595, 842])
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const boldFont = await doc.embedFont(StandardFonts.HelveticaBold)

    page.drawText('Rechnung / Invoice', {x: 40, y: 780, size: 18, font: boldFont})
    page.drawText(`Rechnungsnummer: ${invoiceNo}`, {x: 40, y: 740, size: 12, font})
    page.drawText(`Empfänger: ${recipientName}`, {x: 40, y: 720, size: 12, font})
    page.drawText('(Testdokument für ZUGFeRD E-Rechnung)', {x: 40, y: 680, size: 10, font})

    return doc.save()
}

describe('MCBS Real Invoice → ZUGFeRD E-Rechnung Integration', () => {
    let xmlContent: string
    let rawData: ReturnType<typeof parseMcbsXml>
    let commonInvoice: CommonInvoice
    let sourcePdfBytes: Uint8Array
    let resultBytes: Uint8Array

    beforeAll(async () => {
        xmlContent = await fs.readFile(FIXTURE_PATH, 'utf-8')
    })

    it('liest die Fixture-Datei', () => {
        expect(xmlContent).toBeTruthy()
        expect(xmlContent.length).toBeGreaterThan(100)
    })

    describe('Parsing + ZUGFeRD-Erzeugung', () => {
        beforeAll(async () => {
            const metadata = {
                source: <const>'MCBS',
                timestamp: new Date().toISOString(),
                sourcePdfKey: 'raw/pdf/mcbs-real-invoice.pdf'
            }
            rawData = parseMcbsXml(xmlContent, 'mcbs-real-invoice.xml', metadata)
            commonInvoice = mapMcbsToCommonInvoice(rawData)

            sourcePdfBytes = await createPdfWithInvoiceData(commonInvoice.invoiceNumber, commonInvoice.buyer.name)

            const result = await generateEInvoice(commonInvoice, {
                profile: 'factur-x-en16931',
                pdf: sourcePdfBytes,
                pdfFilename: 'mcbs-real-invoice.pdf'
            })

            resultBytes = <Uint8Array>result
        })

        it('parst MCBS XML und mappt in CommonInvoice', () => {
            expect(rawData).toBeDefined()
            expect(rawData.metadata.source).toBe('MCBS')

            expect(commonInvoice).toBeDefined()
            expect(commonInvoice.invoiceNumber).toBe('M26008957394')
            expect(commonInvoice.totals.grandTotal).toBeGreaterThan(0)
            expect(commonInvoice.buyer.name).toBeTruthy()
        })

        it('erstellt ein valides Ausgangs-PDF', () => {
            expect(sourcePdfBytes).toBeInstanceOf(Uint8Array)
            expect(sourcePdfBytes[0]).toBe(0x25)
            expect(sourcePdfBytes[1]).toBe(0x50)
            expect(sourcePdfBytes[2]).toBe(0x44)
            expect(sourcePdfBytes[3]).toBe(0x46)
            expect(sourcePdfBytes.length).toBeGreaterThan(500)
        })

        it('generiert ein gültiges PDF mit eingebetteter factur-x.xml', () => {
            expect(resultBytes).toBeInstanceOf(Uint8Array)

            expect(resultBytes[0]).toBe(0x25)
            expect(resultBytes[1]).toBe(0x50)
            expect(resultBytes[2]).toBe(0x44)
            expect(resultBytes[3]).toBe(0x46)
            expect(resultBytes.length).toBeGreaterThan(sourcePdfBytes.length)

            const pdfAsText = Buffer.from(resultBytes).toString('latin1')
            expect(pdfAsText).toContain('/EmbeddedFile')
            expect(pdfAsText).toContain('/Type /Catalog')
            expect(pdfAsText).toContain('factur-x.xml')
        })

        it('enthält Factur-X Metadaten im erzeugten Dokument', () => {
            const pdfAsText = Buffer.from(resultBytes).toString('latin1')
            expect(pdfAsText).toContain('factur-x.xml')
            expect(pdfAsText).toContain('fx:DocumentFileName')
            expect(pdfAsText).toContain('Factur-X PDFA Extension Schema')
            expect(pdfAsText).toContain('urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#')
        })

        it('speichert das erzeugte E-Rechnungs-PDF auf der Festplatte', async () => {
            await fs.mkdir(OUTPUT_DIR, {recursive: true})
            await fs.writeFile(OUTPUT_PDF, resultBytes)

            const stat = await fs.stat(OUTPUT_PDF)
            expect(stat.isFile()).toBe(true)
            expect(stat.size).toBeGreaterThan(0)

            const onDisk = await fs.readFile(OUTPUT_PDF)
            expect(onDisk[0]).toBe(0x25)
            expect(onDisk[1]).toBe(0x50)
            expect(onDisk[2]).toBe(0x44)
            expect(onDisk[3]).toBe(0x46)
        })
    })
})
