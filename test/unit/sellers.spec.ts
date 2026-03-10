import {getSellerByGroupShortcut} from '../../src/config/sellers'

describe('getSellerByGroupShortcut', () => {
    it('returns freenetAG for known shortcut MC', () => {
        const seller = getSellerByGroupShortcut('MC')
        expect(seller.name).toBe('freenet DLS GmbH')
    })

    it('returns kmSeller for shortcut KM', () => {
        const seller = getSellerByGroupShortcut('KM')
        expect(seller.name).toBe('klarmobil GmbH')
    })

    it('returns freenetAG and warns when shortcut is undefined', () => {
        const warn = jest.fn()
        const seller = getSellerByGroupShortcut(undefined, warn)
        expect(seller.name).toBe('freenet DLS GmbH')
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('GROUP_SHORTCUT fehlt'))
    })

    it('returns freenetAG and warns when shortcut is empty string', () => {
        const warn = jest.fn()
        const seller = getSellerByGroupShortcut('', warn)
        expect(seller.name).toBe('freenet DLS GmbH')
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('GROUP_SHORTCUT fehlt'))
    })

    it('returns freenetAG and warns for unknown GROUP_SHORTCUT', () => {
        const warn = jest.fn()
        const seller = getSellerByGroupShortcut('UNKNOWN_XYZ', warn)
        expect(seller.name).toBe('freenet DLS GmbH')
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('UNKNOWN_XYZ'))
    })

    it('returns seller without calling warn when shortcut is valid', () => {
        const warn = jest.fn()
        getSellerByGroupShortcut('MC', warn)
        expect(warn).not.toHaveBeenCalled()
    })
})
