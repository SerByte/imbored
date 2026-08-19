import { expect, test } from 'vitest'
import { parseCompatInput } from './compatlink'

const ID = '76561198000000000'

test('принимает нашу ссылку совместимости целиком', () => {
  expect(parseCompatInput(`https://imbored.cc/compat/${ID}`)).toEqual({
    kind: 'steamid64',
    value: ID,
  })
})

test('принимает её же без протокола, с хвостом и голым путём', () => {
  expect(parseCompatInput(`imbored.cc/compat/${ID}`)).toEqual({ kind: 'steamid64', value: ID })
  expect(parseCompatInput(`https://imbored.cc/compat/${ID}?from=chat`)).toEqual({
    kind: 'steamid64',
    value: ID,
  })
  expect(parseCompatInput(`/compat/${ID}`)).toEqual({ kind: 'steamid64', value: ID })
})

test('превью-деплой и локалка — та же ссылка', () => {
  expect(parseCompatInput(`https://imbored-git-x.vercel.app/compat/${ID}`)).toEqual({
    kind: 'steamid64',
    value: ID,
  })
  expect(parseCompatInput(`http://localhost:3000/compat/${ID}`)).toEqual({
    kind: 'steamid64',
    value: ID,
  })
})

test('пробелы по краям не мешают — из чата копируют с ними', () => {
  expect(parseCompatInput(`  https://imbored.cc/compat/${ID}  `)).toEqual({
    kind: 'steamid64',
    value: ID,
  })
})

test('профиль Steam по-прежнему разбирается прежним кодом', () => {
  expect(parseCompatInput(`https://steamcommunity.com/profiles/${ID}`)).toEqual({
    kind: 'steamid64',
    value: ID,
  })
  expect(parseCompatInput('https://steamcommunity.com/id/gabelogannewell')).toEqual({
    kind: 'vanity',
    value: 'gabelogannewell',
  })
  expect(parseCompatInput(ID)).toEqual({ kind: 'steamid64', value: ID })
})

test('чужие домены не становятся проходимыми из-за новой ветки', () => {
  expect(parseCompatInput('https://evil.example/compat/notanid')).toBeNull()
  expect(parseCompatInput('https://evil.example/profile/12345')).toBeNull()
})

test('compat-путь на чужом хосте отдаёт id — и это осознанно', () => {
  // Из адреса забираются ровно семнадцать цифр, после чего человек уходит на
  // НАШ /compat/<id>. Ни запроса по чужому адресу, ни редиректа на него не
  // происходит, поэтому строгость к хосту ничего не покупает, а превью-деплой
  // и локалку сломала бы.
  expect(parseCompatInput(`https://evil.example/compat/${ID}`)).toEqual({
    kind: 'steamid64',
    value: ID,
  })
})

test('короткий и длинный id в compat-пути не проходят', () => {
  expect(parseCompatInput('https://imbored.cc/compat/1234')).toBeNull()
  expect(parseCompatInput('https://imbored.cc/compat/123456789012345678901')).toBeNull()
})

test('пустое и мусор дают null', () => {
  expect(parseCompatInput('')).toBeNull()
  expect(parseCompatInput('   ')).toBeNull()
  expect(parseCompatInput('не ссылка вовсе')).toBeNull()
})
