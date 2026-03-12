/**
 * FatalProcessingError
 *
 * Kennzeichnet Fehler, die durch einen Retry nicht behebbar sind.
 * Ursache liegt in den Eingabedaten oder der Geschäftslogik (kein Infrastrukturproblem).
 *
 * Beispiele:
 * - Ungültige MCBS XML-Struktur (Zod-Validierungsfehler)
 * - Fehlende Pflichtfelder (PERSON_NO, INVOICE_DEF)
 * - Fehler bei der ZUGFeRD-XML-Generierung (Mapping/Struktur)
 *
 * Diese Fehler werden in processBatch direkt an die Fatal-DLQ weitergeleitet
 * und nicht als batchItemFailure zurückgegeben (kein SQS-Retry).
 */
export class FatalProcessingError extends Error {
    readonly source: string
    readonly originalError: Error

    constructor(message: string, source: string, cause: Error) {
        super(`[${source}] ${message}`)
        this.name = 'FatalProcessingError'
        this.source = source
        this.originalError = cause
        this.cause = cause
    }
}
