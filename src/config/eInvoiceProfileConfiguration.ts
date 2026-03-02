export const SUPPORTED_FORMATS = [
    'factur-x-minimum',
    'factur-x-basic-wl',
    'factur-x-basic',
    'factur-x-en16931',
    'factur-x-xrechnung',
] as const

export type InvoiceFormat = typeof SUPPORTED_FORMATS[number]

export function getInvoiceFormat(): InvoiceFormat {
    const format = process.env['E_INVOICE_PROFILE'] ?? 'factur-x-en16931'

    if (!SUPPORTED_FORMATS.includes(format as InvoiceFormat)) {
        throw new Error(
            `Ungültiges E_INVOICE_PROFILE: '${format}'. Erlaubt: ${SUPPORTED_FORMATS.join(', ')}`
        )
    }

    return format as InvoiceFormat
}
