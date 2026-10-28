import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const CINCO_MIN = 5 * 60_000

// O engine de mentira: responde o wslpath e guarda cada som que o mod tocou,
// como "<arquivo> x<vezes>". `segurarFerramenta` deixa a chamada pendurada,
// como um diálogo que ninguém respondeu, até `responder()`.
const montar = (on: On) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const sons: string[] = []
  let responder = () => {}
  let segurarFerramenta = false

  on('process.run', (_, e) => {
    const ok = { exitCode: 0, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
    if (e.argv[0] === 'wslpath') return { value: { ...ok, stdout: '\\\\wsl.localhost\\Ubuntu\\mod\n' } }

    const comando = e.argv.at(-1) ?? ''
    const arquivo = /'([^']+)'/.exec(comando)?.[1]
    const vezes = /1\.\.(\d+)/.exec(comando)?.[1]
    sons.push(`${arquivo} x${vezes}`)
    return { value: { ...ok, stdout: '' } }
  })
  on('turn.complete', () => ({ text: '' }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('classic.PermissionRequest', () => ({}))
  on('classic.Notification', () => ({}))
  on('tool.call', () =>
    segurarFerramenta
      ? new Promise(resolve => (responder = () => resolve({ result: {} })))
      : { result: {} },
  )

  return {
    clock,
    sons,
    segurar: () => (segurarFerramenta = true),
    responder: () => responder(),
  }
}

const PRONTO = '\\\\wsl.localhost\\Ubuntu\\mod\\sons\\pronto.wav x1'
const ATENCAO = '\\\\wsl.localhost\\Ubuntu\\mod\\sons\\atencao.wav x2'

const FIM = { answer: 'feito', durationMs: 90_000, turnId: 't1' } as const
const PERGUNTA = {
  tool: 'AskUserQuestion' as const,
  questions: [
    {
      question: 'Qual?',
      header: 'Teste',
      multiSelect: false,
      options: [
        { label: 'A', description: 'a' },
        { label: 'B', description: 'b' },
      ],
    },
  ],
}

test('o fim do turno toca o "terminei" 1x, e de novo depois de 5 minutos sem resposta', async ($, on) => {
  const { clock, sons } = montar(on)

  await $.turn.complete({ ...FIM, isAborted: false, reason: 'answer' })
  await clock.settle()
  expect(sons).toEqual([PRONTO])

  await clock.advance(CINCO_MIN)
  expect(sons).toEqual([PRONTO, PRONTO])

  // O lembrete toca uma vez só.
  await clock.advance(CINCO_MIN * 3)
  expect(sons).toHaveLength(2)
})

test('uma mensagem sua antes dos 5 minutos cancela o lembrete', async ($, on) => {
  const { clock, sons } = montar(on)

  await $.turn.complete({ ...FIM, isAborted: false, reason: 'answer' })
  await clock.advance(60_000)
  await $.prompt.submit({ ...MENSAGEM, text: 'valeu' })
  await clock.advance(CINCO_MIN)

  expect(sons).toEqual([PRONTO])
})

const MENSAGEM = { wait: false, origin: { kind: 'composer' } } as const

test('a resposta rápida a um "ok" não toca nem deixa lembrete', async ($, on) => {
  const { clock, sons } = montar(on)

  await $.prompt.submit({ ...MENSAGEM, text: 'ok' })
  await clock.advance(5_000)
  await $.turn.complete({ ...FIM, durationMs: 5_000, isAborted: false, reason: 'answer' })
  await clock.advance(CINCO_MIN)

  expect(sons).toHaveLength(0)
})

test('uma tarefa longa depois da sua mensagem toca', async ($, on) => {
  const { clock, sons } = montar(on)

  await $.prompt.submit({ ...MENSAGEM, text: 'faz tudo' })
  await clock.advance(90_000)
  await $.turn.complete({ ...FIM, isAborted: false, reason: 'answer' })
  await clock.settle()

  expect(sons).toEqual([PRONTO])
})

test('demorar 2 minutos numa permissão e o turno acabar logo depois não toca o "terminei"', async ($, on) => {
  const { clock, sons, segurar, responder } = montar(on)
  segurar()

  await $.prompt.submit({ ...MENSAGEM, text: 'roda isso' })
  await clock.advance(20_000)
  const chamada = $.tool.call({ tool: 'Bash', command: 'rm x' })
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'rm x' } })
  await clock.advance(2 * 60_000)
  responder()
  await chamada
  await clock.advance(10_000)
  await $.turn.complete({ ...FIM, durationMs: 150_000, isAborted: false, reason: 'answer' })
  await clock.advance(CINCO_MIN)

  expect(sons).toEqual([ATENCAO])
})

test('subagente e Esc não tocam nada', async ($, on) => {
  const { clock, sons } = montar(on)

  await $.turn.complete({ ...FIM, agentId: 'a1', isAborted: false, reason: 'answer' })
  await $.turn.complete({ ...FIM, isAborted: true, reason: 'aborted' })
  await clock.advance(CINCO_MIN)

  expect(sons).toHaveLength(0)
})

test('permissão sem resposta toca 2x, e 2x de novo depois de 5 minutos', async ($, on) => {
  const { clock, sons, segurar } = montar(on)
  segurar()

  void $.tool.call({ tool: 'Bash', command: 'rm x' })
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'rm x' } })
  await $.classic.Notification({ message: 'Claude needs your permission', notification_type: 'permission_prompt' })
  await clock.settle()
  expect(sons).toEqual([ATENCAO])

  await clock.advance(CINCO_MIN)
  expect(sons).toEqual([ATENCAO, ATENCAO])
})

test('responder a permissão cancela o lembrete', async ($, on) => {
  const { clock, sons, segurar, responder } = montar(on)
  segurar()

  const chamada = $.tool.call({ tool: 'Bash', command: 'rm x' })
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'rm x' } })
  await clock.advance(30_000)
  responder()
  await chamada
  await clock.advance(CINCO_MIN)

  expect(sons).toEqual([ATENCAO])
})

test('uma pergunta sem resposta toca 2x e lembra depois de 5 minutos; respondida, não', async ($, on) => {
  const { clock, sons, segurar, responder } = montar(on)
  segurar()

  const chamada = $.tool.call(PERGUNTA)
  await clock.advance(CINCO_MIN)
  expect(sons).toEqual([ATENCAO, ATENCAO])

  responder()
  await chamada
  await clock.advance(CINCO_MIN * 2)
  expect(sons).toHaveLength(2)
})

test('o aviso de inatividade não toca', async ($, on) => {
  const { clock, sons } = montar(on)

  await $.classic.Notification({ message: 'Claude is waiting for your input', notification_type: 'idle_prompt' })
  await clock.advance(CINCO_MIN)

  expect(sons).toHaveLength(0)
})
