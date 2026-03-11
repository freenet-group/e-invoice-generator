import {readFile, mkdir, writeFile} from 'node:fs/promises'
import {parseArgs} from 'node:util'
import {parseMcbsXml, mapMcbsToCommonInvoice} from '../src/adapters/mcbs/mcbsInvoiceMapper'
import {generateEInvoice} from '../src/services/eInvoiceGeneratorService'
import {spawnSync} from 'node:child_process'
import * as path from 'node:path'
import * as zlib from 'node:zlib'
import {logger} from '../src/core/logger'

const {values} = parseArgs({
    options: {
        xml: {type: 'string'},
        pdf: {type: 'string'},
        output: {type: 'string', default: '/tmp/zugferd-result.pdf'}
    }
})

function isValidString(value: unknown): value is string {
    return typeof value === 'string' && value !== ''
}

function extractZugferdXml(pdfBytes: Buffer): string | null {
    const text = pdfBytes.toString('latin1')
    const streams = [...text.matchAll(/stream\r?\n/g)]
    for (const m of streams) {
        const start = m.index + m[0].length
        const end = text.indexOf('endstream', start)
        const chunk = pdfBytes.subarray(start, end)
        try {
            const decompressed = zlib.inflateSync(chunk)
            if (decompressed.includes(Buffer.from('CrossIndustryInvoice'))) {
                return decompressed.toString('utf-8')
            }
        } catch {
            // nicht komprimiert oder anderer Stream
        }
    }
    return null
}

function filterKositOutput(output: string): string {
    const lines = output.split('\n')
    const result: string[] = []
    let inCssBlock = false

    for (const line of lines) {
        const trimmed = line.trim()

        // [Format error!] XML/HTML-Blob als einzelne lange Zeile unterdrücken
        if (trimmed.startsWith('[Format error!]')) {
            continue
        }
        if (trimmed.startsWith('<?xml') && trimmed.includes('<rep:report')) {
            continue
        }

        // Lange Zeilen mit HTML-Inhalt unterdrücken
        if (line.length > 200 && (trimmed.includes('</') || trimmed.includes('<div') || trimmed.includes('<td'))) {
            continue
        }

        // CSS-Block Start erkennen (mehrzeilig)
        if (
            trimmed.startsWith('table {') ||
            trimmed.startsWith('table.') ||
            trimmed.startsWith('thead {') ||
            trimmed.startsWith('td.') ||
            trimmed.startsWith('tr {') ||
            trimmed.startsWith('div.') ||
            trimmed.startsWith('p.') ||
            trimmed.startsWith('.tbl-') ||
            trimmed.startsWith('.error') ||
            trimmed.startsWith('.warning') ||
            trimmed.startsWith('.metadata') ||
            trimmed.startsWith('body {')
        ) {
            inCssBlock = true
        }

        if (inCssBlock) {
            // CSS-Block endet wenn eine Nicht-CSS-Zeile kommt
            if (
                trimmed === '' ||
                trimmed.startsWith('Processing') ||
                trimmed.startsWith('Results') ||
                trimmed.startsWith('|') ||
                trimmed.startsWith('-') ||
                trimmed.startsWith('Acceptable') ||
                trimmed.startsWith('#') ||
                trimmed.startsWith('[') ||
                trimmed.startsWith('Loaded') ||
                trimmed.startsWith('Using') ||
                trimmed.startsWith('The following')
            ) {
                inCssBlock = false
            } else {
                continue
            }
        }

        if (trimmed !== '') {
            result.push(line)
        }
    }

    return result.join('\n')
}

async function runKositValidation(xmlPath: string, rootDir: string): Promise<void> {
    const validatorJar = path.join(rootDir, 'tools/validator/validator.jar')
    const configDir = path.join(rootDir, 'tools/validator/config')
    const scenariosXml = path.join(configDir, 'scenarios.xml')
    const reportDir = path.join(rootDir, 'artifacts/validator-report')

    await mkdir(reportDir, {recursive: true})

    const result = spawnSync(
        'java',
        ['-jar', validatorJar, '-s', scenariosXml, '-r', configDir, '-o', reportDir, '-p', xmlPath],
        {encoding: 'utf-8'}
    )

    const output = (result.stdout === '' ? '' : result.stdout) + (result.stderr === '' ? '' : result.stderr)

    const filtered = filterKositOutput(output)
    logger.info(filtered)

    if (result.status === 0) {
        logger.info(`📋 Report: ${reportDir}`)
    } else {
        logger.warn(`⚠️  KOSIT Validierung fehlgeschlagen — siehe Report in ${reportDir}`)
    }
}

async function run(): Promise<void> {
    const xmlValid = isValidString(values.xml)
    const pdfValid = isValidString(values.pdf)

    if (!xmlValid || !pdfValid) {
        logger.error('Usage: ts-node convert-mcbs-invoice.ts --xml <path> --pdf <path> [--output <path>]')
        process.exit(1)
    }

    const rootDir = path.resolve(__dirname, '..')

    logger.info(`📄 Lade XML: ${values.xml}`)
    const xmlContent = await readFile(<string>values.xml, 'utf-8')

    logger.info(`📄 Lade PDF: ${values.pdf}`)
    const pdfBuffer = await readFile(<string>values.pdf)

    logger.info('🔄 Parse MCBS XML...')
    const rawData = parseMcbsXml(xmlContent, <string>values.xml, {
        source: 'MCBS',
        timestamp: new Date().toISOString(),
        s3Bucket: undefined,
        sourceDataKey: <string>values.xml,
        sourcePdfKey: <string>values.pdf
    })
    const invoice = mapMcbsToCommonInvoice(rawData)
    logger.info(`✅ Rechnung: ${invoice.invoiceNumber}`)

    logger.info('🔄 Generiere ZUGFeRD PDF...')
    const result = await generateEInvoice(invoice, {
        profile: 'factur-x-en16931',
        pdf: pdfBuffer,
        pdfFilename: 'invoice.pdf'
    })

    await mkdir('artifacts', {recursive: true})
    await writeFile(values.output, result)
    logger.info(`✅ ZUGFeRD-PDF gespeichert: ${values.output}`)

    // ZUGFeRD XML aus dem PDF extrahieren und validieren
    logger.info('\n🔍 Validiere eingebettetes ZUGFeRD XML...')
    // KOSIT Validierung

    // Eingebettetes XML extrahieren
    logger.info('\n🔍 Extrahiere eingebettetes ZUGFeRD XML...')
    const pdfResult = Buffer.from(<Uint8Array>result)
    const xmlExtracted = extractZugferdXml(pdfResult)

    if (xmlExtracted === null || xmlExtracted === '') {
        logger.error('❌ Kein ZUGFeRD XML im PDF gefunden!')
        process.exit(1)
    }

    const xmlOutputPath = path.join(rootDir, 'artifacts', `${invoice.invoiceNumber}-factur-x.xml`)
    await writeFile(xmlOutputPath, xmlExtracted, 'utf-8')
    logger.info(`✅ XML extrahiert: ${xmlOutputPath}`)

    logger.info('\n🔍 Starte KOSIT Validierung...')
    await runKositValidation(xmlOutputPath, rootDir)
}

run().catch((e) => {
    logger.error(e)
    process.exit(1)
})
