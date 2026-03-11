import {S3Client} from '@aws-sdk/client-s3'

jest.mock('@aws-sdk/client-s3', () => ({
    S3Client: jest.fn()
}))

const MockS3Client = jest.mocked(S3Client)

function loadS3Client(): jest.MockedClass<typeof S3Client> {
    jest.resetModules()
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const {S3Client: FreshS3Client} = <{S3Client: jest.MockedClass<typeof S3Client>}>require('@aws-sdk/client-s3')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../../src/core/s3/s3Client')
    return FreshS3Client
}

describe('s3Client', () => {
    const originalEnv = process.env

    beforeEach(() => {
        process.env = {...originalEnv}
        MockS3Client.mockClear()
    })

    afterAll(() => {
        process.env = originalEnv
    })

    it('uses AWS_REGION when set', () => {
        process.env['AWS_REGION'] = 'us-east-1'
        delete process.env['AWS_DEFAULT_REGION']
        delete process.env['AWS_ENDPOINT_URL']

        const Client = loadS3Client()

        expect(Client).toHaveBeenCalledWith(expect.objectContaining({region: 'us-east-1'}))
    })

    it('falls back to AWS_DEFAULT_REGION when AWS_REGION is unset', () => {
        delete process.env['AWS_REGION']
        process.env['AWS_DEFAULT_REGION'] = 'eu-west-1'
        delete process.env['AWS_ENDPOINT_URL']

        const Client = loadS3Client()

        expect(Client).toHaveBeenCalledWith(expect.objectContaining({region: 'eu-west-1'}))
    })

    it('defaults to eu-central-1 when no region env vars are set', () => {
        delete process.env['AWS_REGION']
        delete process.env['AWS_DEFAULT_REGION']
        delete process.env['AWS_ENDPOINT_URL']

        const Client = loadS3Client()

        expect(Client).toHaveBeenCalledWith(expect.objectContaining({region: 'eu-central-1'}))
    })

    it('sets endpoint and forcePathStyle when AWS_ENDPOINT_URL is set', () => {
        delete process.env['AWS_REGION']
        delete process.env['AWS_DEFAULT_REGION']
        process.env['AWS_ENDPOINT_URL'] = 'http://localhost:4566'

        const Client = loadS3Client()

        expect(Client).toHaveBeenCalledWith(
            expect.objectContaining({
                endpoint: 'http://localhost:4566',
                forcePathStyle: true
            })
        )
    })

    it('does not set endpoint when AWS_ENDPOINT_URL is unset', () => {
        delete process.env['AWS_REGION']
        delete process.env['AWS_DEFAULT_REGION']
        delete process.env['AWS_ENDPOINT_URL']

        const Client = loadS3Client()

        const config = <Record<string, unknown>>Client.mock.calls[0]?.[0]
        expect(config['endpoint']).toBeUndefined()
        expect(config['forcePathStyle']).toBeUndefined()
    })
})
