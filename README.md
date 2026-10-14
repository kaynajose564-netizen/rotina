# Rotina Diária v2
Calendário + notas com horário (alarme automático) + lembrete por e-mail + contas de usuário.

## Rodar
Requer Node 22.5+.
    npm install
    npm start        # http://localhost:3000

## E-mail real (SMTP)
Sem configurar, os e-mails vão para `outbox.log` (modo teste). Para enviar de verdade:
    SMTP_HOST=smtp.gmail.com SMTP_PORT=587 SMTP_USER=seu@gmail.com SMTP_PASS=senha-de-app MAIL_FROM=seu@gmail.com npm start
(Gmail: use "Senha de app". Alternativas gratuitas: Brevo, Resend, Mailgun.)

## Publicar no Vercel

O deploy usa PostgreSQL do Neon; o SQLite local continua sendo usado no desenvolvimento.
Configure estas variáveis no projeto Vercel:

- `DATABASE_URL`: string de conexão do banco Neon.
- `SECRET`: segredo aleatório com pelo menos 32 caracteres.
- `CRON_SECRET`: segredo aleatório com pelo menos 32 caracteres.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` e `MAIL_FROM`: credenciais SMTP para lembretes por e-mail.

O arquivo `vercel.json` configura o Express como uma função Vercel. A Hobby executa Cron
no máximo uma vez por dia, então configure um agendador externo gratuito para fazer um
`POST` a cada minuto em `/api/cron/reminders`, enviando
`Authorization: Bearer <CRON_SECRET>`. Não coloque o segredo no código nem o envie pelo chat.

Os dados do SQLite local não são enviados automaticamente ao banco remoto. O site hospedado
começa com contas e notas vazias; mantenha seu arquivo `rotina.db` local até decidir como
preservar esses dados.

Teste com `npm test`. O modo local continua em `npm start` e grava e-mails de teste em
`outbox.log` quando SMTP não está configurado.
