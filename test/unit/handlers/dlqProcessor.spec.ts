import { mockClient } from 'aws-sdk-client-mock'
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns'
import type { SQSEvent, SQSRecord } from 'aws-lambda'

// snsMock MUSS vor dem handler-Import deklariert werden!
const snsMock = mockClient(SNSClient)

import { handler } from '../../../src/handlers/dlqProcessor'

const makeRecord = (overrides?: Partial<SQSRecord>): SQSRecord => ({
    messageId: 'msg-001',
    receiptHandle: 'receipt-001',
    body: JSON.stringify({ invoiceNumber: 'INV-001', error: 'Processing failed' }),
    attributes: {
        ApproximateReceiveCount: '3',
        SentTimestamp: '1700000000000',
        SenderId: 'sender-001',
        ApproximateFirstReceiveTimestamp: '1700000000000',
    },
    messageAttributes: {},
    md5OfBody: 'md5',
    eventSource: 'aws:sqs',
    eventSourceARN: 'arn:aws:sqs:eu-central-1:123456789:dlq',
    awsRegion: 'eu-central-1',
    ...overrides,
})

const makeSqsEvent = (records: SQSRecord[]): SQSEvent => ({ Records: records })

describe('dlqProcessor', () => {
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
        it('sollte SNS Alert für eine Message senden', async () => {
            snsMock.on(PublishCommand).resolves({ MessageId: 'sns-001' })

            await handler(makeSqsEvent([makeRecord()]), <never>{}, () => undefined)

            const calls = snsMock.commandCalls(PublishCommand)
            expect(calls).toHaveLength(1)

            const input = calls[0]?.args[0].input
            expect(input?.TopicArn).toBe('arn:aws:sns:eu-central-1:123456789:alerts')
            expect(input?.Subject).toBe('[TEST] E-Invoice Processing Failed')
        })

        it('sollte SNS Alert für mehrere Records senden', async () => {
            snsMock.on(PublishCommand).resolves({ MessageId: 'sns-001' })

            await handler(
                makeSqsEvent([makeRecord(), makeRecord({ messageId: 'msg-002' })]),
                <never>{},
                () => undefined
            )

            expect(snsMock.commandCalls(PublishCommand)).toHaveLength(2)
        })

        it('sollte messageId und receiveCount im SNS Body enthalten', async () => {
            snsMock.on(PublishCommand).resolves({ MessageId: 'sns-001' })

            await handler(makeSqsEvent([makeRecord()]), <never>{}, () => undefined)

            const input = snsMock.commandCalls(PublishCommand)[0]?.args[0].input
            const message = <Record<string, unknown>>JSON.parse(input?.Message ?? '{}')

            expect(message['messageId']).toBe('msg-001')
            expect(message['receiveCount']).toBe('3')
        })

        it('sollte parsedBody als Objekt senden wenn JSON valide', async () => {
            snsMock.on(PublishCommand).resolves({ MessageId: 'sns-001' })

            const body = { invoiceNumber: 'INV-001', error: 'Processing failed' }
            await handler(makeSqsEvent([makeRecord({ body: JSON.stringify(body) })]), <never>{}, () => undefined)

            const input = snsMock.commandCalls(PublishCommand)[0]?.args[0].input
            const message = <Record<string, unknown>>JSON.parse(input?.Message ?? '{}')

            expect(message['body']).toEqual(body)
        })

        it('sollte parsedBody als String senden wenn JSON invalide', async () => {
            snsMock.on(PublishCommand).resolves({ MessageId: 'sns-001' })

            await handler(makeSqsEvent([makeRecord({ body: 'kein-json' })]), <never>{}, () => undefined)

            const input = snsMock.commandCalls(PublishCommand)[0]?.args[0].input
            const message = <Record<string, unknown>>JSON.parse(input?.Message ?? '{}')

            expect(message['body']).toBe('kein-json')
        })

        it('sollte sentAt als ISO-String formatieren', async () => {
            snsMock.on(PublishCommand).resolves({ MessageId: 'sns-001' })

            await handler(
                makeSqsEvent([makeRecord({ attributes: { ApproximateReceiveCount: '3', SentTimestamp: '1700000000000', SenderId: 'sender', ApproximateFirstReceiveTimestamp: '1700000000000' } })]),
                <never>{},
                () => undefined
            )

            const input = snsMock.commandCalls(PublishCommand)[0]?.args[0].input
            const message = <Record<string, unknown>>JSON.parse(input?.Message ?? '{}')

            expect(message['sentAt']).toBe(new Date(1700000000000).toISOString())
        })

        it('sollte sentAt als "unknown" setzen wenn SentTimestamp leer', async () => {
            snsMock.on(PublishCommand).resolves({ MessageId: 'sns-001' })

            await handler(
                makeSqsEvent([makeRecord({ attributes: { ApproximateReceiveCount: '3', SentTimestamp: '', SenderId: 'sender', ApproximateFirstReceiveTimestamp: '' } })]),
                <never>{},
                () => undefined
            )

            const input = snsMock.commandCalls(PublishCommand)[0]?.args[0].input
            const message = <Record<string, unknown>>JSON.parse(input?.Message ?? '{}')

            expect(message['sentAt']).toBe('unknown')
        })
    })

    describe('ALERT_TOPIC_ARN fehlt', () => {
        it('sollte keinen SNS Alert senden wenn ALERT_TOPIC_ARN nicht gesetzt', async () => {
            delete process.env['ALERT_TOPIC_ARN']

            await handler(makeSqsEvent([makeRecord()]), <never>{}, () => undefined)

            expect(snsMock.commandCalls(PublishCommand)).toHaveLength(0)
        })

        it('sollte keinen SNS Alert senden wenn ALERT_TOPIC_ARN leer ist', async () => {
            process.env['ALERT_TOPIC_ARN'] = ''

            await handler(makeSqsEvent([makeRecord()]), <never>{}, () => undefined)

            expect(snsMock.commandCalls(PublishCommand)).toHaveLength(0)
        })

        it('sollte keinen SNS Alert senden wenn ALERT_TOPIC_ARN nur Whitespaces enthält', async () => {
            process.env['ALERT_TOPIC_ARN'] = '   '

            await handler(makeSqsEvent([makeRecord()]), <never>{}, () => undefined)

            expect(snsMock.commandCalls(PublishCommand)).toHaveLength(0)
        })

        it('sollte bei mehreren Records keinen SNS Alert senden wenn ALERT_TOPIC_ARN fehlt', async () => {
            delete process.env['ALERT_TOPIC_ARN']

            await handler(
                makeSqsEvent([makeRecord(), makeRecord({ messageId: 'msg-002' })]),
                <never>{},
                () => undefined
            )

            expect(snsMock.commandCalls(PublishCommand)).toHaveLength(0)
        })
    })

    describe('leeres Event', () => {
        it('sollte bei leerem Records-Array nichts tun', async () => {
            await handler(makeSqsEvent([]), <never>{}, () => undefined)

            expect(snsMock.commandCalls(PublishCommand)).toHaveLength(0)
        })
    })

    describe('STAGE env', () => {
        it('sollte "unknown" als Stage verwenden wenn STAGE nicht gesetzt', async () => {
            delete process.env['STAGE']
            snsMock.on(PublishCommand).resolves({ MessageId: 'sns-001' })

            await handler(makeSqsEvent([makeRecord()]), <never>{}, () => undefined)

            const input = snsMock.commandCalls(PublishCommand)[0]?.args[0].input
            expect(input?.Subject).toBe('[UNKNOWN] E-Invoice Processing Failed')
        })
    })

    describe('SNS Fehler', () => {
        it('sollte bei SNS Fehler weiterlaufen und nächsten Record verarbeiten', async () => {
            snsMock.on(PublishCommand)
                .rejectsOnce(new Error('SNS nicht erreichbar'))
                .resolves({ MessageId: 'sns-002' })

            await handler(
                makeSqsEvent([makeRecord(), makeRecord({ messageId: 'msg-002' })]),
                <never>{},
                () => undefined
            )

            // Erster Call fehlgeschlagen, zweiter trotzdem ausgeführt
            expect(snsMock.commandCalls(PublishCommand)).toHaveLength(2)
        })

        it('sollte bei SNS Fehler keinen Fehler werfen', async () => {
            snsMock.on(PublishCommand).rejects(new Error('SNS nicht erreichbar'))

            await expect(
                handler(makeSqsEvent([makeRecord()]), <never>{}, () => undefined)
            ).resolves.toBeUndefined()
        })
    })
})