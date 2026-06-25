import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkCookieListFormat } from './cookie.ts'

const fullCookie = {
  name: 'a',
  value: 'b',
  domain: '.zhipin.com',
  path: '/',
  secure: 'true',
  session: 'false',
  httpOnly: 'true'
}

test('valid cookie list passes', () => {
  assert.ok(checkCookieListFormat([fullCookie]))
})

test('missing required key fails', () => {
  const { httpOnly, ...missing } = fullCookie
  void httpOnly
  assert.equal(checkCookieListFormat([missing]), false)
})

test('empty array is falsy (length 0)', () => {
  assert.ok(!checkCookieListFormat([]))
})

test('non-array is false', () => {
  // @ts-expect-error testing runtime guard with wrong type
  assert.equal(checkCookieListFormat(null), false)
})
