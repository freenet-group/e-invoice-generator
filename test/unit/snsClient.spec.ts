jest.mock('@aws-sdk/client-sns', () => ({
    SNSClient: jest.fn().mockImplementation((config: unknown) => ({name: 'SNSClient', config}))
}))

describe('snsClient', () => {
    const originalRegion = process.env['AWS_REGION']
    const originalDefaultRegion = process.env['AWS_DEFAULT_REGION']

    afterEach(() => {
        if (originalRegion === undefined) {
            delete process.env['AWS_REGION']
        } else {
            process.env['AWS_REGION'] = originalRegion
        }
        if (originalDefaultRegion === undefined) {
            delete process.env['AWS_DEFAULT_REGION']
        } else {
            process.env['AWS_DEFAULT_REGION'] = originalDefaultRegion
        }
        jest.resetModules()
    })

    function loadAndCheck(region: string): void {
        jest.isolateModules(() => {
            const {SNSClient} = jest.requireMock('@aws-sdk/client-sns') as {SNSClient: jest.Mock}
            SNSClient.mockClear()
            require('../../src/core/sns/snsClient')
            expect(SNSClient).toHaveBeenCalledWith(expect.objectContaining({region}))
            const instance = SNSClient.mock.results[0]?.value as {name: string}
            expect(instance.name).toBe('SNSClient')
        })
    }

    it('uses AWS_REGION when set', () => {
        process.env['AWS_REGION'] = 'us-east-1'
        delete process.env['AWS_DEFAULT_REGION']
        loadAndCheck('us-east-1')
    })

    it('falls back to AWS_DEFAULT_REGION when AWS_REGION is not set', () => {
        delete process.env['AWS_REGION']
        process.env['AWS_DEFAULT_REGION'] = 'eu-west-1'
        loadAndCheck('eu-west-1')
    })

    it('falls back to eu-central-1 when neither env var is set', () => {
        delete process.env['AWS_REGION']
        delete process.env['AWS_DEFAULT_REGION']
        loadAndCheck('eu-central-1')
    })
})

