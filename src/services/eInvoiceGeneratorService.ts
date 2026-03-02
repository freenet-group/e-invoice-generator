/**
 * E-Invoice Generator Service
 *
 * Generiert ZUGFeRD/Factur-X XML (oder PDF mit eingebettetem XML) aus CommonInvoice
 * via @e-invoice-eu/core Library.
 *
 * Orchestrierung liegt im EInvoiceProcessingService (Handler-Schicht).
 */

import {
    InvoiceService,
    type InvoiceServiceOptions,
    type Logger,
} from '@e-invoice-eu/core'
import { CommonInvoice } from '../models/commonInvoice'
import { logger } from '../core/logger'
import { mapToEInvoice } from '../mappers/eInvoiceMapper'
export type { InvoiceFormat } from '../config/eInvoiceProfileConfiguration'
import type { InvoiceFormat } from '../config/eInvoiceProfileConfiguration'

export interface EInvoiceGeneratorOptions {
    /** E-Invoice Format/Profil (default: factur-x-en16931) */
    profile?: InvoiceFormat
    /** PDF als Uint8Array zum Einbetten */
    pdf?: Uint8Array
    /** PDF Dateiname */
    pdfFilename?: string
}

const serviceLogger = logger.child({ name: 'EInvoiceGenerator' })

const lambdaLogger: Logger = {
    log(m: string): void {
        serviceLogger.info(m)
    },
    warn(m: string): void {
        serviceLogger.warn(m)
    },
    error(m: string): void {
        serviceLogger.error(m)
    },
}

/**
 * Generiert ZUGFeRD/Factur-X XML (oder PDF mit eingebettetem XML) aus CommonInvoice
 *
 * @param commonInvoice - Das interne Invoice-Modell
 * @param options - Profil und optionales PDF
 * @returns XML-String oder PDF-Buffer mit eingebettetem XML
 */
export async function generateEInvoice(
    commonInvoice: CommonInvoice,
    options?: EInvoiceGeneratorOptions
): Promise<string | Uint8Array> {
    const profile = options?.profile ?? 'factur-x-en16931'
    const invoice = mapToEInvoice(commonInvoice)

    const serviceOptions: InvoiceServiceOptions = {
        format: profile,
        lang: 'de',
        noWarnings: true,
    }

    // ZUGFeRD XML in das PDF einbetten (PDF/A-3 Attachment)
    if (options?.pdf !== undefined) {
        serviceOptions.pdf = {
            buffer: options.pdf,
            filename: options.pdfFilename ?? `${commonInvoice.invoiceNumber}.pdf`,
            mimetype: 'application/pdf',
        }
    }

    const service = new InvoiceService(lambdaLogger)
    try {
        return await service.generate(invoice, serviceOptions)
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        logger.error(
            { invoiceNumber: commonInvoice.invoiceNumber, error: message },
            'E-Invoice Generierung fehlgeschlagen'
        )
        throw e
    }
}
