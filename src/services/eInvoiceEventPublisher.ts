import {PublishCommand} from '@aws-sdk/client-sns'
import {snsClient} from '../core/sns/snsClient'
import type {CommonInvoice} from '../models/commonInvoice'

export type BillingDocumentType = 'COMMERCIAL_INVOICE' | 'CREDIT_NOTE'

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
    mediaType: 'application/pdf' | 'application/xml'
    correlationId: string
}

function resolveEventType(source: CommonInvoice['source']['system']): string {
    return source === 'PARTNER_COMMISSION' ? 'BusinessPartnerSettlement:DocumentCreated' : 'CustomerBill:DocumentCreated'
}

export async function publishEInvoiceCreated(params: EInvoiceCreatedEventParams): Promise<void> {
    const topicArn = process.env['E_INVOICE_TOPIC_ARN']
    if (topicArn === undefined || topicArn === '') {
        throw new Error('E_INVOICE_TOPIC_ARN environment variable is not set')
    }

    const s3URI = `s3://${params.bucketName}/${params.s3Key}`

    await snsClient.send(
        new PublishCommand({
            TopicArn: topicArn,
            Subject: 'EInvoice Created',
            Message: JSON.stringify({
                eventDate: new Date().toISOString(),
                correlationId: params.correlationId,
                billingDocumentType: params.billingDocumentType,
                billingDocumentId: params.billingDocumentId,
                partyId: params.partyId,
                billingAccountId: params.billingAccountId,
                profile: params.profile,
                mediaType: params.mediaType,
                s3URI
            }),
            MessageAttributes: {
                eventType: {
                    DataType: 'String',
                    StringValue: resolveEventType(params.source)
                },
                context: {
                    DataType: 'String',
                    StringValue: params.context
                },
                source: {
                    DataType: 'String',
                    StringValue: params.source
                },
                billingDocumentType: {
                    DataType: 'String',
                    StringValue: params.billingDocumentType
                },
                profile: {
                    DataType: 'String',
                    StringValue: params.profile
                },
                mediaType: {
                    DataType: 'String',
                    StringValue: params.mediaType
                }
            }
        })
    )
}
