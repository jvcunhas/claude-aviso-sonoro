import type { EngineInterface, Register, Timer } from 'claude-code'

// No WSL o $.audio.play não toca nada (não há player no Linux), então o som
// sai pelo Windows: o PowerShell toca o .wav da pasta sons/ do mod.
const POWERSHELL = '/mnt/c/WINDOWS/System32/WindowsPowerShell/v1.0/powershell.exe'

const SONS = {
  pronto: { arquivo: 'sons\\pronto.wav', vezes: 1 },
  atencao: { arquivo: 'sons\\atencao.wav', vezes: 2 },
} as const

type Som = keyof typeof SONS

// Pedido de permissão costuma chegar por dois caminhos (PermissionRequest e
// Notification); dentro dessa janela o segundo aviso igual é ignorado.
const JANELA_MS = 2500

// Sem resposta nesse tempo, o mesmo som toca de novo, uma vez.
const LEMBRETE_MS = 5 * 60_000

// O "terminei" só toca se você não fez nada nesse tempo (provavelmente saiu).
// Ação sua é uma mensagem, um Esc ou uma pergunta/permissão respondida.
const AUSENTE_MS = 60_000

const PERGUNTA = /^(AskUserQuestion|ExitPlanMode)$/

const ultimoSom: Record<Som, number> = { pronto: -Infinity, atencao: -Infinity }

let ultimaAcao = -Infinity

// Os loops com uma pergunta ou permissão aberta para você.
const esperandoVoce = new Set<string | undefined>()

// A pasta do mod como o Windows a vê (\\wsl.localhost\...), lida uma vez.
let raizWindows: Promise<string> | undefined

// Um lembrete por vez. `loop` é quem espera a resposta: o id do subagente,
// ou undefined para a conversa principal.
let lembrete: { timer: Timer; loop: string | undefined } | undefined

const tocar = ($: EngineInterface, som: Som) => {
  // Num timer, para o hook não esperar o PowerShell abrir (~0,7 s).
  $.clock.after(0, () => {
    void (async () => {
      raizWindows ??= $.process.run(['wslpath', '-w', $.plugin.root]).then(r => r.stdout.trim())
      const { arquivo, vezes } = SONS[som]
      const wav = `${await raizWindows}\\${arquivo}`

      await $.process.run([
        POWERSHELL,
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$p = New-Object Media.SoundPlayer '${wav}'; $p.Load(); 1..${vezes} | % { $p.PlaySync(); Start-Sleep -Milliseconds 150 }`,
      ])
    })().catch(err => {
      raizWindows = undefined
      $.ui.log(`aviso-sonoro: ${String(err)}`, { to: 'debug' })
    })
  })
}

// Sem argumento cancela qualquer lembrete; com `{ loop }`, só o daquele loop.
const cancelarLembrete = (doLoop?: { loop: string | undefined }) => {
  if (lembrete === undefined || (doLoop !== undefined && lembrete.loop !== doLoop.loop)) return
  lembrete.timer.cancel()
  lembrete = undefined
}

const avisar = async ($: EngineInterface, som: Som, loop: string | undefined) => {
  const agora = await $.clock.now().catch(() => 0)
  if (agora - ultimoSom[som] < JANELA_MS) return
  ultimoSom[som] = agora

  tocar($, som)
  cancelarLembrete()
  lembrete = {
    loop,
    timer: $.clock.after(LEMBRETE_MS, () => {
      lembrete = undefined
      tocar($, som)
    }),
  }
}

const pedirResposta = ($: EngineInterface, loop: string | undefined) => {
  esperandoVoce.add(loop)
  return avisar($, 'atencao', loop)
}

const registrarAcao = async ($: EngineInterface) => {
  ultimaAcao = await $.clock.now().catch(() => ultimaAcao)
}

export const register: Register = on => {
  // Fim do turno do agente principal.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result

    if (e.isAborted) {
      cancelarLembrete()
      await registrarAcao($)
    } else if ((await $.clock.now()) - ultimaAcao >= AUSENTE_MS) {
      void avisar($, 'pronto', undefined)
    }
    return result
  })

  // Uma mensagem sua (terminal ou Remote Control) conta como resposta; um
  // aviso de tarefa em segundo plano, não.
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'composer' || e.origin.kind === 'bridge') {
      cancelarLembrete()
      await registrarAcao($)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // O agente principal voltou a trabalhar sem você (ex.: aviso de tarefa em
  // segundo plano): o "terminei" anterior perdeu o sentido.
  on('turn.start', ($, e, next) => {
    if (e.agentId === undefined) cancelarLembrete({ loop: undefined })
    return next(e)
  })

  // Pergunta ou plano para aprovar toca antes do diálogo abrir. A permissão
  // e o diálogo ficam dentro do next(e): quando ele resolve, você respondeu.
  // Se o mod falhar, a chamada segue como se ele não existisse.
  on('tool.call', async ($, e, next) => {
    if (PERGUNTA.test(e.tool)) await pedirResposta($, e.agentId)
    const result = await next(e)
    cancelarLembrete({ loop: e.agentId })
    if (esperandoVoce.delete(e.agentId)) await registrarAcao($)
    return result
  }).catch(($, e, next) => next(e))

  on('classic.PermissionRequest', ($, e, next) => {
    void pedirResposta($, e.agent_id)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.Notification', { notification_type: /^(permission_prompt|elicitation_dialog)$/ }, ($, e, next) => {
    void pedirResposta($, e.agent_id)
    return next(e)
  }).catch(($, e, next) => next(e))
}
