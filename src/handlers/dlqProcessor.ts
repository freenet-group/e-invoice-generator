/**
 * DLQ Processor Handler
 *
 * Wird getriggert, wenn Nachrichten nach maxReceiveCount (3) Versuchen in die
 * Dead Letter Queue verschoben wurden. Logged den Fehler und sendet einen SNS-Alert.
 */

import type { SQSEvent, SQSHandler } from 'aws-lambda'
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns'
import { logger } from '../core/logger'

const snsClient = new SNSClient({})
const dlqLogger = logger.child({ name: 'DLQProcessor' })

export const handler: SQSHandler = async (event: SQSEvent): Promise<void> => {
    const alertTopicArn = process.env['ALERT_TOPIC_ARN']
    const stage = process.env['STAGE'] ?? 'unknown'

    for (const record of event.Records) {
        const receiveCount = record.attributes.ApproximateReceiveCount
        const sentAt = record.attributes.SentTimestamp === '' 
            ? 'unknown'
            : new Date(Number(record.attributes.SentTimestamp)).toISOString()

        dlqLogger.error(
            {
                messageId: record.messageId,
                body: record.body,
                receiveCount,
                sentAt,
            },
            'DLQ message received – invoice processing failed after all retries'
        )

        if (alertTopicArn === undefined || alertTopicArn.trim() === '') {
            dlqLogger.warn('ALERT_TOPIC_ARN not set – skipping SNS alert')
            continue
        }

        const parsedBody: unknown = ((): unknown => {
            try {
                return JSON.parse(record.body)
            } catch {
                return record.body
            }
        })()

        await snsClient.send(
            new PublishCommand({
                TopicArn: alertTopicArn,
                Subject: `[${stage.toUpperCase()}] E-Invoice Processing Failed`,
                Message: JSON.stringify(
                    {
                        messageId: record.messageId,
                        receiveCount,
                        sentAt,
                        body: parsedBody,
                    },
                    null,
                    2
                ),
            })
        )

        dlqLogger.info({ messageId: record.messageId }, 'SNS alert sent')
    }
}
