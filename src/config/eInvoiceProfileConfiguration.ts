export const SUPPORTED_FORMATS = <const>[
    'factur-x-minimum',
    'factur-x-basic-wl',
    'factur-x-basic',
    'factur-x-en16931',
    'factur-x-xrechnung',
]

export type InvoiceFormat = typeof SUPPORTED_FORMATS[number]

export function getInvoiceFormat(): InvoiceFormat {
    const format = process.env['E_INVOICE_PROFILE'] ?? 'factur-x-en16931'

    if (!SUPPORTED_FORMATS.includes(<InvoiceFormat>format)) {
        throw new Error(
            `Ungültiges E_INVOICE_PROFILE: '${format}'. Erlaubt: ${SUPPORTED_FORMATS.join(', ')}`
        )
    }

    return <InvoiceFormat>format
}
