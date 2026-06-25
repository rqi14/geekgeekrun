import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  formatResumeJsonToMarkdown,
  checkIsResumeContentValid,
  resumeContentEnoughDetect
} from './resume.ts'

const makeContent = (over = {}) => ({
  name: '张三',
  workYearDesc: '5年',
  expectJob: '前端工程师',
  userDescription: '资深前端',
  geekWorkExpList: [
    {
      company: 'A公司',
      positionName: '前端',
      startYearMon: '2020-01',
      endYearMon: '2023-01',
      performance: '业绩A',
      workDescription: '负责前端'
    }
  ],
  geekProjExpList: [
    {
      name: '项目X',
      startYearMon: '2021-01',
      endYearMon: '2022-01',
      roleName: '负责人',
      projectDescription: '描述X',
      performance: '业绩X'
    }
  ],
  expectSalary: ['20', '30'],
  ...over
})

test('formatResumeJsonToMarkdown includes name, work, and project sections', () => {
  const md = formatResumeJsonToMarkdown({ content: makeContent() })
  assert.match(md, /# 姓名\n张三/)
  assert.match(md, /# 工作经历/)
  assert.match(md, /## A公司/)
  assert.match(md, /# 项目经历/)
  assert.match(md, /## 项目X/)
})

test('formatResumeJsonToMarkdown filters empty work/project entries', () => {
  const md = formatResumeJsonToMarkdown({
    content: makeContent({
      geekWorkExpList: [{ company: '   ', positionName: 'x' }],
      geekProjExpList: [{ name: '' }]
    })
  })
  assert.doesNotMatch(md, /# 工作经历/)
  assert.doesNotMatch(md, /# 项目经历/)
})

test('checkIsResumeContentValid requires both first project name and first work company', () => {
  assert.ok(checkIsResumeContentValid({ content: makeContent() }))
  assert.ok(
    !checkIsResumeContentValid({
      content: makeContent({ geekWorkExpList: [{ company: '  ' }] })
    })
  )
  assert.ok(
    !checkIsResumeContentValid({
      content: makeContent({ geekProjExpList: [{ name: '' }] })
    })
  )
})

test('resumeContentEnoughDetect is true only for long-enough content', () => {
  const longDesc = '段'.repeat(900)
  assert.ok(resumeContentEnoughDetect({ content: makeContent({ userDescription: longDesc }) }))
  assert.ok(
    !resumeContentEnoughDetect({
      content: makeContent({
        userDescription: '短',
        geekWorkExpList: [],
        geekProjExpList: []
      })
    })
  )
})
