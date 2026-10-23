# Correo de producción con Amazon SES (H52)

Guía para enviar el correo de hackOS desde Amazon SES con el DNS de
`hackudc.com` en Cloudflare, sin tocar el correo del dominio principal.
Staging sigue con Mailpit (o el relay que ya use); solo producción pasa a SES.

## Diseño

Dos subdominios dedicados, uno por tipo de correo:

| Tipo | Plantillas | Remitente |
|---|---|---|
| Cuenta | `auth.*` (verificar correo, restablecer contraseña, invitaciones, PIN de baja) | `no-reply@auth.hackudc.com` |
| Notificaciones | todo lo demás (cola, avisos, decisiones, recordatorios) | `no-reply@notify.hackudc.com` |

Por qué:

- **Aislar la reputación.** Una queja o un rebote en avisos masivos no empeora
  la entrega de la verificación de cuenta, que es la que bloquea a la gente.
- **Proteger el dominio principal.** `hackudc.com` (web, buzones del equipo,
  Mailcow) no recibe ningún registro de SES. SPF, DKIM y MX del apex no se tocan.
- Los nombres son configurables: si prefieres otros subdominios, cámbialos aquí
  y en las variables de entorno.

El código elige el remitente por plantilla (`senderFor` en
`apps/api/src/modules/notifications/channels/email.ts`): si el nombre empieza
por `auth.` y existe `MAIL_AUTH_FROM_ADDRESS`, sale por ahí; si no, por
`MAIL_FROM_ADDRESS`. Con las variables de cuenta vacías (staging, desarrollo)
todo sale por el remitente normal.

## 1. Identidades en SES

Región: una de la UE (por ejemplo `eu-west-1`). Hazlo dos veces, una por
subdominio (`auth.hackudc.com`, `notify.hackudc.com`).

1. **SES → Configuration → Identities → Create identity → Domain.**
2. Escribe el subdominio (no `hackudc.com`).
3. **Easy DKIM** con RSA_2048 y DKIM signatures activadas.
4. Marca **Use a custom MAIL FROM domain** con `bounce.auth.hackudc.com`
   (`bounce.notify.hackudc.com` para el otro) y **Reject message** si falla el
   MX. Esto alinea SPF con el dominio visible, que es lo que exige DMARC.
5. Crea la identidad. SES muestra los registros DNS que necesitas.

## 2. Registros DNS en Cloudflare

Para cada subdominio, en **DNS → Records**. Todos con la nube **gris (DNS
only)**; un registro proxied rompe la verificación.

| Tipo | Nombre | Contenido | Prioridad |
|---|---|---|---|
| CNAME | `<token1>._domainkey.auth` | `<token1>.dkim.amazonses.com` | |
| CNAME | `<token2>._domainkey.auth` | `<token2>.dkim.amazonses.com` | |
| CNAME | `<token3>._domainkey.auth` | `<token3>.dkim.amazonses.com` | |
| MX | `bounce.auth` | `feedback-smtp.eu-west-1.amazonses.com` | 10 |
| TXT | `bounce.auth` | `v=spf1 include:amazonses.com ~all` | |
| TXT | `_dmarc.auth` | `v=DMARC1; p=none; rua=mailto:dmarc@hackudc.com` | |

Repite con `notify` en lugar de `auth` (otros tres tokens DKIM). Los tokens
exactos y la región del MX salen de la pantalla de la identidad. Cloudflare
añade el dominio solo al nombre: escribe `x._domainkey.auth`, no el nombre
completo.

Notas:

- **No cambies** el SPF (`TXT hackudc.com`), los MX, el DKIM ni el `_dmarc` del
  apex. SES no necesita nada ahí.
- DMARC empieza en `p=none` para recibir informes sin bloquear nada. Cuando
  los informes (`rua`) salgan limpios durante una o dos semanas, súbelo a
  `p=quarantine`. `dmarc@hackudc.com` debe ser un buzón que lea alguien.
- Comprueba con `dig TXT _dmarc.hackudc.com` si el apex ya tiene DMARC: los
  subdominios sin registro propio lo heredan; los registros `_dmarc.auth` y
  `_dmarc.notify` lo sustituyen para ellos.
- La identidad pasa a *Verified* en minutos. Si no, revisa que los CNAME no
  estén proxied.

## 3. Salir del sandbox

SES empieza limitado a direcciones verificadas.

1. **SES → Account dashboard → Request production access.**
2. Tipo: *Transactional*. Describe el caso: correos de cuenta y avisos a
   participantes de un hackathon que se han registrado ellos mismos; volumen
   esperado por día y pico; que cada correo es consecuencia de una acción del
   usuario; que hay supresión de rebotes y quejas.
3. Hasta que lo aprueben solo funcionan destinatarios verificados.

## 4. Rebotes y quejas

SES suspende cuentas con rebotes por encima del ~5 % o quejas por encima del
~0,1 %.

1. **Account dashboard → Suppression list settings:** activa la supresión a
   nivel de cuenta para *Bounces* y *Complaints*. SES deja de enviar a esas
   direcciones sin que la app haga nada.
2. Crea un **configuration set** (`hackos-production`) con un destino de
   eventos *SNS* para *Bounce* y *Complaint*, y suscribe tu correo para
   enterarte. La app lo adjunta con `MAIL_SES_CONFIGURATION_SET`.
3. La app **todavía no importa** los eventos de rebote: la supresión la hace
   SES. Es un pendiente conocido (ver al final).

## 5. Credenciales SMTP

1. **SES → SMTP settings → Create SMTP credentials.** Crea un usuario IAM y
   muestra una sola vez el usuario y la contraseña SMTP.
2. Restringe su política a `ses:SendRawEmail` sobre las dos identidades y el
   configuration set, no a `*`.
3. Endpoint: `email-smtp.eu-west-1.amazonaws.com`, puerto `587` (STARTTLS), que
   es lo que ya hace la app por defecto.

## 6. Variables de producción

En el fichero de entorno de producción (`deploy/.env.example` documenta cada
una; `SMTP_PASS` es secreto):

```
MAIL_FROM_ADDRESS=no-reply@notify.hackudc.com
MAIL_FROM_NAME=HackUDC
MAIL_AUTH_FROM_ADDRESS=no-reply@auth.hackudc.com
MAIL_AUTH_FROM_NAME=HackUDC
MAIL_REPLY_TO=hackudc@gpul.org
MAIL_SES_CONFIGURATION_SET=hackos-production
SMTP_HOST=email-smtp.eu-west-1.amazonaws.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_REQUIRE_TLS=true
SMTP_USER=<usuario SMTP de SES>
SMTP_PASS=<contraseña SMTP de SES>
```

`MAIL_REPLY_TO` hace que respondan a un buzón real; los filtros penalizan los
`no-reply` puros. El pie del correo sigue diciendo que no se responda a la
dirección que envía, y apunta a `hackudc@gpul.org`.

En staging no definas `MAIL_AUTH_*`, `MAIL_REPLY_TO` ni
`MAIL_SES_CONFIGURATION_SET`; sigue con Mailpit.

## 7. Comprobar antes de abrir

1. En la web, **Avisos → Enviar correo** (necesita `notifications:send`)
   manda un aviso individual desde el remitente de notificaciones a cualquier
   dirección. Es la herramienta para estas pruebas.
2. A una cuenta de Gmail: **Mostrar original** debe indicar `SPF: PASS`,
   `DKIM: PASS` con `d=notify.hackudc.com` y `DMARC: PASS`.
3. Provoca un correo de cuenta (reenviar verificación) y comprueba que sale de
   `auth.hackudc.com`.
4. Prueba con [mail-tester.com](https://www.mail-tester.com) y con una cuenta
   `@udc.es`. Los correos de UDC pasan por Exchange Online: si no llegan,
   pide a su informática que añada `auth.hackudc.com` y `notify.hackudc.com` a
   la lista de remitentes permitidos y un *message trace*.

## 8. Arranque y vigilancia

- Empieza con volumen bajo; los subdominios nuevos no tienen reputación. Manda
  primero los correos de cuenta y deja pasar unos días antes de un envío masivo.
- Vigila **SES → Reputation metrics** y los informes DMARC.
- El correo masivo del evento (`event.reminder`) es el que más pesa; ver
  `docs/big-event-readiness.md`.

## Qué cambió en el código

- `MAIL_AUTH_FROM_ADDRESS`, `MAIL_AUTH_FROM_NAME`, `MAIL_REPLY_TO` y
  `MAIL_SES_CONFIGURATION_SET` (`src/config.ts`, `docker-compose.yml`,
  `docs/env-vars.md`, `deploy/.env.example`).
- Remitente por tipo de plantilla y cabeceras `Reply-To`,
  `Auto-Submitted`, `X-Auto-Response-Suppress` y `X-SES-CONFIGURATION-SET`
  (`channels/email.ts`, `channels/email-adapters/smtp.ts`).
- `POST /api/notifications/test-email` y su botón en Avisos.
- Cabecera del correo en azul marino con el logo en crema (ver
  [`notifications.md`](./notifications.md)).

## Pendiente

- Importar rebotes y quejas de SES (SNS) para marcar direcciones en la base de
  datos. Hoy solo actúa la lista de supresión de SES.
- Enviar solo `auth.*` a cuentas sin correo verificado.
