# aviso-sonoro

Mod do Claude Code que toca um som quando o Claude termina de trabalhar ou precisa da sua resposta, para você poder sair da frente do computador enquanto ele trabalha.

- **Preciso de você**: quando o Claude faz uma pergunta, pede para aprovar um plano ou pede permissão para rodar algo, toca 2x. Sem resposta em 5 minutos, toca 2x de novo.
- **Terminei**: quando o Claude termina a resposta, toca 1x, mas só se faz mais de 1 minuto que você não mexe em nada (mandar mensagem, apertar Esc ou responder uma pergunta). Assim, a resposta rápida a um "ok" não toca. Sem resposta em 5 minutos, toca de novo.

O lembrete de 5 minutos toca uma vez só. Esc, uma mensagem sua ou a resposta à pergunta cancelam o lembrete.

## Requisitos

Claude Code rodando no **WSL**, no Windows. O som sai pelo `powershell.exe` do Windows, porque no Linux o Claude Code não tem como tocar áudio. No macOS, no Linux sem Windows e no Claude Code nativo do Windows o mod não toca nada.

## Instalar

No prompt do Claude Code, no terminal:

```
/plugin install aviso-sonoro --marketplace jvcunhas/claude-aviso-sonoro
```

Responda `y` para adicionar o marketplace e escolha o escopo com Enter.

Pelo shell:

```
claude plugin install aviso-sonoro --marketplace jvcunhas/claude-aviso-sonoro
```

No app desktop, onde `/plugin` não roda: clique no + ao lado da caixa do prompt, depois Plugins, Add marketplace com `jvcunhas/claude-aviso-sonoro`, e então Add plugin.

## Ajustes

- Os sons são `sons/pronto.wav` e `sons/atencao.wav`. Precisam ser WAV, porque o tocador do Windows não lê MP3.
- No topo de `hooks/register.ts`: `vezes` (quantas vezes cada som toca), `LEMBRETE_MS` (o tempo do lembrete) e `AUSENTE_MS` (o tempo sem você mexer para o "terminei" tocar).
