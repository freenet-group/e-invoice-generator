import {z} from 'zod'

// ==================== Hilfsfunktionen ====================

/**
 * Komma-Dezimalzahl (deutsches Format) zu number
 * z.B. "18,4790" → 18.479
 * z.B. "1.234,56" → 1234.56
 */
const germanDecimal = z.string().transform((val: string): number => {
    // Tausenderpunkte entfernen, dann Komma durch Punkt ersetzen
    const normalized: string = val.trim().replaceAll('.', '').replaceAll(',', '.')
    const parsed: number = Number(normalized)

    if (!Number.isFinite(parsed)) {
        throw new TypeError('Expected German decimal number')
    }

    return parsed
})

/**
 * Deutsches Datum zu ISO 8601
 * z.B. "09.02.2026" → "2026-02-09"
 */
const germanDate = z
    .string()
    .regex(/^\d{2}\.\d{2}\.\d{4}$/, 'Expected German date format DD.MM.YYYY')
    .transform((val: string): string => {
        const parts = val.split('.')
        if (parts.length !== 3) {
            throw new TypeError('Expected German date format DD.MM.YYYY')
        }

        const [day, month, year] = parts
        return `${year}-${month}-${day}`
    })

/**
 * XML-Einzelelement oder Array → immer Array
 */
function xmlArray<T extends z.ZodType>(schema: T): z.ZodType<z.infer<T>[]> {
    return z.preprocess((val): unknown[] => {
        if (Array.isArray(val)) {
            return val
        }
        if (val === undefined || val === null) {
            return []
        }
        return [val]
    }, z.array(schema))
}

// ==================== BILLITEM ====================

const McbsBillItemSchema = z.object({
    SEQUENCE_NO: z.coerce.number().optional(),
    INFO_ITEM: z.string().optional(),
    COUNTER: z.coerce.number().optional(),
    TYPE: z.string().optional(),
    PRODUCT_TYPE: z.string().optional(),
    PRODUCT_NAME: z.coerce.string(),
    PRODUCT_CODE: z.coerce.string().optional(),
    PERIOD: z.string().optional(),
    CHARGE: germanDecimal.or(z.literal('').transform(() => 0)).default(0),
    VAT_RATE: z.union([z.coerce.number(), z.literal('INCLUDED')]).default(19),
    BILLING_REF: z.coerce.string().optional(),
    CONNECT_CAT: z.string().optional(),
    ADVERTISING: z.string().optional(),
    OPT_PARAMS: z
        .object({
            CONT_PROVIDER: z
                .object({
                    ID: z.coerce.string().optional(),
                    CONTACT: z.string().optional(),
                    SERVICES: z.string().optional()
                })
                .optional()
        })
        .optional()
})

export type McbsBillItem = z.infer<typeof McbsBillItemSchema>

// ==================== BILLITEM_GRP ====================

const McbsBillItemGrpSchema = z.object({
    TITLE: z.string().optional(),
    PERIOD: z.string().optional(),
    CHARGE: germanDecimal.optional(),
    BILLITEMS: z
        .object({
            BILLITEM: xmlArray(McbsBillItemSchema)
        })
        .optional()
})

// ==================== SECTION ====================

const McbsSectionSchema = z.object({
    TITLE: z.string().optional(),
    SHOW_SUBTOTAL: z.string().optional(),
    SUBTOTAL: germanDecimal.optional(),
    BILLITEM_GRPS: z
        .object({
            BILLITEM_GRP: xmlArray(McbsBillItemGrpSchema)
        })
        .optional()
})

// ==================== UNIT ====================

const McbsUnitSchema = z.object({
    SEQUENCE_NO: z.coerce.number().optional(),
    CONTRACT_DATA: z
        .object({
            TYPE: z.string().optional(),
            CONTRACT_NO: z.coerce.string().optional(),
            TARIFF: z.string().optional(),
            NETWORK: z.string().optional(),
            CUSTOMER_NO: z.coerce.string().optional(),
            TCS_TITLE: z.string().optional(),
            TCS_VALUE: z.string().optional(),
            CONNECTS: z
                .object({
                    CONNECT: xmlArray(
                        z.object({
                            TYPE: z.string().optional(),
                            TITLE: z.string().optional(),
                            CONNECT_NO: z.coerce.string().optional(), // ← coerce statt string
                            CONNECT_NO_F: z.coerce.string().optional(), // ← coerce statt string
                            SIM_NO: z.coerce.string().optional() // ← coerce statt string
                        })
                    )
                })
                .optional()
        })
        .optional(),
    SECTIONS: z
        .object({
            SECTION: xmlArray(McbsSectionSchema)
        })
        .optional()
})

// ==================== FRAME ====================

const McbsFrameSchema = z.object({
    ID: z.string().optional(),
    TITLE: z.string().optional(),
    AREA: z
        .object({
            ID: z.string().optional(),
            UNIT: xmlArray(McbsUnitSchema)
        })
        .optional()
})

// ==================== AMOUNTS ====================

const McbsAmountTypeSchema = z.enum([
    'INSEP_GROSS',
    'SUBTOTAL',
    'TOTAL',
    'TOTAL_NET',
    'TOTAL_VAT',
    'UNPAID', // ← neu
    'TO_PAY', // ← neu
    'PRIMARY_SUM' // ← neu (kommt im VOUCHER FRAME vor)
])

const McbsAmountSchema = z.object({
    TYPE: McbsAmountTypeSchema,
    VALUE: germanDecimal
})

const McbsAmountsSchema = z
    .object({
        AMOUNT: xmlArray(McbsAmountSchema)
    })
    .transform((val) => {
        const find = (type: z.infer<typeof McbsAmountTypeSchema>): number => val.AMOUNT.find((a) => a.TYPE === type)?.VALUE ?? 0

        const findOptional = (type: z.infer<typeof McbsAmountTypeSchema>): number | undefined => {
            const found = val.AMOUNT.find((a) => a.TYPE === type)
            return found?.VALUE
        }

        return {
            NET_AMOUNT: find('TOTAL_NET'),
            VAT_AMOUNT: find('TOTAL_VAT'),
            GROSS_AMOUNT: find('TOTAL'),
            SUBTOTAL: find('SUBTOTAL'),
            INSEP_GROSS: find('INSEP_GROSS'),
            UNPAID: findOptional('UNPAID'), // optional — nicht immer vorhanden
            TO_PAY: findOptional('TO_PAY') // optional — nicht immer vorhanden
        }
    })

// ==================== DIFF_VAT ====================

const McbsDiffVatSchema = z.object({
    VAT_RATE: z.coerce.number(),
    VAT: germanDecimal,
    NET: germanDecimal
})

// ==================== PAYMENT_MODE ====================

const McbsPaymentModeSchema = z.object({
    PAYMENT_TYPE: z
        .enum(['SEPADEBIT', 'SEPACREDIT', 'INVOICE', 'SEF', 'ZERO', 'NO_SEPADEBIT', 'CREDITCARD', 'INFO'])
        .default('INVOICE'),
    LEDGER_ACCOUNT: z.string().optional(),
    ACCOUNT_OWNER: z
        .object({
            CUSTOMER_DIFF: z.string(),
            OWNER_NAME: z.string().optional()
        })
        .optional(),
    SEPA_MANDATE: z.string().optional().nullable(),
    BANK_ACCOUNT: z.string().optional().nullable(),
    BANK_CODE: z.string().optional().nullable(),
    CARD_END_DATE: z.string().optional(),
    PAYMENT_TERM: z.coerce.string().optional(),
    DUE_DATE: germanDate.optional(),
    CARD_PROVIDER: z.string().optional(),
    CARD_NUMBER: z.string().optional(),
    CARD_HOLDER: z.string().optional(),
    CARD_EXPIRATION: z.string().optional()
})

// ==================== HEADER ====================

const DeliveryModeSchema = z
    .object({
        SUPPLY: z
            .object({
                TYPE: z.string(),
                ENTRY: z.string().optional() // Leitweg-ID bei PEPPOL_PA
            })
            .optional()
    })
    .optional()

const McbsHeaderSchema = z.object({
    INVOICE_DATE: germanDate,
    INVOICE_NO: z.string().optional(),
    INVOICE_DEF: z.coerce.string().optional(),
    INV_CURRENCY: z.string().default('EUR'),
    BILLRUN_ID: z.coerce.string().optional(),
    BILLING_SYSTEM: z.string().optional(),
    SOURCE_SYSTEM: z.string().optional(),
    MANDANT: z.string().optional(),
    CLIENTBANK_ACNT: z.string().optional(),
    CLIENTBANK_CODE: z.string().optional(),
    BRAND: z
        .object({
            DESC: z.string().optional(),
            CODE_DESC: z.string().optional(),
            GROUP_SHORTCUT: z.string().optional()
        })
        .optional(),
    DELIVERY_MODE: DeliveryModeSchema
})

// ==================== ADDRESS ====================

const McbsAddressSchema = z.object({
    SHORT_OPENING: z.enum(['Herr', 'Frau', 'Firma']).optional(),
    FIRSTNAME: z.string().optional(),
    NAME: z.string().optional(),
    DEPARTMENT: z.string().optional(),
    ADDITIONAL: z.string().optional(),
    STREET: z.string().optional(),
    POSTCODE: z.coerce.string().optional(),
    CITY: z.string().optional(),
    COUNTRY: z
        .string()
        .optional()
        .transform((val) => (val === '' || val === undefined ? 'DE' : val)) // ← default greift nicht bei ''
})

// ==================== ROOT DOCUMENT ====================

export const McbsDocumentSchema = z.object({
    TYPE: z.string().default('RG'),
    ID: z.coerce.string(),
    HEADER: McbsHeaderSchema,
    RECIPIENT: z.object({
        PERSON_NO: z.coerce
            .string()
            .optional()
            .transform((val) => (val === '' ? undefined : val)), // ← '' → undefined
        ADDRESS: McbsAddressSchema
    }),
    CUSTOMER: z
        .object({
            PERSON_NO: z.coerce
                .string()
                .optional()
                .transform((val) => (val === '' ? undefined : val)), // ← '' → undefined
            VAT_ID: z
                .string()
                .optional()
                .transform((val) => (val === '' ? undefined : val)) // ← '' → undefined
        })
        .optional(),
    INVOICE_DATA: z.object({
        PAYMENT_MODE: McbsPaymentModeSchema,
        FRAMES: z.object({
            FRAME: xmlArray(McbsFrameSchema),
            AMOUNTS: McbsAmountsSchema,
            DIFF_VATS: z.object({
                DIFF_VAT: xmlArray(McbsDiffVatSchema).optional()
            })
        })
    })
})

export type McbsDocument = z.infer<typeof McbsDocumentSchema>

export const McbsXmlRootSchema = z.object({
    DOCUMENT: McbsDocumentSchema
})

export type McbsXmlRoot = z.infer<typeof McbsXmlRootSchema>

export function parseMcbsDocument(raw: Record<string, unknown>): McbsDocument {
    const result = McbsDocumentSchema.safeParse(raw)
    if (!result.success) {
        const issues = result.error.issues
            .map((i) => {
                const path = i.path.length > 0 ? i.path.join('.') : '(root)'
                return `  ${path}: ${i.message}`
            })
            .join('\n')
        throw new Error(`Invalid MCBS XML structure:\n${issues}`)
    }
    return result.data
}
