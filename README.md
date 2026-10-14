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

## Publicar
Precisa ficar ligado 24h para enviar e-mails (Render, Railway, Fly.io, VPS). Use NODE_ENV=production atrás de HTTPS.
Dados ficam em rotina.db (faça backup desse arquivo).
