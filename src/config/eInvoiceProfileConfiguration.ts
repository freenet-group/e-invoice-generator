export const SUPPORTED_FORMATS = <const>[
    'factur-x-minimum',
    'factur-x-basic-wl',
    'factur-x-basic',
    'factur-x-en16931',
    'factur-x-xrechnung'
]

export type InvoiceFormat = (typeof SUPPORTED_FORMATS)[number]

export const DEFAULT_PROFILE: InvoiceFormat = 'factur-x-en16931'
export const DEFAULT_ADAPTER = 'custom.mcbs'

function isInvoiceFormat(s: string): s is InvoiceFormat {
    return (<readonly string[]>SUPPORTED_FORMATS).includes(s)
}

export function getInvoiceFormat(): InvoiceFormat {
    const format = process.env['E_INVOICE_PROFILE'] ?? DEFAULT_PROFILE

    if (!isInvoiceFormat(format)) {
        throw new Error(`Ungültiges E_INVOICE_PROFILE: '${format}'. Erlaubt: ${SUPPORTED_FORMATS.join(', ')}`)
    }

    return format
}
