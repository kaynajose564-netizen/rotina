# KAYNÃ CONTROL

Painel pessoal com duas áreas: **KAYNÃ STUDY** e **KAYNÃ PC**.

## O que já funciona
- Painel inicial com nível, XP, sequência e missões.
- Criar, concluir e excluir missões de estudo.
- XP, níveis e conquistas.
- Cronômetro de foco de 15 a 120 minutos, com pausa e conclusão.
- Tema claro/escuro.
- Dados do estudo salvos localmente no navegador.

## KAYNÃ PC
A interface está preparada, mas as métricas reais de CPU, RAM, SSD, GPU NVIDIA, temperaturas e FPS ainda dependem de um aplicativo nativo para Windows e integração com sensores/drivers. Esta versão não simula nem inventa esses números. A limpeza do Windows permanece desabilitada até existir integração segura com prévia e confirmação.

## Executar
Requer Node.js 22.5 ou superior:
```bash
npm install
npm start
``
Abra http://localhost:3000

## Segurança
Nenhum arquivo pessoal é apagado. Não há encerramento de processos nem desinstalação de programas. A manutenção do PC não executa ações nesta versão.
