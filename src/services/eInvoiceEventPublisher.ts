import path from 'node:path'
import {z} from 'zod'
import {PublishCommand} from '@aws-sdk/client-sns'
import {snsClient} from '../core/sns/snsClient'
import type {CommonInvoice} from '../models/commonInvoice'
import {INVOICE_SOURCES} from '../models/commonInvoice'

export const BILLING_DOCUMENT_TYPES = <const>['COMMERCIAL_INVOICE', 'CREDIT_NOTE', 'CORRECTED_INVOICE', 'SELF_BILLING']
export type BillingDocumentType = (typeof BILLING_DOCUMENT_TYPES)[number]

export const MEDIA_TYPES = <const>['application/pdf', 'application/xml']
export type MediaType = (typeof MEDIA_TYPES)[number]

export interface EInvoiceCreatedEventParams {
    billingDocumentId: string
    partyId: string
    billingAccountId: string
    s3Key: string
    bucketName: string
    profile: string
    source: CommonInvoice['source']['system']
    context: string
    billingDocumentType: BillingDocumentType
    mediaType: MediaType
    correlationId: string
}

export const EInvoiceCreatedEventSchema = z.object({
    eventDate: z.iso.datetime(),
    correlationId: z.string(),
    billingDocumentType: z.enum(BILLING_DOCUMENT_TYPES),
    billingDocumentId: z.string(),
    partyId: z.string(),
    billingAccountId: z.string(),
    profile: z.string(),
    fileName: z.string(),
    mediaType: z.enum(MEDIA_TYPES),
    s3URI: z.string().startsWith('s3://')
})

export type EInvoiceCreatedEvent = z.infer<typeof EInvoiceCreatedEventSchema>

export const EInvoiceMessageAttributesSchema = z.object({
    eventType: z.enum(['CustomerBill:DocumentCreated', 'BusinessPartnerSettlement:DocumentCreated']),
    context: z.string(),
    source: z.enum(INVOICE_SOURCES),
    billingDocumentType: z.enum(BILLING_DOCUMENT_TYPES),
    profile: z.string(),
    mediaType: z.enum(MEDIA_TYPES)
})

export type EInvoiceMessageAttributes = z.infer<typeof EInvoiceMessageAttributesSchema>

function resolveEventType(source: CommonInvoice['source']['system']): EInvoiceMessageAttributes['eventType'] {
    return source === 'PARTNER_COMMISSION' ? 'BusinessPartnerSettlement:DocumentCreated' : 'CustomerBill:DocumentCreated'
}

export async function publishEInvoiceCreated(params: EInvoiceCreatedEventParams): Promise<void> {
    const topicArn = process.env['E_INVOICE_TOPIC_ARN']
    if (topicArn === undefined || topicArn === '') {
        throw new Error('E_INVOICE_TOPIC_ARN environment variable is not set')
    }

    const s3URI = `s3://${params.bucketName}/${params.s3Key}`

    const event: EInvoiceCreatedEvent = {
        eventDate: new Date().toISOString(),
        correlationId: params.correlationId,
        billingDocumentType: params.billingDocumentType,
        billingDocumentId: params.billingDocumentId,
        partyId: params.partyId,
        billingAccountId: params.billingAccountId,
        profile: params.profile,
        fileName: path.basename(params.s3Key),
        mediaType: params.mediaType,
        s3URI
    }

    const attributes: EInvoiceMessageAttributes = {
        eventType: resolveEventType(params.source),
        context: params.context,
        source: params.source,
        billingDocumentType: params.billingDocumentType,
        profile: params.profile,
        mediaType: params.mediaType
    }

    await snsClient.send(
        new PublishCommand({
            TopicArn: topicArn,
            Subject: 'EInvoice Created',
            Message: JSON.stringify(event),
            MessageAttributes: Object.fromEntries(
                Object.entries(attributes).map(([key, value]) => [key, {DataType: 'String', StringValue: value}])
            )
        })
    )
}
