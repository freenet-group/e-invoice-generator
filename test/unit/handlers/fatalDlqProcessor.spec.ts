import {mockClient} from 'aws-sdk-client-mock'
import {SNSClient, PublishCommand} from '@aws-sdk/client-sns'
import type {SQSEvent, SQSRecord} from 'aws-lambda'
import type {FatalDlqMessage} from '../../../src/core/sqs/sqsFatalDlqSender'

// snsMock MUSS vor dem handler-Import deklariert werden!
const snsMock = mockClient(SNSClient)

import {handler} from '../../../src/handlers/fatalDlqProcessor'

const makeFatalBody = (overrides?: Partial<FatalDlqMessage>): string =>
    JSON.stringify({
        originalMessageId: 'orig-msg-001',
        originalMessageBody: '{"source":"aws.s3"}',
        errorMessage:
            '[raw/xml/INV-001.xml] Invalid MCBS XML structure:\n  INVOICE_DATA.PAYMENT_MODE.PAYMENT_TYPE: Invalid option',
        errorSource: 'raw/xml/INV-001.xml',
        failedAt: '2026-03-12T10:00:00.000Z',
        ...overrides
    } satisfies FatalDlqMessage)

const makeRecord = (overrides?: Partial<SQSRecord>): SQSRecord => ({
    messageId: 'fatal-msg-001',
    receiptHandle: 'receipt-001',
    body: makeFatalBody(),
    attributes: {
        ApproximateReceiveCount: '1',
        SentTimestamp: '1700000000000',
        SenderId: 'sender-001',
        ApproximateFirstReceiveTimestamp: '1700000000000'
    },
    messageAttributes: {},
    md5OfBody: 'md5',
    eventSource: 'aws:sqs',
    eventSourceARN: 'arn:aws:sqs:eu-central-1:123456789:fatal-dlq',
    awsRegion: 'eu-central-1',
    ...overrides
})

const makeSqsEvent = (records: SQSRecord[]): SQSEvent => ({Records: records})

describe('fatalDlqProcessor', () => {
    beforeEach(() => {
        snsMock.reset()
        process.env['ALERT_TOPIC_ARN'] = 'arn:aws:sns:eu-central-1:123456789:alerts'
        process.env['STAGE'] = 'test'
    })

    afterEach(() => {
        delete process.env['ALERT_TOPIC_ARN']
        delete process.env['STAGE']
    })

    describe('SNS Alert', () => {
        it('sendet SNS Alert mit FATAL-Subject', async () => {
            snsMock.on(PublishCommand).resolves({MessageId: 'sns-001'})

            await handler(makeSqsEvent([makeRecord()]), <never>{}, () => undefined)

            const calls = snsMock.commandCalls(PublishCommand)
            expect(calls).toHaveLength(1)
            expect(calls[0]?.args[0].input.Subject).toBe('[TEST] FATAL: E-Invoice Processing – Dev-Team Eingriff erforderlich')
        })

        it('enthält errorSource und errorMessage im SNS Body', async () => {
            snsMock.on(PublishCommand).resolves({MessageId: 'sns-001'})

            await handler(makeSqsEvent([makeRecord()]), <never>{}, () => undefined)

            const input = snsMock.commandCalls(PublishCommand)[0]?.args[0].input
            const message = <Record<string, unknown>>JSON.parse(input?.Message ?? '{}')

            expect(message['errorSource']).toBe('raw/xml/INV-001.xml')
            expect(message['errorMessage']).toContain('Invalid MCBS XML structure')
            expect(message['type']).toBe('FatalProcessingError')
        })

        it('enthält originalMessageId im SNS Body', async () => {
            snsMock.on(PublishCommand).resolves({MessageId: 'sns-001'})

            await handler(makeSqsEvent([makeRecord()]), <never>{}, () => undefined)

            const input = snsMock.commandCalls(PublishCommand)[0]?.args[0].input
            const message = <Record<string, unknown>>JSON.parse(input?.Message ?? '{}')

            expect(message['originalMessageId']).toBe('orig-msg-001')
        })

        it('sendet Alert für mehrere Records', async () => {
            snsMock.on(PublishCommand).resolves({MessageId: 'sns-001'})

            await handler(makeSqsEvent([makeRecord(), makeRecord({messageId: 'fatal-msg-002'})]), <never>{}, () => undefined)

            expect(snsMock.commandCalls(PublishCommand)).toHaveLength(2)
        })

        it('überspringt SNS wenn ALERT_TOPIC_ARN fehlt', async () => {
            delete process.env['ALERT_TOPIC_ARN']

            await handler(makeSqsEvent([makeRecord()]), <never>{}, () => undefined)

            expect(snsMock.commandCalls(PublishCommand)).toHaveLength(0)
        })

        it('setzt type=FatalProcessingError im Alert', async () => {
            snsMock.on(PublishCommand).resolves({MessageId: 'sns-001'})

            await handler(makeSqsEvent([makeRecord()]), <never>{}, () => undefined)

            const input = snsMock.commandCalls(PublishCommand)[0]?.args[0].input
            const message = <Record<string, unknown>>JSON.parse(input?.Message ?? '{}')

            expect(message['type']).toBe('FatalProcessingError')
        })

        it('verarbeitet invalides JSON im Body ohne Absturz', async () => {
            snsMock.on(PublishCommand).resolves({MessageId: 'sns-001'})

            await handler(makeSqsEvent([makeRecord({body: 'kein-json'})]), <never>{}, () => undefined)

            const input = snsMock.commandCalls(PublishCommand)[0]?.args[0].input
            const message = <Record<string, unknown>>JSON.parse(input?.Message ?? '{}')

            expect(message['errorMessage']).toBeUndefined()
            expect(message['errorSource']).toBeUndefined()
        })

        it('fährt mit nächstem Record fort wenn SNS fehlschlägt', async () => {
            snsMock.on(PublishCommand).rejectsOnce(new Error('SNS timeout')).resolves({MessageId: 'sns-002'})

            await expect(
                handler(makeSqsEvent([makeRecord(), makeRecord({messageId: 'fatal-msg-002'})]), <never>{}, () => undefined)
            ).resolves.not.toThrow()

            expect(snsMock.commandCalls(PublishCommand)).toHaveLength(2)
        })
    })
})
