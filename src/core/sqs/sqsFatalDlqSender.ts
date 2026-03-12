import {SQSClient, SendMessageCommand} from '@aws-sdk/client-sqs'
import {SQSRecord} from 'aws-lambda'
import {FatalProcessingError} from '../errors/fatalProcessingError'

const sqsClient = new SQSClient({})

export interface FatalDlqMessage {
    originalMessageId: string
    originalMessageBody: string
    errorMessage: string
    errorSource: string
    failedAt: string
}

/**
 * Sendet eine SQS-Nachricht direkt an die Fatal-DLQ.
 * Wird aufgerufen wenn ein FatalProcessingError auftritt — kein Retry sinnvoll.
 *
 * Die fatale DLQ-URL wird aus der Umgebungsvariable FATAL_DLQ_URL gelesen.
 */
export async function sendToFatalDlq(record: SQSRecord, error: FatalProcessingError): Promise<void> {
    const fatalDlqUrl = process.env['FATAL_DLQ_URL']
    if (fatalDlqUrl === undefined || fatalDlqUrl === '') {
        throw new Error('FATAL_DLQ_URL environment variable is not set')
    }

    const message: FatalDlqMessage = {
        originalMessageId: record.messageId,
        originalMessageBody: record.body,
        errorMessage: error.message,
        errorSource: error.source,
        failedAt: new Date().toISOString()
    }

    await sqsClient.send(
        new SendMessageCommand({
            QueueUrl: fatalDlqUrl,
            MessageBody: JSON.stringify(message),
            MessageAttributes: {
                ErrorType: {
                    DataType: 'String',
                    StringValue: 'FatalProcessingError'
                },
                OriginalMessageId: {
                    DataType: 'String',
                    StringValue: record.messageId
                }
            }
        })
    )
}
