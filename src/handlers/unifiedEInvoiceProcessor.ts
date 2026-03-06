/**
 * Unified E-Invoice Handler
 *
 * Lambda Handler für die Generierung von ZUGFeRD E-Rechnungen
 * Unterstützt mehrere Input-Quellen via Adapter Pattern
 */

import {SQSEvent} from 'aws-lambda'
import {AdapterRegistry} from '../adapters/adapterRegistry'
import {MCBSAdapter} from '../adapters/mcbs/mcbsInvoiceAdapter'
import {EInvoiceProcessingService} from '../services/eInvoiceProcessingService'
import {logger} from '../core/logger'

const handlerLogger = logger.child({name: 'unified-e-invoice-handler'})

const activeAdapter = process.env['ACTIVE_ADAPTER'] ?? 'custom.mcbs'

const adapterRegistry = new AdapterRegistry()

if (activeAdapter === 'custom.mcbs') {
    adapterRegistry.register(
        'custom.mcbs',
        () =>
            new MCBSAdapter({
                resolvePrimaryKey: (pdfKey: string): string => pdfKey.replace(/\.pdf$/i, '.xml')
            })
    )
} else {
    throw new Error(`Adapter '${activeAdapter}' not yet implemented`)
}

const processingService = new EInvoiceProcessingService({adapterRegistry})

/**
 * Main Lambda Handler
 *
 * Wird durch SQS Queue getriggert (EventBridge → SQS → Lambda)
 * Verarbeitet Batches von bis zu 10 Messages
 */
export const handler = async (event: SQSEvent): Promise<{batchItemFailures: {itemIdentifier: string}[]}> => {
    const totalCount = event.Records.length

    handlerLogger.info({totalCount}, 'Processing SQS batch')

    const result = await processingService.processBatch(event.Records)

    const failedCount = result.batchItemFailures.length
    const successCount = totalCount - failedCount

    if (failedCount > 0) {
        handlerLogger.error(
            {
                totalCount,
                successCount,
                failedCount,
                failedIds: result.batchItemFailures.map((f: {itemIdentifier: string}) => f.itemIdentifier)
            },
            'Batch completed with failures'
        )
    } else {
        handlerLogger.info({totalCount, successCount}, 'Batch completed successfully')
    }

    return result
}
