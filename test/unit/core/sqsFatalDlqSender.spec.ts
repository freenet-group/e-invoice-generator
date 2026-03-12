import {mockClient} from 'aws-sdk-client-mock'
import {SQSClient, SendMessageCommand} from '@aws-sdk/client-sqs'
import type {SQSRecord} from 'aws-lambda'
import {FatalProcessingError} from '../../../src/core/errors/fatalProcessingError'
import {sendToFatalDlq} from '../../../src/core/sqs/sqsFatalDlqSender'

const sqsMock = mockClient(SQSClient)

const makeRecord = (overrides?: Partial<SQSRecord>): SQSRecord => ({
    messageId: 'msg-001',
    receiptHandle: 'receipt-001',
    body: '{"source":"original-body"}',
    attributes: {
        ApproximateReceiveCount: '1',
        SentTimestamp: '1700000000000',
        SenderId: 'sender-001',
        ApproximateFirstReceiveTimestamp: '1700000000000'
    },
    messageAttributes: {},
    md5OfBody: 'md5',
    eventSource: 'aws:sqs',
    eventSourceARN: 'arn:aws:sqs:eu-central-1:123456789:main-queue',
    awsRegion: 'eu-central-1',
    ...overrides
})

describe('sqsFatalDlqSender', () => {
    beforeEach(() => {
        sqsMock.reset()
        process.env['FATAL_DLQ_URL'] = 'https://sqs.eu-central-1.amazonaws.com/123456789/fatal-dlq'
    })

    afterEach(() => {
        delete process.env['FATAL_DLQ_URL']
    })

    it('sendet Nachricht an FATAL_DLQ_URL', async () => {
        sqsMock.on(SendMessageCommand).resolves({MessageId: 'sqs-001'})

        const record = makeRecord()
        const error = new FatalProcessingError('mapping failed', 'raw/xml/test.xml', new Error('mapping failed'))

        await sendToFatalDlq(record, error)

        const calls = sqsMock.commandCalls(SendMessageCommand)
        expect(calls).toHaveLength(1)
        expect(calls[0]?.args[0].input.QueueUrl).toBe('https://sqs.eu-central-1.amazonaws.com/123456789/fatal-dlq')
    })

    it('enthält originalMessageId und originalMessageBody im MessageBody', async () => {
        sqsMock.on(SendMessageCommand).resolves({})

        const record = makeRecord({messageId: 'orig-msg-001', body: 'original content'})
        const error = new FatalProcessingError('bad input', 'raw/xml/INV-001.xml', new Error('bad input'))

        await sendToFatalDlq(record, error)

        const input = sqsMock.commandCalls(SendMessageCommand)[0]?.args[0].input
        const body = <Record<string, unknown>>JSON.parse(input?.MessageBody ?? '{}')

        expect(body['originalMessageId']).toBe('orig-msg-001')
        expect(body['originalMessageBody']).toBe('original content')
    })

    it('enthält errorMessage und errorSource im MessageBody', async () => {
        sqsMock.on(SendMessageCommand).resolves({})

        const record = makeRecord()
        const error = new FatalProcessingError(
            'Invalid MCBS XML structure',
            'raw/xml/INV-001.xml',
            new Error('Invalid MCBS XML structure')
        )

        await sendToFatalDlq(record, error)

        const input = sqsMock.commandCalls(SendMessageCommand)[0]?.args[0].input
        const body = <Record<string, unknown>>JSON.parse(input?.MessageBody ?? '{}')

        expect(body['errorMessage']).toContain('Invalid MCBS XML structure')
        expect(body['errorSource']).toBe('raw/xml/INV-001.xml')
    })

    it('setzt MessageAttributes ErrorType und OriginalMessageId', async () => {
        sqsMock.on(SendMessageCommand).resolves({})

        const record = makeRecord({messageId: 'msg-attr-test'})
        const error = new FatalProcessingError('some error', 'source.xml', new Error('some error'))

        await sendToFatalDlq(record, error)

        const input = sqsMock.commandCalls(SendMessageCommand)[0]?.args[0].input
        expect(input?.MessageAttributes?.['ErrorType']?.StringValue).toBe('FatalProcessingError')
        expect(input?.MessageAttributes?.['OriginalMessageId']?.StringValue).toBe('msg-attr-test')
    })

    it('enthält failedAt als ISO-Datum im MessageBody', async () => {
        sqsMock.on(SendMessageCommand).resolves({})

        const before = new Date()
        await sendToFatalDlq(makeRecord(), new FatalProcessingError('err', 'src', new Error('err')))
        const after = new Date()

        const input = sqsMock.commandCalls(SendMessageCommand)[0]?.args[0].input
        const body = <Record<string, unknown>>JSON.parse(input?.MessageBody ?? '{}')
        const failedAt = new Date(<string>body['failedAt'])

        expect(failedAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
        expect(failedAt.getTime()).toBeLessThanOrEqual(after.getTime())
    })

    it('wirft Error wenn FATAL_DLQ_URL nicht gesetzt', async () => {
        delete process.env['FATAL_DLQ_URL']

        const record = makeRecord()
        const error = new FatalProcessingError('err', 'src', new Error('err'))

        await expect(sendToFatalDlq(record, error)).rejects.toThrow('FATAL_DLQ_URL environment variable is not set')
    })

    it('wirft Error wenn FATAL_DLQ_URL leer ist', async () => {
        process.env['FATAL_DLQ_URL'] = ''

        const record = makeRecord()
        const error = new FatalProcessingError('err', 'src', new Error('err'))

        await expect(sendToFatalDlq(record, error)).rejects.toThrow('FATAL_DLQ_URL environment variable is not set')
    })
})
