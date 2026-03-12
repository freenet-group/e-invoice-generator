/**
 * Fatal DLQ Processor Handler
 *
 * Wird getriggert, wenn Nachrichten direkt (ohne Retry) in die Fatal Dead Letter Queue
 * gesendet wurden. Ursache: deterministischer Fehler in den Eingabedaten oder der
 * Geschäftslogik (z.B. ungültige MCBS XML-Struktur, fehlende Pflichtfelder).
 *
 * Im Gegensatz zur normalen DLQ wurden diese Nachrichten bewusst nicht retried –
 * sie müssen vom Dev-Team analysiert und die Ursache in den Quelldaten behoben werden.
 */

import type {SQSEvent, SQSHandler} from 'aws-lambda'
import {SNSClient, PublishCommand} from '@aws-sdk/client-sns'
import {logger} from '../core/logger'
import type {FatalDlqMessage} from '../core/sqs/sqsFatalDlqSender'

let _snsClient: SNSClient | undefined
const getSnsClient = (): SNSClient => (_snsClient ??= new SNSClient({}))

const fatalDlqLogger = logger.child({name: 'FatalDLQProcessor'})

export const handler: SQSHandler = async (event: SQSEvent): Promise<void> => {
    const alertTopicArn = process.env['ALERT_TOPIC_ARN']
    const stage = process.env['STAGE'] ?? 'unknown'

    for (const record of event.Records) {
        const sentAt =
            record.attributes.SentTimestamp === '' ? 'unknown' : new Date(Number(record.attributes.SentTimestamp)).toISOString()

        const parsedBody = parseBody(record.body)

        fatalDlqLogger.error(
            {
                messageId: record.messageId,
                errorMessage: parsedBody?.errorMessage,
                errorSource: parsedBody?.errorSource,
                failedAt: parsedBody?.failedAt,
                sentAt,
                originalMessageId: parsedBody?.originalMessageId
            },
            'FATAL DLQ – deterministischer Fehler, kein Retry möglich, Dev-Team Eingriff erforderlich'
        )

        if (alertTopicArn == null || alertTopicArn.trim() === '') {
            fatalDlqLogger.warn('ALERT_TOPIC_ARN not set – skipping SNS alert')
            continue
        }

        try {
            await getSnsClient().send(
                new PublishCommand({
                    TopicArn: alertTopicArn,
                    Subject: `[${stage.toUpperCase()}] FATAL: E-Invoice Processing – Dev-Team Eingriff erforderlich`,
                    Message: JSON.stringify(
                        {
                            type: 'FatalProcessingError',
                            messageId: record.messageId,
                            sentAt,
                            errorMessage: parsedBody?.errorMessage,
                            errorSource: parsedBody?.errorSource,
                            failedAt: parsedBody?.failedAt,
                            originalMessageId: parsedBody?.originalMessageId
                        },
                        null,
                        2
                    )
                })
            )
            fatalDlqLogger.info({messageId: record.messageId}, 'Fatal SNS alert sent')
        } catch (err) {
            fatalDlqLogger.error({messageId: record.messageId, err}, 'Fatal SNS alert failed – continuing with next record')
        }
    }
}

function parseBody(body: string): FatalDlqMessage | undefined {
    try {
        return <FatalDlqMessage>JSON.parse(body)
    } catch {
        return undefined
    }
}
